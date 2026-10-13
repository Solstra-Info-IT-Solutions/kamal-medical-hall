import { deleteToken, getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';
import { AppState } from 'react-native';
import { endpoints } from './api/endpoints';
import { logger } from './core/logging';
import { showDialog } from './dialog';
import { firebaseWebApp } from './firebaseWeb';
import i18n from './localization';

/**
 * Firebase Cloud Messaging in the browser (the website / web admin panel). Same functions as push.ts for the apps:
 *  - asks the browser for permission (after a short explanation, so the browser's prompt comes from a click),
 *  - registers this browser's token with the server and removes it on sign-out,
 *  - `public/firebase-messaging-sw.js` shows notifications while the site is in the background or closed, and a click
 *    on one brings the site forward on the right page (order, cash, chat...).
 * While the site is in front, notifications arrive over the live connection and show as the in-app banner.
 */
const SW_URL = '/firebase-messaging-sw.js';
let messaging: Messaging | null = null;
let currentToken: string | null = null;
let listening = false;
let stopWatching: (() => void) | null = null;

const hasNotificationApi = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
const permission = (): NotificationPermission | 'unsupported' => (hasNotificationApi() ? Notification.permission : 'unsupported');

async function load(): Promise<Messaging | null> {
  if (messaging) return messaging;
  try {
    if (!hasNotificationApi() || !(await isSupported())) return null;
    messaging = getMessaging(firebaseWebApp());
    return messaging;
  } catch (e) { logger.debug('web push not available', e); return null; }
}

/** Opens the page a notification points to, once the navigator is ready. */
function openWhenReady(data: { orderId?: unknown; type?: unknown; announcementId?: unknown } | undefined, tries = 0) {
  if (!data?.orderId && !data?.type) return;
  const nav = require('./navigation/ref') as typeof import('./navigation/ref'); // lazily: navigation depends on the session store, which depends on this file
  if (nav.navigationRef.isReady()) return nav.openFromNotification({ orderId: data.orderId as string | undefined, type: data.type as string | undefined, announcementId: data.announcementId as string | undefined });
  if (tries < 40) setTimeout(() => openWhenReady(data, tries + 1), 250);
}

/** Clicks on a notification: the worker messages an open tab, or opens a new one with ?kmhOpen=... */
function listenForClicks() {
  if (listening || !hasNotificationApi()) return;
  listening = true;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => { if (e.data?.kmh === 'open') openWhenReady(e.data.data); });
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('kmhOpen');
  if (raw) {
    params.delete('kmhOpen');
    window.history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash);
    try { openWhenReady(JSON.parse(raw)); } catch { /* not ours */ }
  }
}

/** Not used in the browser: the service worker handles background messages. Kept so both platforms share one API. */
export function initPushBackgroundHandler() { /* nothing to do on the web */ }

export async function notificationsEnabled(): Promise<boolean> {
  return permission() === 'granted';
}

/** Shows the browser's "Allow notifications?" prompt when it may still be shown. */
export async function requestNotifications(): Promise<boolean> {
  if (permission() === 'default') {
    try { await Notification.requestPermission(); } catch { /* old browsers: callback form only */ }
  }
  return permission() === 'granted';
}

/** Browsers have no settings page a site can open, so say where the switch is. */
export async function openNotificationSettings(): Promise<void> {
  const t = i18n.t.bind(i18n);
  const p = permission();
  if (p === 'unsupported') { await showDialog({ title: t('notif.row'), message: t('notif.webUnsupported'), icon: 'notifications-off', confirmLabel: t('common.ok') }); return; }
  await showDialog({ title: p === 'granted' ? t('notif.row') : t('notif.webBlockedTitle'), message: p === 'granted' ? t('notif.webManageMsg') : t('notif.webBlockedMsg'), icon: p === 'granted' ? 'notifications' : 'notifications-off', confirmLabel: t('common.ok') });
}

/** Turn on from the profile / More menu. */
export async function enableNotifications(): Promise<boolean> {
  if (permission() === 'denied' || permission() === 'unsupported') { await openNotificationSettings(); return false; }
  if (await requestNotifications()) { await registerForPush(); return true; }
  return false;
}

/** Once per tab: explain why notifications matter and let a click bring up the browser's prompt (or say how to unblock). */
async function explainOnce() {
  try { if (sessionStorage.getItem('kmh.pushAsked')) return; sessionStorage.setItem('kmh.pushAsked', '1'); } catch { /* storage blocked: ask anyway */ }
  const t = i18n.t.bind(i18n);
  if (permission() === 'denied') { await openNotificationSettings(); return; }
  const yes = await showDialog({ title: t('notif.webAskTitle'), message: t('notif.webAskMsg'), icon: 'notifications', confirmLabel: t('notif.turnOn'), cancelLabel: t('notif.later') });
  if (yes && (await requestNotifications())) await registerForPush();
}

export async function registerForPush(): Promise<void> {
  listenForClicks();
  const m = await load();
  if (!m) return;
  if (permission() !== 'granted') { void explainOnce(); return; }
  try {
    const registration = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;
    const token = await getToken(m, { serviceWorkerRegistration: registration });
    if (token && token !== currentToken) { currentToken = token; await endpoints.registerDevice(token, 'web'); }
    // Firebase may renew the token; checking again when the tab comes back keeps the server's copy current.
    stopWatching ??= (() => { const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void registerForPush(); }); return () => sub.remove(); })();
  } catch (e) {
    logger.warn('web push registration failed', { error: String((e as Error)?.message ?? e) });
  }
}

/** Call while still signed in (before the token is cleared). Never throws. */
export async function unregisterPush(): Promise<void> {
  stopWatching?.(); stopWatching = null;
  const token = currentToken;
  currentToken = null;
  if (!token) return;
  try { await endpoints.unregisterDevice(token); } catch { /* the server also drops dead tokens by itself */ }
  try { if (messaging) await deleteToken(messaging); } catch { /* already gone */ }
}
