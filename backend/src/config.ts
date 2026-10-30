import 'dotenv/config';

const env: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v?.trim()])
);

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  // MongoDB connection (only supported database)
  mongoUrl: env.MONGODB_URI ?? '',
  /** How the login OTP is sent: 'sms' = our own code through the SMS gateway (PearlSMS), 'twilio' = Twilio Verify, 'firebase' = Firebase phone auth. */
  authMode: (env.AUTH_MODE ?? 'firebase') as 'dev' | 'firebase' | 'twilio' | 'sms',
  jwtSecret: env.JWT_SECRET ?? '',
  firebaseProjectId: env.FIREBASE_PROJECT_ID ?? '',
  firebaseServiceAccount: env.FIREBASE_SERVICE_ACCOUNT_JSON ?? '',
  bootstrapAdminPhones: (env.BOOTSTRAP_ADMIN_PHONES ?? '').split(',')
    .map((p) => p.trim())
    .filter(Boolean),
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: env.CLOUDINARY_API_KEY ?? '',
    apiSecret: env.CLOUDINARY_API_SECRET ?? '',
  },
  /** Twilio Verify sends and checks the SMS OTP when AUTH_MODE=twilio. */
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID ?? '',
    authToken: env.TWILIO_AUTH_TOKEN ?? '',
    verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID ?? '',
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID ?? '',
    keySecret: env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  /** Origins allowed to call the API from a browser (the web admin). Native apps send no Origin header. */
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  corsOrigins: (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  /** 'socket': the API is reachable only through the app's live socket connection */
  socketOnly: env.API_TRANSPORT === 'socket',
  logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS === 'on' : env.NODE_ENV === 'production',
  minLeadMinutes: Number(env.MIN_LEAD_MINUTES ?? 60),
  quoteValidHours: Number(env.QUOTE_VALID_HOURS ?? 24),
};

// MongoDB-only application
export const useMongo = (): boolean => {
  return Boolean(config.mongoUrl);
};

if (!config.mongoUrl) throw new Error('MONGODB_URI is required');
if (!config.jwtSecret || config.jwtSecret.length < 32)
  throw new Error('JWT_SECRET (32+ chars) is required');
if (config.publicUrl && !/^https?:\/\/[\w.-]+(:\d{1,5})?$/.test(config.publicUrl))
  throw new Error('PUBLIC_URL must look like https://api.example.com (no path)');
if (config.isProd && config.authMode === 'dev')
  throw new Error('AUTH_MODE=dev is not allowed when NODE_ENV=production');
if (config.authMode === 'twilio' && !(config.twilio.accountSid && config.twilio.authToken && config.twilio.verifyServiceSid))
  throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID are required when AUTH_MODE=twilio');
if (config.authMode === 'firebase' && !config.firebaseProjectId)
  throw new Error('FIREBASE_PROJECT_ID is required when AUTH_MODE=firebase');