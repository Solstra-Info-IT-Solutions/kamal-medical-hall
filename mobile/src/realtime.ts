/** Server events (notifications, order updates, chat) arrive on the same live connection that carries API requests. */
export { connectRealtime, disconnectRealtime, onRealtime } from './core/network/socketClient';
