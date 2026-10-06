import { create } from 'zustand';

/** True while a request has been waiting for several seconds (for example the server is waking up after being idle). */
export const useNetworkStatus = create<{ slow: boolean }>(() => ({ slow: false }));
export const setSlow = (slow: boolean) => useNetworkStatus.setState({ slow });
