
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

import { config } from './config.js';
import { User } from './models/User.js';
import { HttpError, forbidden } from './http.js';

export type Role = 'customer' | 'admin' | 'delivery_partner';

export interface AuthUser {
  id: string;
  phone: string;
  role: Role;
  name: string | null;
  email: string | null;
  avatar_public_id?: string | null;
  avatar_resource_type?: string | null;
  is_active?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    verified?: {
      uid: string;
      phone: string;
    };
  }
}

let firebaseApp: App | undefined;

function firebase(): App {
  if (!firebaseApp) {
    firebaseApp = initializeApp(
      config.firebaseServiceAccount
        ? {
            credential: cert(
              JSON.parse(config.firebaseServiceAccount)
            ),
            projectId: config.firebaseProjectId,
          }
        : {
            projectId: config.firebaseProjectId,
          }
    );
  }

  return firebaseApp;
}

/**
 * Push notifications are disabled during automated tests.
 */
const pushOff = () =>
  process.env.PUSH === 'off' ||
  process.env.NODE_TEST_CONTEXT !== undefined;

export const firebaseMessaging = () =>
  config.firebaseServiceAccount && !pushOff()
    ? getMessaging(firebase())
    : null;

/**
 * Normalize Indian phone numbers.
 *
 * Supported formats:
 * +91XXXXXXXXXX
 * 91XXXXXXXXXX
 * XXXXXXXXXX
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  const ten =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits;

  if (!/^[6-9]\d{9}$/.test(ten)) {
    throw new HttpError(
      422,
      'invalid_phone',
      'Enter a valid 10-digit Indian mobile number'
    );
  }

  return ten;
}

/**
 * Verify Firebase ID tokens or application JWT session tokens.
 */
export async function verifyToken(
  token: string
): Promise<{ uid: string; phone: string }> {
  if (config.authMode !== 'firebase') {
    try {
      const payload = jwt.verify(
        token,
        config.jwtSecret
      ) as {
        sub: string;
        phone: string;
      };

      if (!payload.sub || !payload.phone) {
        throw new Error('Invalid session token payload');
      }

      return {
        uid: payload.sub,
        phone: normalisePhone(payload.phone),
      };
    } catch (error) {
      // Older app versions may still use Firebase ID tokens.
      if (
        config.authMode === 'dev' ||
        !config.firebaseProjectId
      ) {
        throw error;
      }
    }
  }

  const decoded = await getAuth(firebase()).verifyIdToken(token);

  const phone =
    decoded.phone_number ??
    (typeof decoded.phone === 'string'
      ? decoded.phone
      : '');

  if (!phone) {
    throw new Error('No phone number on token');
  }

  return {
    uid: decoded.uid,
    phone: normalisePhone(phone),
  };
}

/**
 * Remove Firebase identity so a phone number can be registered again.
 */
export async function deleteFirebaseUser(
  uid: string | null
): Promise<void> {
  if (
    !uid ||
    !config.firebaseServiceAccount ||
    /^(dev|tw|sms)-/.test(uid)
  ) {
    return;
  }

  try {
    await getAuth(firebase()).deleteUser(uid);
  } catch (error) {
    console.error('Firebase deleteUser failed:', error);
  }
}

/**
 * Sign a session token after OTP verification.
 */
export function signSessionToken(
  phone: string,
  prefix: 'tw' | 'sms' = 'tw'
): string {
  return jwt.sign(
    {
      sub: `${prefix}-${phone}`,
      phone,
    },
    config.jwtSecret,
    {
      expiresIn: '30d',
    }
  );
}

/**
 * Firebase custom-token sessions.
 */
export const firebaseSessions = () =>
  Boolean(config.firebaseServiceAccount) &&
  config.authMode !== 'dev' &&
  (
    process.env.NODE_TEST_CONTEXT === undefined ||
    process.env.FIREBASE_SESSIONS === 'on'
  );

/**
 * Create Firebase custom token after server-side OTP verification.
 */
