import Constants from 'expo-constants';

/** Set EXPO_PUBLIC_API_URL in .env (e.g. http://192.168.1.5:4000 for a phone on the same Wi-Fi). */
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined);
const defaultApiUrl = __DEV__ ? 'http://localhost:4000' : 'https://api.kamalmedicalhall.com';
export const API_URL = (configuredApiUrl?.trim() || defaultApiUrl).replace(/\/$/, '');

/**
 * How the app talks to the API.
 *  - 'socket' (default): every request travels over the one live connection (the same one that delivers notifications).
 *  - 'http': ordinary HTTPS requests, for a server that has not been switched to socket-only yet.
 */
export const API_TRANSPORT: 'socket' | 'http' = process.env.EXPO_PUBLIC_API_TRANSPORT === 'http' ? 'http' : 'socket';
