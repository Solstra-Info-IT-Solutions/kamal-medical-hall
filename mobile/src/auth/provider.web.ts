import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from 'firebase/auth';
import { ApiError } from '../api/client';
import { firebaseWebApp, firebaseWebConfig } from '../firebaseWeb';
import { devProvider, type OtpProvider } from './devProvider';
import { autoProvider } from './serverProvider';

/**
 * Website sign-in. When the server sends OTPs itself (SMS gateway), that is used; otherwise Firebase phone auth through the browser SDK with an invisible reCAPTCHA.
 * (the site's domain must then be listed under Firebase > Authentication > Settings > Authorized domains).
 */
const firebaseWebProvider = (): OtpProvider => {
  const config = firebaseWebConfig;
  const auth = () => getAuth(firebaseWebApp());
  let confirmation: ConfirmationResult | null = null;
  let verifier: RecaptchaVerifier | null = null;
  const holder = () => {
    let el = document.getElementById('recaptcha-holder');
    if (!el) { el = document.createElement('div'); el.id = 'recaptcha-holder'; document.body.appendChild(el); }
    return el;
  };
  return {
    mode: 'firebase',
    async sendOtp(phone) {
      const a = auth();
      verifier?.clear();
      verifier = new RecaptchaVerifier(a, holder(), { size: 'invisible' });
      try {
        confirmation = await signInWithPhoneNumber(a, `+91${phone}`, verifier);
      } catch (e) {
        verifier.clear(); verifier = null;
        const code = (e as { code?: string }).code ?? '';
        throw new ApiError(0, 'send_failed', code === 'auth/too-many-requests' ? 'Too many attempts. Please try again later.' : code === 'auth/invalid-phone-number' ? 'Enter a valid mobile number.' : 'Could not send the OTP. Please try again.');
      }
    },
    async confirmOtp(code) {
      if (!confirmation) throw new ApiError(0, 'no_challenge', 'Please request a new OTP.');
      try { await confirmation.confirm(code); } catch { throw new ApiError(401, 'invalid_otp', 'Incorrect OTP'); }
      const token = await auth().currentUser?.getIdToken();
      if (!token) throw new ApiError(401, 'no_token', 'Sign in failed. Please try again.');
      return token;
    },
    async getToken() {
      if (!config) return null;
      const a = auth();
      await a.authStateReady();
      try { return (await a.currentUser?.getIdToken()) ?? null; } catch { return null; }
    },
    async refreshToken() {
      if (!config) return null;
      try { return (await auth().currentUser?.getIdToken(true)) ?? null; } catch { return null; }
    },
    signOut: async () => { try { await signOut(auth()); } catch { /* already signed out */ } },
  };
};

const mode = (process.env.EXPO_PUBLIC_AUTH_MODE ?? 'firebase') as 'dev' | 'firebase';
export const otpProvider: OtpProvider = mode === 'dev' ? devProvider() : autoProvider(firebaseWebProvider());