export async function createFirebaseSession(
  phone: string
): Promise<string> {
  const auth = getAuth(firebase());

  let uid = `ph_${phone}`;

  try {
    const existingUser = await auth.getUserByPhoneNumber(
      `+91${phone}`
    );

    uid = existingUser.uid;
  } catch {
    // No phone-auth user exists yet.
  }

  return auth.createCustomToken(uid, {
    phone,
  });
}

/**
 * Development session token.
 */
export function signDevToken(phone: string): string {
  return jwt.sign(
    {
      sub: `dev-${phone}`,
      phone,
    },
    config.jwtSecret,
    {
      expiresIn: '30d',
    }
  );
}

/**
 * Verify bearer token only.
 * User record is not required at this stage.
 */
export async function verified(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(
      401,
      'unauthenticated',
      'Please sign in'
    );
  }

  try {
    req.verified = await verifyToken(header.slice(7));
  } catch {
    throw new HttpError(
      401,
      'invalid_token',
      'Your session has expired. Please sign in again.'
    );
  }

  next();
}

/**
 * Short-lived user cache.
 */
const USER_TTL_MS = 15_000;

const userCache = new Map<
  string,
  {
    user: AuthUser;
    exp: number;
  }
>();

export const invalidateUser = (phone?: string): void => {
  if (phone) {
    userCache.delete(phone);
  } else {
    userCache.clear();
  }
};

/**
 * Convert MongoDB User document fields into the existing
 * AuthUser structure used throughout the application.
 */
function mapAuthUser(user: {
  _id: { toString(): string };
  phone: string;
  role: Role;
  name?: string | null;
  email?: string | null;
  avatarPublicId?: string | null;
  avatarResourceType?: string | null;
  isActive?: boolean;
}): AuthUser {
  return {
    id: user._id.toString(),
    phone: user.phone,
    role: user.role,
    name: user.name ?? null,
    email: user.email ?? null,
    avatar_public_id: user.avatarPublicId ?? null,
    avatar_resource_type: user.avatarResourceType ?? null,
    is_active: user.isActive ?? true,
  };
}

/**
 * Routes allowed for deactivated customers.
 */
function allowedWhileDeactivated(req: Request): boolean {
  const path = (req.originalUrl.split('?')[0] ?? '')
    .replace(/\/$/, '');

  return (
    (
      req.method === 'GET' &&
      (
        path === '/me' ||
        path === '/notifications' ||
        path === '/config'
      )
    ) ||
    path === '/account/requests' ||
    path.startsWith('/account/requests/') ||
    path === '/devices'
  );
}

/**
 * Verify token and load the MongoDB user.
 */
export async function authed(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  await verified(req, res, () => undefined);

  const phone = req.verified!.phone;

  const hit = userCache.get(phone);

  if (hit && hit.exp > Date.now()) {
    req.user = hit.user;

    if (
      hit.user.is_active === false &&
      !allowedWhileDeactivated(req)
    ) {
      throw new HttpError(
        403,
        'account_deactivated',
        'Your account is deactivated. You can ask the store to activate it again.'
      );
    }

    return next();
  }

  // MongoDB lookup using Mongoose.
  const dbUser = await User.findOne({
    phone,
  })
    .select({
      phone: 1,
      role: 1,
      name: 1,
      email: 1,
      avatarPublicId: 1,
      avatarResourceType: 1,
      isActive: 1,
    })
    .lean()
    .exec();

  if (!dbUser) {
    userCache.delete(phone);

    throw new HttpError(
      401,
      'no_account',
      'Account not found. Please sign in again.'
    );
  }

  const authUser = mapAuthUser(dbUser);

  if (userCache.size > 5000) {
    userCache.clear();
  }

  userCache.set(phone, {
    user: authUser,
    exp: Date.now() + USER_TTL_MS,
  });

  req.user = authUser;

  if (
    authUser.is_active === false &&
    !allowedWhileDeactivated(req)
  ) {
    throw new HttpError(
      403,
      'account_deactivated',
      'Your account is deactivated. You can ask the store to activate it again.'
    );
  }

  next();
}

/**
 * Role-based authorization middleware.
 */
export const requireRole =
  (...roles: Role[]) =>
  (
    req: Request,
    _res: Response,
    next: NextFunction
  ): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw forbidden();
    }

    next();
  };
