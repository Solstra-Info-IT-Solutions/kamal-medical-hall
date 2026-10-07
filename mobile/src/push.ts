import { Platform } from 'react-native';
import { endpoints } from './api/endpoints';
import { logger } from './core/logging';

/**
 * Firebase Cloud Messaging. A no-op where Firebase Messaging is not built in (web / dev mode).
 *  - registers this phone's token with the server (and again whenever Firebase renews it),
 *  - opens the right order when a notification is tapped, from the background or from a closed app,
 *  - forgets the token on sign-out so a signed-out phone stops receiving that person's notifications.
 * Notifications that arrive while the app is open are shown in-app by the live connection, not by the system.
 */
type Messaging = typeof import('@react-native-firebase/messaging');
let fb: Messaging | null = null;
let currentToken: string | null = null;
let unsubscribers: Array<() => void> = [];

const load = (): Messaging | null => {
  if (Platform.OS === 'web') return null;
  try { fb ??= require('@react-native-firebase/messaging') as Messaging; return fb; } catch { return null; }
};

/** Needed once at startup: Firebase warns if a background handler is missing. The system shows the notification itself. */
export function initPushBackgroundHandler() {
  const m = load();
  try { if (m) m.setBackgroundMessageHandler(m.getMessaging(), async () => undefined); } catch { /* Firebase not configured */ }
}

/** Waits for the navigator (the app may still be starting after a tap on a notification), then opens the order. */
function openOrderWhenReady(orderId: string | undefined, tries = 0) {
  if (!orderId) return;
  // required lazily: the navigation module depends on the session store, which depends on this file
  const nav = require('./navigation/ref') as typeof import('./navigation/ref');
  if (nav.navigationRef.isReady()) return nav.openOrderFromNotification(orderId);
  if (tries < 40) setTimeout(() => openOrderWhenReady(orderId, tries + 1), 250);
}

export async function registerForPush(): Promise<void> {
  const m = load();
  if (!m) return;
  try {
    const messaging = m.getMessaging();
    const status = await m.requestPermission(messaging);
    if (status === m.AuthorizationStatus.DENIED) return;
    const token = await m.getToken(messaging);
    if (token) { currentToken = token; await endpoints.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android'); }

    unsubscribers.forEach((u) => u());
    unsubscribers = [
      m.onTokenRefresh(messaging, (fresh) => { currentToken = fresh; void endpoints.registerDevice(fresh, Platform.OS === 'ios' ? 'ios' : 'android').catch(() => undefined); }),
      m.onNotificationOpenedApp(messaging, (msg) => openOrderWhenReady(msg.data?.orderId as string | undefined)),
    ];
    const first = await m.getInitialNotification(messaging); // the app was closed and a notification opened it
    openOrderWhenReady(first?.data?.orderId as string | undefined);
  } catch (e) {
    logger.debug('push not available in this build', e); // Firebase not configured; push is optional
  }
}

/** Call while still signed in (before the token is cleared). Never throws. */
export async function unregisterPush(): Promise<void> {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  const token = currentToken;
  currentToken = null;
  if (!token) return;
  try { await endpoints.unregisterDevice(token); } catch { /* the server also drops dead tokens by itself */ }
}
