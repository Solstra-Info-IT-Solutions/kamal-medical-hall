import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api/client';
import { otpProvider } from './auth/provider';

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();
let socket: Socket | null = null;

/** Subscribes to a server event ("notification", "order:update", "partner:update", "connect"). Returns an unsubscribe fn. */
export function onRealtime(event: string, fn: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  return () => { handlers.get(event)?.delete(fn); };
}
const fan = (event: string, payload?: unknown) => handlers.get(event)?.forEach((fn) => { try { fn(payload); } catch (e) { console.warn('realtime handler failed', e); } });

/**
 * Opens the real-time channel. The token is read again on every (re)connect so it never goes stale.
 * Safe to call repeatedly; it only ever keeps one connection.
 */
export function connectRealtime() {
  if (socket) return;
  socket = io(API_URL, {
    transports: ['websocket'],
    auth: (cb) => { void otpProvider.getToken().then((token) => cb({ token: token ?? '' })); },
    reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 8000,
  });
  for (const event of ['notification', 'order:update', 'partner:update', 'store:update', 'chat:message', 'chat:queue', 'chat:update']) socket.on(event, (p) => fan(event, p));
  // After a reconnect we may have missed events, so screens refresh themselves.
  socket.on('connect', () => fan('connect'));
}

export function disconnectRealtime() {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}
