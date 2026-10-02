import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { endpoints } from '../api/endpoints';
import { ApiError } from '../api/client';

export interface OtpProvider {
  mode: 'dev' | 'firebase';
  sendOtp(phone: string): Promise<void>;
  /** Verifies the code and returns a bearer token for the backend. */
  confirmOtp(code: string): Promise<string>;
  getToken(): Promise<string | null>;
  signOut(): Promise<void>;
}

const TOKEN_KEY = 'kmh.devToken';
const secure = {
  get: (k: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  set: (k: string, v: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  del: (k: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};

/** Local development only: the backend accepts OTP 123456 when started with AUTH_MODE=dev. */
const devProvider = (): OtpProvider => {
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
    signOut: () => secure.del(TOKEN_KEY),
  };
};

const firebaseProvider = (): OtpProvider => {
  // Loaded lazily: the native module only exists in a dev/production build with google-services files.
  const fb = () => require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
  const auth = () => fb().getAuth();
  let confirmation: { confirm(code: string): Promise<unknown> } | null = null;
  return {
    mode: 'firebase',
    async sendOtp(phone) {
      confirmation = await fb().signInWithPhoneNumber(auth(), `+91${phone}`);
    },
    async confirmOtp(code) {
      if (!confirmation) throw new ApiError(0, 'no_challenge', 'Please request a new OTP.');
      try {
        await confirmation.confirm(code);
      } catch {
        throw new ApiError(401, 'invalid_otp', 'Incorrect OTP');
      }
      const token = await auth().currentUser?.getIdToken();
      if (!token) throw new ApiError(401, 'no_token', 'Sign in failed. Please try again.');
      return token;
    },
    async getToken() {
      try { return (await auth().currentUser?.getIdToken()) ?? null; } catch { return null; }
    },
    signOut: async () => { try { await fb().signOut(auth()); } catch { /* already signed out */ } },
  };
};

const mode = (process.env.EXPO_PUBLIC_AUTH_MODE ?? (__DEV__ ? 'dev' : 'firebase')) as 'dev' | 'firebase';
export const otpProvider: OtpProvider = mode === 'dev' ? devProvider() : firebaseProvider();
