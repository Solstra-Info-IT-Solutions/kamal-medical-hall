import { pool, hasAfterCommit, type Queryable } from './db.js';
import { emitPartner } from './realtime.js';

/**
 * off        – not checked in today (absent)
 * available  – on duty and free: can be assigned an order
 * reserved   – an order was assigned (waiting for the partner to accept, or accepted but not yet riding)
 * busy       – out on a delivery
 * returning  – delivered, riding back to the shop; becomes available automatically on arrival
 * break      – on duty but on a break; not assignable until the partner ends the break
 */
export type PartnerState = 'off' | 'available' | 'reserved' | 'busy' | 'returning' | 'break';

/** Today's calendar date in India. */
export const TODAY_IST = "(now() at time zone 'Asia/Kolkata')::date";

export async function setPartnerState(db: Queryable, partnerId: string, state: PartnerState) {
  await db.query('update delivery_partners set state = $2, is_available = ($2 = \'available\') where user_id = $1', [partnerId, state]);
  const emit = () => emitPartner(partnerId, state);
  if (hasAfterCommit(db)) db.afterCommit(emit); else emit();
}

/**
 * Works out a partner's state from what they are actually holding (a partner can have several orders at once):
 * any order out for delivery -> busy; otherwise any assigned order waiting to go out -> reserved; otherwise available
 * (on duty today and the shop open) or off. Call it after anything that adds or removes one of their orders.
 */
export async function releasePartner(db: Queryable, partnerId: string) {
  const { rows } = await db.query(`select
      (select count(*) from orders where partner_id = $1 and status = 'out_for_delivery')::int as out,
      (select count(*) from orders where partner_id = $1 and status in ('quoted', 'awaiting_payment', 'ready_to_dispatch'))::int as pending,
      (d.on_duty and d.on_duty_day = ${TODAY_IST}) as duty, (select is_open from store_settings where id = 1) as open
    from delivery_partners d where d.user_id = $1`, [partnerId]);
  const r = rows[0];
  const state: PartnerState = r?.out > 0 ? 'busy' : r?.pending > 0 ? 'reserved' : r?.duty && r?.open ? 'available' : 'off';
  await setPartnerState(db, partnerId, state);
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

/** Ends yesterday's duty for anyone who forgot to check out, and records absences for working days with no attendance. */
export async function sweepDuty() {
  const { rows } = await pool.query(`
    update delivery_partners set on_duty = false, state = 'off', is_available = false
    where on_duty and on_duty_day < ${TODAY_IST} and state in ('available', 'returning', 'break') returning user_id`);
  await pool.query(`update attendance set checked_out_at = coalesce(checked_out_at, now()),
      break_minutes = break_minutes + coalesce(floor(extract(epoch from now() - break_started_at) / 60)::int, 0), break_started_at = null
    where day < ${TODAY_IST} and checked_in_at is not null and (checked_out_at is null or break_started_at is not null)`);
  // A working day (store not closed) with no attendance row at all is an absence. Looks back a week so a sleeping server catches up.
  await pool.query(`
    insert into attendance (partner_id, day, status, checked_in_at)
    select u.id, g.day::date, 'absent', null
    from users u join delivery_partners d on d.user_id = u.id
    cross join generate_series(${TODAY_IST} - 7, ${TODAY_IST} - 1, interval '1 day') as g(day)
    where d.active and (u.created_at at time zone 'Asia/Kolkata')::date <= g.day::date
      and not exists (select 1 from store_closed_days s where s.day = g.day::date)
      and not exists (select 1 from attendance a where a.partner_id = u.id and a.day = g.day::date)
    on conflict do nothing`);
  for (const r of rows) emitPartner(r.user_id, 'off');
}
