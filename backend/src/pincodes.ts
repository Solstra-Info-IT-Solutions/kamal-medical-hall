import { pool } from './db.js';

let cache: { at: number; set: Set<string> } | null = null;
const TTL_MS = 30_000;

/** Active delivery pincodes, managed by the store admin. Cached briefly; changes clear the cache immediately. */
export async function servicePincodes(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;
  const { rows } = await pool.query('select pincode from service_pincodes where active');
  cache = { at: Date.now(), set: new Set(rows.map((r) => r.pincode as string)) };
  return cache.set;
}
export const isServiceable = async (pincode: string) => (await servicePincodes()).has(pincode);
export const clearPincodeCache = () => { cache = null; };
