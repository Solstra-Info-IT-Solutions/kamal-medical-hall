import { type Queryable } from './db.js';
import { conflict } from './http.js';
import { notifyMany } from './notify.js';
import { setPartnerState, TODAY_IST } from './partnerState.js';
import { emitAdmins } from './realtime.js';

export type DutyStatus = 'on_duty' | 'off_duty' | 'on_break' | 'leave';

/** Adds the running break (if any) to today's total and clears it. */
const ENDS_BREAK = `break_minutes = attendance.break_minutes + coalesce(floor(extract(epoch from now() - attendance.break_started_at) / 60)::int, 0), break_started_at = null`;

/**
 * The partner's own attendance: on duty, off duty, on break or leave. "Absent" is never chosen; the nightly sweep
 * records it for a working day with no attendance, and a closed store turns the day into paid leave.
 */
export async function setDutyStatus(c: Queryable, partnerId: string, status: DutyStatus, partnerName: string | null) {
  const p = await c.query(`select d.active, d.state, (select is_open from store_settings where id = 1) as store_open,
      (d.on_duty and d.on_duty_day = ${TODAY_IST}) as on_duty_today from delivery_partners d where d.user_id = $1 for update`, [partnerId]);
  const row = p.rows[0];
  if (!row?.active) throw conflict('Your account is not active.', 'inactive');
  const inOrder = ['reserved', 'busy'].includes(row.state);
  const riding = row.state === 'returning';

  if (status === 'on_duty') {
    if (!row.store_open) throw conflict('The store is closed today. Your day is marked as paid leave.', 'store_closed');
    await c.query(`update delivery_partners set on_duty = true, on_duty_day = ${TODAY_IST} where user_id = $1`, [partnerId]);
    await c.query(`insert into attendance (partner_id, day, status) values ($1, ${TODAY_IST}, 'present')
      on conflict (partner_id, day) do update set status = 'present', checked_in_at = coalesce(attendance.checked_in_at, now()), checked_out_at = null, ${ENDS_BREAK}`, [partnerId]);
    if (['off', 'break'].includes(row.state)) await setPartnerState(c, partnerId, 'available');
    return;
  }

  if (inOrder) throw conflict('Finish or hand back your current delivery first.', 'has_active_order');

  if (status === 'on_break') {
    if (!row.on_duty_today) throw conflict('Start your duty before taking a break.', 'not_on_duty');
    if (riding) throw conflict('Take your break once you are back at the shop.', 'still_returning');
    if (row.state === 'break') return;
    await c.query(`update attendance set break_started_at = now() where partner_id = $1 and day = ${TODAY_IST}`, [partnerId]);
    await setPartnerState(c, partnerId, 'break');
    return;
  }

  if (status === 'off_duty') {
    await c.query('update delivery_partners set on_duty = false where user_id = $1', [partnerId]);
    await c.query(`update attendance set checked_out_at = now(), ${ENDS_BREAK} where partner_id = $1 and day = ${TODAY_IST} and status = 'present' and checked_out_at is null`, [partnerId]);
    await setPartnerState(c, partnerId, 'off');
    return;
  }

  // leave
  await c.query('update delivery_partners set on_duty = false where user_id = $1', [partnerId]);
  await c.query(`insert into attendance (partner_id, day, status, checked_in_at) values ($1, ${TODAY_IST}, $2, null)
    on conflict (partner_id, day) do update set status = $2, checked_out_at = coalesce(attendance.checked_out_at, case when attendance.checked_in_at is not null then now() end), ${ENDS_BREAK}`,
    [partnerId, row.store_open ? 'leave' : 'paid_leave']);
  await setPartnerState(c, partnerId, 'off');
  emitAdmins('partner:update', { partnerId, state: 'off' });
  await notifyMany((await c.query("select id from users where role = 'admin'")).rows.map((r) => r.id), 'partner_leave', 'Leave marked', `${partnerName ?? 'A delivery partner'} marked leave for today`, c);
}

/**
 * The store closes for the day: customers and partners are told, and every partner who has not worked today
 * gets the day as paid leave. Partners already on a delivery finish it; they are checked out afterwards.
 */
export async function closeStore(c: Queryable) {
  await c.query(`insert into store_closed_days (day) values (${TODAY_IST}) on conflict do nothing`);
  const partners = (await c.query(`select d.user_id as id, d.state from delivery_partners d where d.active`)).rows as { id: string; state: string }[];
  const free = partners.filter((p) => !['reserved', 'busy', 'returning'].includes(p.state)).map((p) => p.id);
  const paid: string[] = [];
  for (const id of free) {
    const a = await c.query(`select status, checked_in_at from attendance where partner_id = $1 and day = ${TODAY_IST}`, [id]);
    const worked = a.rows[0]?.status === 'present' && a.rows[0]?.checked_in_at;
    if (worked) {
      await c.query(`update attendance set checked_out_at = coalesce(checked_out_at, now()), ${ENDS_BREAK} where partner_id = $1 and day = ${TODAY_IST}`, [id]);
    } else {
      await c.query(`insert into attendance (partner_id, day, status, checked_in_at) values ($1, ${TODAY_IST}, 'paid_leave', null)
        on conflict (partner_id, day) do update set status = 'paid_leave'`, [id]);
      paid.push(id);
    }
    await c.query('update delivery_partners set on_duty = false where user_id = $1', [id]);
    await setPartnerState(c, id, 'off');
  }
  const customers = (await c.query("select id from users where role = 'customer'")).rows.map((r) => r.id as string);
  await notifyMany(customers, 'store_closed', 'Store closed', 'Kamal Medical Hall is closed right now and is not taking new orders. We will let you know when we reopen.', c);
  await notifyMany(paid, 'store_closed', 'Store closed today', 'The store is closed today. Your day is marked as paid leave.', c);
  const worked = partners.map((p) => p.id).filter((id) => !paid.includes(id));
  await notifyMany(worked, 'store_closed', 'Store closed', 'The store is closed. Your duty for today has ended.', c);
}

/** The store reopens the same day: undo today's paid leave so partners can check in again. */
export async function reopenStore(c: Queryable) {
  await c.query(`delete from store_closed_days where day = ${TODAY_IST}`);
  const back = (await c.query(`delete from attendance where day = ${TODAY_IST} and status = 'paid_leave' returning partner_id`)).rows.map((r) => r.partner_id as string);
  const partners = (await c.query('select user_id as id from delivery_partners where active')).rows.map((r) => r.id as string);
  const customers = (await c.query("select id from users where role = 'customer'")).rows.map((r) => r.id as string);
  await notifyMany(customers, 'store_open', 'We are open', 'Kamal Medical Hall is open again. You can place your order now.', c);
  await notifyMany(partners, 'store_open', 'Store reopened', back.length ? 'The store is open again. Start your duty to receive deliveries.' : 'The store is open again.', c);
  emitAdmins('partner:update', {});
}
