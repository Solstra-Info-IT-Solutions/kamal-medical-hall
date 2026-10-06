import { io, type Socket } from 'socket.io-client';
import { logger } from '../logging';
import { API_URL } from '../config';

/**
 * The app's single live connection. It carries API requests (see socketTransport) and delivers server events
 * (notifications, order updates, chat). It is always kept up, also before sign-in, so the login screens can make requests.
 *
 * Signed-in connections send the user's token when they connect and so receive that user's personal events. A
 * connection made before sign-in is anonymous: it can make requests (each carries its own token) but receives nothing
 * personal, so after sign-in `connectRealtime` reconnects it once, and after sign-out `disconnectRealtime` does the same.
 */
interface Auth { getToken: () => Promise<string | null>; refreshToken: () => Promise<string | null> }
let auth: Auth = { getToken: async () => null, refreshToken: async () => null };
export function configureSocketAuth(next: Auth) { auth = next; }

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
export const EVENTS = ['notification', 'order:update', 'partner:update', 'store:update', 'chat:message', 'chat:queue', 'chat:update'] as const;

/** Subscribes to a server event ("notification", "order:update", "partner:update", "connect"). Returns an unsubscribe fn. */
export function onRealtime(event: string, fn: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  return () => { handlers.get(event)?.delete(fn); };
}
const fan = (event: string, payload?: unknown) => handlers.get(event)?.forEach((fn) => { try { fn(payload); } catch (e) { logger.warn('realtime handler failed', e); } });

let socket: Socket | null = null;
/** True when the server put this connection in the signed-in user's rooms. */
let personal = false;
/** The server refused our token (expired): connect anonymously until a fresh one is obtained. */
let tokenRefused = false;
let lastRefresh = 0;
/** Who the app wants the connection to belong to. Checked when the server says `ready`, in case sign-in or sign-out
 *  happened while the connection was still being made. `null` until the first sign-in/out. */
let want: 'in' | 'out' | null = null;
let retriedForIn = false;

function create(): Socket {
  const s = io(API_URL, {
    transports: ['websocket'],
    auth: (cb) => { void auth.getToken().then((token) => cb({ token: tokenRefused ? '' : token ?? '' }), () => cb({ token: '' })); },
    reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 8000,
  });
  for (const event of EVENTS) s.on(event, (p) => fan(event, p));
  s.on('ready', (r: { role: string | null }) => {
    personal = r?.role != null;
    // The connection may have been made with the previous identity (it was still connecting when the user signed in or out).
    const wrong = (want === 'out' && personal) || (want === 'in' && !personal && !retriedForIn);
    if (!wrong) return;
    if (want === 'in') retriedForIn = true;
    personal = false;
    s.disconnect().connect();
  });
  s.on('disconnect', () => { personal = false; });
  // After a reconnect we may have missed events, so screens refresh themselves.
  s.on('connect', () => fan('connect'));
  s.on('connect_error', (e: Error) => {
    if (e.message !== 'unauthorized' || tokenRefused) return;
    // An expired token: carry on anonymously (requests still work) and renew the token in the background, at most every 30 s.
    tokenRefused = true;
    if (Date.now() - lastRefresh < 30_000) return;
    lastRefresh = Date.now();
    void auth.refreshToken().then((fresh) => { if (fresh) { tokenRefused = false; s.disconnect().connect(); } }).catch(() => undefined);
  });
  return s;
}

/** The connection requests are sent on. Created on first use. */
export function getSocket(): Socket {
  socket ??= create();
  return socket;
}

/** Makes sure the connection belongs to the signed-in user (call after sign-in and on startup). Cheap when it already does. */
export function connectRealtime() {
  const s = getSocket();
  want = 'in';
  retriedForIn = false;
  if (personal) return;
  if (s.connected) { retriedForIn = true; s.disconnect().connect(); } // reconnect so the server sees our token and puts us in our rooms
  // else still connecting: the `ready` handler checks who we are once it is up
}

/** Drops the signed-in identity (call after the token has been cleared): the connection goes on, anonymously. */
export function disconnectRealtime() {
  tokenRefused = false;
  want = 'out';
  if (socket?.connected && personal) { personal = false; socket.disconnect().connect(); }
}
