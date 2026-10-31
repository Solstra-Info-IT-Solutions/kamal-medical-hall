import { API_TRANSPORT, API_URL } from '../core/config';
import { ApiError } from '../core/errors/ApiError';
import { logger } from '../core/logging';
import { createHttpClient, type RequestOptions } from '../core/network/httpClient';
import { configureSocketAuth, getSocket } from '../core/network/socketClient';
import { createSocketFetch } from '../core/network/socketTransport';
import { setSlow } from '../core/network/status';

export { ApiError, API_URL };

let tokenProvider: () => Promise<string | null> = async () => null;
let tokenRefresher: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => undefined;
let onDeactivated: () => void = () => undefined;
export function configureApi(opts: { getToken: () => Promise<string | null>; refreshToken?: () => Promise<string | null>; onUnauthorized: () => void; onDeactivated?: () => void }) {
  tokenProvider = opts.getToken;
  tokenRefresher = opts.refreshToken ?? (async () => null);
  onUnauthorized = opts.onUnauthorized;
  onDeactivated = opts.onDeactivated ?? (() => undefined);
  configureSocketAuth({ getToken: () => tokenProvider(), refreshToken: () => tokenRefresher() });
}

const http = createHttpClient({
  baseUrl: API_URL,
  // Every request goes over the live socket; EXPO_PUBLIC_API_TRANSPORT=http switches back to plain HTTPS.
  fetchImpl: API_TRANSPORT === 'socket' ? createSocketFetch({ baseUrl: API_URL, getSocket, connectWaitMs: 70_000 }) : undefined,
  getToken: () => tokenProvider(),
  refreshToken: () => tokenRefresher(),
  onUnauthorized: () => onUnauthorized(),
  onSlowChange: setSlow,
  logger,
});

/** Production builds must talk HTTPS. A misconfigured build fails closed instead of sending anything in the clear. */
const insecure = !__DEV__ && !API_URL.startsWith('https://');

/** Backwards-compatible entry point used by `endpoints`. New code should depend on a repository, not call this directly. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: RequestOptions<T> = {}): Promise<T> {
  if (insecure) throw new ApiError(0, 'insecure_config', 'This version of the app is not set up correctly. Please update it.');
  try {
    return await http.request<T>(method, path, body, opts);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'account_deactivated') onDeactivated(); // the admin deactivated this account meanwhile
    throw e;
  }
}
