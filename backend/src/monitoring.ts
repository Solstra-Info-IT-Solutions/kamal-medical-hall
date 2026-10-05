import * as Sentry from '@sentry/node';

/** Error reporting for the API. Off until SENTRY_DSN is set. No request bodies or personal data are attached. */
const dsn = process.env.SENTRY_DSN?.trim();
if (dsn) Sentry.init({ dsn, environment: process.env.NODE_ENV ?? 'development', tracesSampleRate: 0.1 });

export const reportError = (error: unknown) => { if (dsn) Sentry.captureException(error); };

