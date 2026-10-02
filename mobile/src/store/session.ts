import { create } from 'zustand';
import { ApiError, configureApi } from '../api/client';
import { endpoints } from '../api/endpoints';
import type { User } from '../api/types';
import { otpProvider } from '../auth/provider';
import { setLanguage } from '../localization';
import { registerForPush } from '../push';

interface SessionState {
  status: 'loading' | 'out' | 'in';
  user: User | null;
  /** Set when the backend could not be reached while restoring a saved session. */
  bootError: string | null;
  bootstrap: () => Promise<void>;
  /** Called after OTP: exchanges the verified token for the server-side account and role. */
  login: (token: string) => Promise<{ needsProfile: boolean }>;
  updateProfile: (b: { name?: string; email?: string; language?: 'en' | 'hi' }) => Promise<void>;
  logout: () => Promise<void>;
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
      void registerForPush();
    } catch (error) {
      if (error instanceof ApiError && !error.isNetwork) return set({ status: 'out', user: null });
      set({ status: 'out', bootError: (error as Error).message });
    }
  },
  async login(token) {
    const { user, needsProfile } = await endpoints.session(token);
    set({ status: 'in', user, bootError: null });
    void registerForPush();
    return { needsProfile };
  },
  async updateProfile(b) {
    const { user } = await endpoints.updateMe(b);
    set({ user });
    if (b.language) await setLanguage(b.language);
  },
  async logout() {
    await otpProvider.signOut();
    set({ status: 'out', user: null });
  },
}));

configureApi({
  getToken: () => otpProvider.getToken(),
  onUnauthorized: () => { if (useSession.getState().status === 'in') void useSession.getState().logout(); },
});
