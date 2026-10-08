import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';

export interface OtpProvider {
  mode: 'dev' | 'firebase' | 'twilio';
  sendOtp(phone: string): Promise<void>;
  /** Verifies the code and returns a bearer token for the backend. */
  confirmOtp(code: string): Promise<string>;
  getToken(): Promise<string | null>;
  /** Forces a new token (used once after the server answers 401). Null when the session cannot be renewed. */
  refreshToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

const TOKEN_KEY = 'kmh.devToken';
export const secure = {
  get: (k: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};

/** Local development only: the backend accepts OTP 123456 when started with AUTH_MODE=dev. */
export const devProvider = (): OtpProvider => {
  let phone = '';
  return {
    mode: 'dev',
    async sendOtp(p) { phone = p; },
    async confirmOtp(code) {
      try {
        const { token } = await endpoints.devLogin(phone, code);
        await secure.set(TOKEN_KEY, token);
        return token;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw new ApiError(401, 'invalid_otp', 'Incorrect OTP');
        throw e;
      }
    },
    getToken: () => secure.get(TOKEN_KEY),
    refreshToken: async () => null, // dev tokens last 30 days and cannot be renewed
    signOut: () => secure.del(TOKEN_KEY),
  };
};

