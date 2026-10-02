import { create } from 'zustand';
import { endpoints } from '../api/endpoints';
import { isSupportedPincode as staticCheck } from '../constants/serviceArea';

interface PincodeState {
  list: Set<string> | null;
  load: () => Promise<void>;
  /** Uses the live list the admin manages; falls back to the bundled list only if the server was unreachable. */
  isServiceable: (pincode: string) => boolean;
}

export const usePincodes = create<PincodeState>((set, get) => ({
  list: null,
  async load() {
    try { set({ list: new Set((await endpoints.pincodes()).pincodes) }); } catch { /* keep fallback */ }
  },
  isServiceable: (pincode) => (get().list ? get().list!.has(pincode) : staticCheck(pincode)),
}));
