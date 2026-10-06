import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, forbidden } from './http.js';

export type Role = 'customer' | 'admin' | 'delivery_partner';
export interface AuthUser { id: string; phone: string; role: Role; name: string | null; email: string | null; avatar_public_id?: string | null; avatar_resource_type?: string | null }
declare module 'express-serve-static-core' { interface Request { user?: AuthUser; verified?: { uid: string; phone: string } } }

let firebaseApp: App | undefined;
function firebase() {
  if (!firebaseApp) {
    firebaseApp = initializeApp(
      config.firebaseServiceAccount
        ? { credential: cert(JSON.parse(config.firebaseServiceAccount)), projectId: config.firebaseProjectId }
        : { projectId: config.firebaseProjectId },
    );
  }
  return firebaseApp;
}
export const firebaseMessaging = () => (config.firebaseServiceAccount ? getMessaging(firebase()) : null);

/** Normalises +91XXXXXXXXXX / 91XXXXXXXXXX / XXXXXXXXXX to a 10-digit Indian mobile number. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) throw new HttpError(422, 'invalid_phone', 'Enter a valid 10-digit Indian mobile number');
  return ten;
}

export async function verifyToken(token: string): Promise<{ uid: string; phone: string }> {
  if (config.authMode === 'dev') {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; phone: string };
    return { uid: payload.sub, phone: payload.phone };
  }
  const decoded = await getAuth(firebase()).verifyIdToken(token);
  if (!decoded.phone_number) throw new Error('No phone number on token');
  return { uid: decoded.uid, phone: normalisePhone(decoded.phone_number) };
}

/** Removes the Firebase identity so the phone number can be registered again later. No-op in dev mode. */
export async function deleteFirebaseUser(uid: string | null) {
  if (!uid || config.authMode !== 'firebase' || uid.startsWith('dev-')) return;
  try { await getAuth(firebase()).deleteUser(uid); } catch (e) { console.error('firebase deleteUser failed', e); }
}

export function signDevToken(phone: string) {
  return jwt.sign({ sub: `dev-${phone}`, phone }, config.jwtSecret, { expiresIn: '30d' });
}

/** Verifies the bearer token only; the user row may not exist yet (first login). */
export async function verified(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  try {
    req.verified = await verifyToken(header.slice(7));
  } catch {
    throw new HttpError(401, 'invalid_token', 'Your session has expired. Please sign in again.');
  }
  next();
}

/**
 * Short-lived cache of the signed-in user's row. The token is still verified on every request; only the database
 * lookup is skipped, which saves a cross-region round trip per call. Writes that change the row call
 * `invalidateUser`, and entries expire after 15 s, so a role or account change takes effect within that time.
 */
const USER_TTL_MS = 15_000;
const userCache = new Map<string, { user: AuthUser; exp: number }>();
export const invalidateUser = (phone?: string) => { if (phone) userCache.delete(phone); else userCache.clear(); };

/** Verifies the token and loads the server-side user (and so the role). */
export async function authed(req: Request, res: Response, next: NextFunction) {
  await verified(req, res, () => undefined); // throws 401 itself if the token is bad
  const phone = req.verified!.phone;
  const hit = userCache.get(phone);
  if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }
  const { rows } = await pool.query('select id, phone, role, name, email, avatar_public_id, avatar_resource_type from users where phone = $1', [phone]);
  if (!rows[0]) { userCache.delete(phone); throw new HttpError(401, 'no_account', 'Account not found. Please sign in again.'); }
  if (userCache.size > 5000) userCache.clear();
  userCache.set(phone, { user: rows[0], exp: Date.now() + USER_TTL_MS });
  req.user = rows[0];
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) throw forbidden();
  next();
};
