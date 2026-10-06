import { getApps, initializeApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from 'firebase/auth';
import { ApiError } from '../api/client';
import { devProvider, type OtpProvider } from './devProvider';

/**
 * Website sign-in. Uses Firebase phone auth through the browser SDK with an invisible reCAPTCHA.
 * Set EXPO_PUBLIC_FIREBASE_WEB_CONFIG to the JSON of your Firebase *web app* config
 * (apiKey, authDomain, projectId, appId) and add the site's domain under Firebase > Authentication > Settings > Authorized domains.
 */
const firebaseWebProvider = (): OtpProvider => {
  const raw = process.env.EXPO_PUBLIC_FIREBASE_WEB_CONFIG;
  const config = raw ? (JSON.parse(raw) as Record<string, string>) : null;
  const auth = () => {
    if (!config) throw new ApiError(0, 'not_configured', 'Website sign-in is not configured yet.');
    const app = getApps()[0] ?? initializeApp(config);
    return getAuth(app);
  };
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
export const otpProvider: OtpProvider = mode === 'dev' ? devProvider() : firebaseWebProvider();
