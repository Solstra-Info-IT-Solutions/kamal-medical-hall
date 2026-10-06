import Constants from 'expo-constants';
import { ApiError } from '../core/errors/ApiError';
import { logger } from '../core/logging';
import { createHttpClient, type RequestOptions } from '../core/network/httpClient';
import { setSlow } from '../core/network/status';

export { ApiError };

/** Set EXPO_PUBLIC_API_URL in .env (e.g. http://192.168.1.5:4000 for a phone on the same Wi-Fi). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000').replace(/\/$/, '');

let tokenProvider: () => Promise<string | null> = async () => null;
let tokenRefresher: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => undefined;
export function configureApi(opts: { getToken: () => Promise<string | null>; refreshToken?: () => Promise<string | null>; onUnauthorized: () => void }) {
  tokenProvider = opts.getToken;
  tokenRefresher = opts.refreshToken ?? (async () => null);
  onUnauthorized = opts.onUnauthorized;
}

const http = createHttpClient({
  baseUrl: API_URL,
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
  return http.request<T>(method, path, body, opts);
}
