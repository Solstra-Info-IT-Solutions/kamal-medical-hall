import { ApiError } from '../api/client';
import { devProvider, type OtpProvider } from './devProvider';

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
