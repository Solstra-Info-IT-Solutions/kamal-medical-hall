import { api } from '../api/client';
import { secure, type OtpProvider } from './devProvider';

/**
 * SMS OTP checked by our own server (its AUTH_MODE is "sms" for the PearlSMS gateway, or "twilio" for Twilio Verify).
 * The server sends the code, checks it and returns its own session token, which lasts 30 days.
 */
const SESSION_KEY = 'kmh.sessionToken';
export const serverOtpModes = ['sms', 'twilio'];

export const serverProvider = (): OtpProvider => {
  let phone = '';
  return {
    mode: 'sms',
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
    refreshToken: async () => null, // after 30 days the person signs in again
    signOut: () => secure.del(SESSION_KEY),
  };
};

/**
 * Lets the server decide how OTPs are sent, so switching needs no new app version: before each send it asks
 * /config, and uses the server OTP or the given Firebase provider. A stored server session wins at start-up.
 */
export const autoProvider = (firebase: OtpProvider): OtpProvider => {
  const server = serverProvider();
  let active: OtpProvider = firebase;
  return {
    get mode() { return active.mode; },
    async sendOtp(phone) {
      let useServer = false;
      try { useServer = serverOtpModes.includes((await api<{ authMode?: string }>('GET', '/config', undefined, { auth: false })).authMode ?? ''); } catch { /* server unreachable: fall back to Firebase */ }
      active = useServer ? server : firebase;
      return active.sendOtp(phone);
    },
    confirmOtp: (code) => active.confirmOtp(code),
    async getToken() { return (await server.getToken()) ?? firebase.getToken(); },
    async refreshToken() { return (await server.getToken()) ? null : firebase.refreshToken(); },
    async signOut() { await Promise.all([server.signOut(), firebase.signOut()]); },
  };
};
