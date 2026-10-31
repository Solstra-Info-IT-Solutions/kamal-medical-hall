
import { ServicePincode } from './models/ServicePincode.js';

let cache: { at: number; set: Set<string> } | null = null;

const TTL_MS = 30_000;

/**
 * Active delivery pincodes, managed by the store admin.
 * Cached briefly; changes clear the cache immediately.
 */
export async function servicePincodes(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return cache.set;
  }

  const rows = await ServicePincode.find({ active: true })
    .select('pincode')
    .lean();

  cache = {
    at: Date.now(),
    set: new Set(rows.map((row) => row.pincode)),
  };

  return cache.set;
}

export const isServiceable = async (pincode: string): Promise<boolean> =>
  (await servicePincodes()).has(pincode);

export const clearPincodeCache = (): void => {
  cache = null;
};
