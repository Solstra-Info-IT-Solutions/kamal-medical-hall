import { Platform } from 'react-native';

/**
 * Crash and error reporting: Firebase Crashlytics (native and JavaScript crashes, handled errors) and, when a DSN is set, Sentry.
 *
 * Crashlytics is on in release builds of the Android/iOS app whenever Firebase is configured, and off in development and on the web.
 * Sentry It stays completely off until EXPO_PUBLIC_SENTRY_DSN is set, in development
 * builds and on the web, so nothing is sent unless you opt in. Only a user id and role are attached, never names,
 * phone numbers or addresses.
 */
type SentryModule = typeof import('@sentry/react-native');
let Sentry: SentryModule | null = null;

type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');
let crashlytics: { m: CrashlyticsModule; c: ReturnType<CrashlyticsModule['getCrashlytics']> } | null = null;
const withCrashlytics = (fn: (x: NonNullable<typeof crashlytics>) => void) => { try { if (crashlytics) fn(crashlytics); } catch { /* reporting must never break the app */ } };

function initCrashlytics() {
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
    const c = m.getCrashlytics();
    crashlytics = { m, c };
    void m.setCrashlyticsCollectionEnabled(c, !__DEV__);
    m.setAttribute(c, 'env', process.env.EXPO_PUBLIC_ENV ?? 'preview').catch(() => undefined);
  } catch { crashlytics = null; } // Firebase is not configured in this build
}

export function initMonitoring() {
  initCrashlytics();
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
  withCrashlytics(({ m, c }) => {
    const e = error instanceof Error ? error : new Error(String(error));
    if (context?.route) m.log(c, `${String(context.route)}${context.status ? ` ${String(context.status)}` : ''}`); // route patterns only, no personal data
    m.recordError(c, e);
  });
  try { Sentry?.captureException(error, context ? { extra: context } : undefined); } catch { /* reporting must never break the app */ }
}

export function setMonitoringUser(user: { id: string; role: string } | null) {
  withCrashlytics(({ m, c }) => { void m.setUserId(c, user?.id ?? ''); void m.setAttribute(c, 'role', user?.role ?? ''); });
  try { Sentry?.setUser(user ? { id: user.id, username: user.role } : null); } catch { /* ignore */ }
}
