import { ApiError, api } from '../api/client';
import { logger } from '../core/logging';
import { devProvider, secure, type OtpProvider } from './devProvider';

/** Firebase's technical errors, in words a customer can act on. The code (never the phone number) goes to the logs. */
function otpError(e: unknown, step: 'send' | 'confirm'): ApiError {
  const code = String((e as { code?: string })?.code ?? 'unknown').replace('auth/', '');
  logger.warn(`otp ${step} failed`, { code });
  const message =
    code === 'invalid-phone-number' ? 'Please enter a valid 10-digit mobile number.' :
    code === 'too-many-requests' || code === 'quota-exceeded' ? 'Too many attempts. Please wait a few minutes and try again.' :
    code === 'network-request-failed' ? 'No internet connection. Please check your network and try again.' :
    code === 'invalid-verification-code' ? 'Incorrect OTP' :
    code === 'code-expired' || code === 'session-expired' ? 'This OTP has expired. Please request a new one.' :
    code === 'app-not-authorized' || code === 'missing-client-identifier' || code === 'invalid-app-credential' || code === 'captcha-check-failed' ? 'OTP could not be sent from this app version. Please contact the store.' :
    step === 'send' ? 'Could not send the OTP. Please try again.' : 'Incorrect OTP';
  return new ApiError(step === 'confirm' && message === 'Incorrect OTP' ? 401 : 0, step === 'confirm' && message === 'Incorrect OTP' ? 'invalid_otp' : `otp_${code}`, message);
}

const firebaseProvider = (): OtpProvider => {
  // Loaded lazily: the native module only exists in a dev/production build with google-services files.
  const fb = () => require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
  const auth = () => fb().getAuth();
  let confirmation: { confirm(code: string): Promise<unknown> } | null = null;
  return {
    mode: 'firebase',
    async sendOtp(phone) {
      try { confirmation = await fb().signInWithPhoneNumber(auth(), `+91${phone}`); } catch (e) { throw otpError(e, 'send'); }
    },
    async confirmOtp(code) {
      if (!confirmation) throw new ApiError(0, 'no_challenge', 'Please request a new OTP.');
      try {
        await confirmation.confirm(code);
      } catch (e) {
        throw otpError(e, 'confirm');
      }
      const token = await auth().currentUser?.getIdToken();
      if (!token) throw new ApiError(401, 'no_token', 'Sign in failed. Please try again.');
      return token;
    },
    async getToken() {
      try { return (await auth().currentUser?.getIdToken()) ?? null; } catch { return null; }
    },
    async refreshToken() {
      try { return (await auth().currentUser?.getIdToken(true)) ?? null; } catch { return null; }
    },
    signOut: async () => { try { await fb().signOut(auth()); } catch { /* already signed out */ } },
  };
};

/** SMS OTP through the server (Twilio Verify): the server checks the code and returns its own session token. */
const SESSION_KEY = 'kmh.sessionToken';
const twilioProvider = (): OtpProvider => {
  let phone = '';
  return {
    mode: 'twilio',
    async sendOtp(p) {
      phone = p;
      await api<void>('POST', '/auth/otp/send', { phone: p }, { auth: false, retry: 'never' });
    },
    async confirmOtp(code) {
      const { token } = await api<{ token: string }>('POST', '/auth/otp/verify', { phone, code }, { auth: false, retry: 'never' });
      await secure.set(SESSION_KEY, token);
      return token;
    },
    getToken: () => secure.get(SESSION_KEY),
    refreshToken: async () => null, // a session lasts 30 days; after that the person signs in again
    signOut: () => secure.del(SESSION_KEY),
  };
};

/**
 * The server decides how OTPs are sent (its AUTH_MODE: "twilio" or "firebase"), so switching needs no new app version.
 * A stored Twilio session wins; otherwise Firebase's signed-in user is used.
 */
const autoProvider = (): OtpProvider => {
  const firebase = firebaseProvider();
  const twilio = twilioProvider();
  let active: OtpProvider = firebase;
  return {
    get mode() { return active.mode; },
    async sendOtp(phone) {
      let useTwilio = false;
      try { useTwilio = (await api<{ authMode?: string }>('GET', '/config', undefined, { auth: false })).authMode === 'twilio'; } catch { /* server unreachable: fall back to Firebase */ }
      active = useTwilio ? twilio : firebase;
      return active.sendOtp(phone);
    },
    confirmOtp: (code) => active.confirmOtp(code),
    async getToken() { return (await twilio.getToken()) ?? firebase.getToken(); },
    async refreshToken() { return (await twilio.getToken()) ? null : firebase.refreshToken(); },
    async signOut() { await Promise.all([twilio.signOut(), firebase.signOut()]); },
  };
};

const mode = (process.env.EXPO_PUBLIC_AUTH_MODE ?? (__DEV__ ? 'dev' : 'firebase')) as 'dev' | 'firebase';
export const otpProvider: OtpProvider = mode === 'dev' ? devProvider() : autoProvider();
