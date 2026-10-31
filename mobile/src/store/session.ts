import { create } from 'zustand';
import { ApiError, configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { AccountRequest, Gender, SignupProfile, User } from '../api/types';
import { otpProvider } from '../auth/provider';
import { setLanguage } from '../localization';
import { registerForPush, unregisterPush } from '../push';
import { setMonitoringUser } from '../monitoring';
import { connectRealtime, disconnectRealtime } from '../realtime';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  /** The customer's latest deactivate / reactivate request (shown on the account screens). */
  accountRequest: AccountRequest | null;
  /** Set when the backend could not be reached while restoring a saved session. */
  bootError: string | null;
  bootstrap: () => Promise<void>;
  /** Called after OTP: exchanges the verified token for the server-side account and role (and, for sign-up, creates it). */
  login: (token: string, opts?: { purpose?: 'login' | 'signup'; profile?: SignupProfile }) => Promise<{ needsProfile: boolean }>;
  /** Reloads the signed-in user and their account request (after a request was sent, or the admin decided one). */
  refresh: () => Promise<void>;
  updateProfile: (b: { name?: string; email?: string; language?: 'en' | 'hi'; gender?: Gender | null; dateOfBirth?: string | null; city?: string }) => Promise<void>;
  /** Sets (publicId) or removes (null) the profile picture. */
  setAvatar: (publicId: string | null) => Promise<void>;
  logout: () => Promise<void>;
  /** Permanently deletes the signed-in customer's account (server enforces the rules), then signs out. */
  deleteAccount: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  accountRequest: null,
  bootError: null,
  async bootstrap() {
    set({ status: 'loading', bootError: null });
    const token = await otpProvider.getToken();
    if (!token) return set({ status: 'out', user: null });
    try {
      // Render's free API instance can take 50+ seconds to wake after idling.
      // Bound session restoration to one wait so a broken socket cannot trap the app on its splash.
      const { user, accountRequest } = await endpoints.me({ timeoutMs: 65_000, retry: 'never' });
      set({ status: 'in', user, accountRequest: accountRequest ?? null });
      setMonitoringUser(user);
      connectRealtime();
      void registerForPush();
    } catch (error) {
      if (error instanceof ApiError && !error.isNetwork) return set({ status: 'out', user: null });
      set({ status: 'out', bootError: (error as Error).message });
    }
  },
  async login(token, opts) {
    let res;
    try {
      res = await endpoints.session(token, opts);
    } catch (e) {
      await otpProvider.signOut(); // the number was not allowed here (not registered / already registered): start over
      throw e;
    }
    const { user, needsProfile } = res;
    set({ status: 'in', user, accountRequest: null, bootError: null });
    setMonitoringUser(user);
    connectRealtime();
    void registerForPush();
    return { needsProfile };
  },
  async refresh() {
    try {
      const { user, accountRequest } = await endpoints.me();
      set({ user, accountRequest: accountRequest ?? null });
    } catch { /* keep what we have */ }
  },
  async updateProfile(b) {
    const { user } = await endpoints.updateMe(b);
    set({ user });
    if (b.language) await setLanguage(b.language);
  },
  async setAvatar(publicId) {
    const { user } = publicId ? await endpoints.setAvatar(publicId) : await endpoints.removeAvatar();
    set({ user });
  },
  async logout() {
    await unregisterPush();
    setMonitoringUser(null);
    await otpProvider.signOut();
    disconnectRealtime(); // after the token is gone, so the connection carries on anonymously
    set({ status: 'out', user: null, accountRequest: null });
  },
  async deleteAccount() {
    await endpoints.deleteAccount(); // the server already removed this phone's push token with the account
    await otpProvider.signOut();
    disconnectRealtime();
    set({ status: 'out', user: null });
  },
}));

configureApi({
  getToken: () => otpProvider.getToken(),
  refreshToken: () => otpProvider.refreshToken(),
  onUnauthorized: () => { if (useSession.getState().status === 'in') void useSession.getState().logout(); },
  onDeactivated: () => { if (useSession.getState().user?.isActive !== false) void useSession.getState().refresh(); },
});
