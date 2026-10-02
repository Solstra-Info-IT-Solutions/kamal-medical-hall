import Constants from 'expo-constants';

/** Set EXPO_PUBLIC_API_URL in .env (e.g. http://192.168.1.5:4000 for a phone on the same Wi-Fi). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  get isNetwork() { return this.status === 0; }
  get isAuth() { return this.status === 401; }
}

let tokenProvider: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => undefined;
export function configureApi(opts: { getToken: () => Promise<string | null>; onUnauthorized: () => void }) {
  tokenProvider = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { auth?: boolean; timeoutMs?: number; token?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const token = opts.token ?? (opts.auth === false ? null : await tokenProvider());
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && opts.auth !== false && !opts.token) onUnauthorized();
      throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong. Please try again.');
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
