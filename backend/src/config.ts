import 'dotenv/config';

const env = process.env;
export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? '',
  authMode: (env.AUTH_MODE ?? 'firebase') as 'dev' | 'firebase',
  jwtSecret: env.JWT_SECRET ?? '',
  firebaseProjectId: env.FIREBASE_PROJECT_ID ?? '',
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  bootstrapAdminPhones: (env.BOOTSTRAP_ADMIN_PHONES ?? '').split(',').map((p) => p.trim()).filter(Boolean),
  cloudinary: { cloudName: env.CLOUDINARY_CLOUD_NAME ?? '', apiKey: env.CLOUDINARY_API_KEY ?? '', apiSecret: env.CLOUDINARY_API_SECRET ?? '' },
  razorpay: { keyId: env.RAZORPAY_KEY_ID ?? '', keySecret: env.RAZORPAY_KEY_SECRET ?? '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '' },
  minLeadMinutes: Number(env.MIN_LEAD_MINUTES ?? 60),
  quoteValidHours: Number(env.QUOTE_VALID_HOURS ?? 24),
};

if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET (32+ chars) is required');
if (config.isProd && config.authMode === 'dev') throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
if (config.authMode === 'firebase' && !config.firebaseProjectId) throw new Error('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase');
