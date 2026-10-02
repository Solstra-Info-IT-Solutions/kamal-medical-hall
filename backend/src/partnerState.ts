import { pool, hasAfterCommit, type Queryable } from './db.js';
import { emitPartner } from './realtime.js';

/**
 * off        – not checked in today (absent)
 * available  – on duty and free: can be assigned an order
 * reserved   – an order was assigned (waiting for the partner to accept, or accepted but not yet riding)
 * busy       – out on a delivery
 * returning  – delivered, riding back to the shop; becomes available automatically on arrival
 */
export type PartnerState = 'off' | 'available' | 'reserved' | 'busy' | 'returning';

/** Today's calendar date in India. */
export const TODAY_IST = "(now() at time zone 'Asia/Kolkata')::date";

export async function setPartnerState(db: Queryable, partnerId: string, state: PartnerState) {
  await db.query('update delivery_partners set state = $2, is_available = ($2 = \'available\') where user_id = $1', [partnerId, state]);
  const emit = () => emitPartner(partnerId, state);
  if (hasAfterCommit(db)) db.afterCommit(emit); else emit();
}

/** After an order ends, is cancelled or is rejected, a partner returns to "available" if still on duty today, otherwise "off". */
export async function releasePartner(db: Queryable, partnerId: string) {
  const { rows } = await db.query(`select (on_duty and on_duty_day = ${TODAY_IST}) as duty from delivery_partners where user_id = $1`, [partnerId]);
  await setPartnerState(db, partnerId, rows[0]?.duty ? 'available' : 'off');
}

/** Great-circle distance in metres. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough ETA for a scooter in city traffic (about 20 km/h) plus a couple of minutes to hand over. */
export const etaMinutes = (metres: number) => Math.max(1, Math.round((metres / 1000 / 20) * 60) + 2);

export async function storeLocation(db: Queryable = pool) {
  const { rows } = await db.query('select latitude, longitude, geofence_m from store_settings where id = 1');
  const r = rows[0];
  return r?.latitude != null && r?.longitude != null ? { lat: r.latitude as number, lng: r.longitude as number, geofenceM: r.geofence_m as number } : null;
}

/** Ends yesterday's duty for anyone who forgot to check out so attendance stays honest. */
export async function sweepDuty() {
  const { rows } = await pool.query(`
    update delivery_partners set on_duty = false, state = 'off', is_available = false
    where on_duty and on_duty_day < ${TODAY_IST} and state in ('available', 'returning') returning user_id`);
  await pool.query(`update attendance set checked_out_at = coalesce(checked_out_at, now()) where checked_out_at is null and day < ${TODAY_IST}`);
  for (const r of rows) emitPartner(r.user_id, 'off');
}
