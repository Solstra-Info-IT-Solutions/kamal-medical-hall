import { create } from 'zustand';
import { ApiError, configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { User } from '../api/types';
import { otpProvider } from '../auth/provider';
import { setLanguage } from '../localization';
import { registerForPush, unregisterPush } from '../push';
import { setMonitoringUser } from '../monitoring';
import { connectRealtime, disconnectRealtime } from '../realtime';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  /** Set when the backend could not be reached while restoring a saved session. */
  bootError: string | null;
  bootstrap: () => Promise<void>;
  /** Called after OTP: exchanges the verified token for the server-side account and role. */
  login: (token: string) => Promise<{ needsProfile: boolean }>;
  updateProfile: (b: { name?: string; email?: string; language?: 'en' | 'hi' }) => Promise<void>;
  /** Sets (publicId) or removes (null) the profile picture. */
  setAvatar: (publicId: string | null) => Promise<void>;
  logout: () => Promise<void>;
  /** Permanently deletes the signed-in customer's account (server enforces the rules), then signs out. */
  deleteAccount: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  bootError: null,
  async bootstrap() {
    set({ status: 'loading', bootError: null });
    const token = await otpProvider.getToken();
    if (!token) return set({ status: 'out', user: null });
    try {
      const { user } = await endpoints.me();
      set({ status: 'in', user });
      setMonitoringUser(user);
      connectRealtime();
      void registerForPush();
    } catch (error) {
      if (error instanceof ApiError && !error.isNetwork) return set({ status: 'out', user: null });
      set({ status: 'out', bootError: (error as Error).message });
    }
  },
  async login(token) {
    const { user, needsProfile } = await endpoints.session(token);
    set({ status: 'in', user, bootError: null });
    setMonitoringUser(user);
    connectRealtime();
    void registerForPush();
    return { needsProfile };
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
    set({ status: 'out', user: null });
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
});
