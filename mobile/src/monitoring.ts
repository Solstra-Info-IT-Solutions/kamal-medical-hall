import { Platform } from 'react-native';

/**
 * Crash and error reporting (Sentry). It stays completely off until EXPO_PUBLIC_SENTRY_DSN is set, in development
 * builds and on the web, so nothing is sent unless you opt in. Only a user id and role are attached, never names,
 * phone numbers or addresses.
 */
type SentryModule = typeof import('@sentry/react-native');
let Sentry: SentryModule | null = null;

export function initMonitoring() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn || Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Sentry = require('@sentry/react-native') as SentryModule;
    Sentry.init({
      dsn,
      enabled: !__DEV__,
      environment: process.env.EXPO_PUBLIC_ENV ?? 'preview',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      attachScreenshot: false,
    });
  } catch { Sentry = null; }
}

/** Wraps the root component so render crashes and native crashes are reported. */
export function withMonitoring<T extends React.ComponentType<any>>(Root: T): T {
  return (Sentry?.wrap ? (Sentry.wrap(Root) as unknown as T) : Root);
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  try { Sentry?.captureException(error, context ? { extra: context } : undefined); } catch { /* reporting must never break the app */ }
}

export function setMonitoringUser(user: { id: string; role: string } | null) {
  try { Sentry?.setUser(user ? { id: user.id, username: user.role } : null); } catch { /* ignore */ }
}
