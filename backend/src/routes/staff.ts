import { Router } from 'express';
import { z } from 'zod';
import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { bad, bad as bad_, conflict, notFound, parse } from '../http.js';
import { cashToCollect, closingMessage, closingSummary, settleCash } from '../cash.js';
import { notify, notifyAdmins } from '../notify.js';
import { CANCELLABLE, loadOrder, transition, type OrderStatus } from '../orderService.js';
import { closeStore, reopenStore, setDutyStatus, type DutyStatus } from '../dutyService.js';
import { distanceMeters, etaMinutes, releasePartner, setPartnerState, storeLocation, TODAY_IST } from '../partnerState.js';
import { clearPincodeCache } from '../pincodes.js';
import { isBlockedFile } from '../services.js';
import { emitAdmins, emitUser } from '../realtime.js';

export const adminRouter = Router();
export const partnerRouter = Router();

adminRouter.use(authed, requireRole('admin'));
partnerRouter.use(authed, requireRole('delivery_partner'));

const listRow = (r: Record<string, any>) => ({
  id: r.id, orderNumber: r.order_number, kind: r.kind, status: r.status, createdAt: r.created_at,
  quotedAmount: r.quoted_amount === null ? null : Number(r.quoted_amount),
  paymentMethod: r.payment_method, paymentStatus: r.payment_status,
  customerName: r.customer_name, customerPhone: r.customer_phone, deliverySlot: r.delivery_slot, deliveryDate: r.delivery_date,
  partnerName: r.partner_name ?? null, fileCount: Number(r.file_count ?? 0), summary: r.summary ?? null,
  partnerAccepted: Boolean(r.partner_accepted_at), pincode: r.address_snapshot?.pincode ?? null,
  rejectedReason: r.assignment_reason ?? undefined, respondedAt: r.assignment_at ?? undefined,
});
const LIST_SQL = `
  select o.*, c.name as customer_name, c.phone as customer_phone, p.name as partner_name,
         (select count(*) from prescriptions x where x.order_id = o.id) as file_count,
         (select string_agg(name || ' x' || quantity, ', ') from order_items i where i.order_id = o.id) as summary
  from orders o join users c on c.id = o.customer_id left join users p on p.id = o.partner_id`;

/** A partner who is flagged on duty but from an earlier day is treated as off duty. */
const EFFECTIVE_STATE = `case when d.state in ('available','returning','break') and not (d.on_duty and d.on_duty_day = ${TODAY_IST}) then 'off' else d.state end`;

/** What the partner has told us about today: on duty, off duty, on break, leave or absent. */
const DUTY_STATUS = `case when a.status in ('leave','paid_leave') then 'leave' when a.status = 'absent' then 'absent'
  when (${EFFECTIVE_STATE}) = 'break' then 'on_break' when d.on_duty and d.on_duty_day = ${TODAY_IST} then 'on_duty' else 'off_duty' end`;

// ============================================================ Admin
/** Cash that delivery partners collected and still have to hand over, per partner. */
adminRouter.get('/cash', async (_req, res) => { res.json(await cashToCollect()); });
/** Admin received the cash from a partner (all of it, or only the listed orders). */
adminRouter.post('/cash/settle', async (req, res) => {
  const b = parse(z.object({ partnerId: z.string().uuid(), orderIds: z.array(z.string().uuid()).max(200).optional() }), req.body);
  const r = await settleCash(req.user!.id, b.partnerId, b.orderIds);
  if (!r.settled) throw conflict('There is no cash to collect from this partner.', 'nothing_to_settle');
  emitAdmins('cash:update', { partnerId: b.partnerId });
  res.json({ ...r, ...(await cashToCollect()) });
});
/** What the "store closes in one hour" alert shows, available on demand too. */
adminRouter.get('/closing-summary', async (_req, res) => { const s = await closingSummary(); res.json({ ...s, message: closingMessage(s) }); });

adminRouter.get('/dashboard', async (_req, res) => {
  const { rows } = await pool.query(`
    select count(*) filter (where status = 'requested') as requested,
           count(*) filter (where status in ('quoted','accepted','awaiting_payment')) as awaiting,
           count(*) filter (where status = 'ready_to_dispatch') as ready,
           count(*) filter (where status = 'out_for_delivery') as out_for_delivery,
           count(*) filter (where status = 'delivered' and updated_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as delivered_today,
           coalesce(sum(quoted_amount) filter (where status = 'delivered' and updated_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0) as sales_today
    from orders`);
  const r = rows[0];
  const open = (await pool.query('select is_open from store_settings where id = 1')).rows[0]?.is_open ?? true;
  res.json({ isOpen: open, requested: +r.requested, awaitingPayment: +r.awaiting, readyToDispatch: +r.ready, outForDelivery: +r.out_for_delivery, deliveredToday: +r.delivered_today, salesToday: Number(r.sales_today) });
});

adminRouter.get('/orders', async (req, res) => {
  const q = parse(z.object({
    status: z.string().optional(), search: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30), offset: z.coerce.number().int().min(0).default(0),
  }), req.query);
  const statuses = q.status?.split(',').filter(Boolean) ?? [];
  const { rows } = await pool.query(
    `${LIST_SQL} where ($1::text[] = '{}' or o.status::text = any($1)) and ($2::text is null or o.order_number ilike '%' || $2 || '%' or c.phone like '%' || $2 || '%' or c.name ilike '%' || $2 || '%')
     order by o.created_at desc limit $3 offset $4`,
    [statuses, q.search ?? null, q.limit, q.offset],
  );
  res.json({ orders: rows.map(listRow), hasMore: rows.length === q.limit });
});

adminRouter.post('/orders/:id/quote', async (req, res) => {
  // The bill is mandatory: the customer downloads it from the order.
  const { amount, bill } = parse(z.object({
    amount: z.number().positive().max(500000),
    bill: z.object({ publicId: z.string().min(3).max(300), mimeType: z.string().min(3).max(120), resourceType: z.enum(['image', 'raw', 'video']).default('image'), sizeBytes: z.number().int().min(0).max(30_000_000).optional(), name: z.string().trim().max(160).optional() }, { error: 'Please attach the bill.' }),
  }), req.body);
  if (!bill.publicId.startsWith('bills/') || isBlockedFile(bill.publicId) || isBlockedFile(bill.name ?? '')) throw bad('Invalid bill file.', 'invalid_file');
  const order = await loadOrder(String(req.params.id), req.user!);
  const expires = new Date(Date.now() + config.quoteValidHours * 3600000);
  const fields = {
    quoted_amount: amount, quote_expires_at: expires, reviewed_by: req.user!.id,
    bill_public_id: bill.publicId, bill_mime: bill.mimeType, bill_resource_type: bill.resourceType, bill_name: bill.name ?? null, bill_size: bill.sizeBytes ?? null, bill_uploaded_at: new Date(),
  };
  // The admin decides whether customers see the "accept the amount" page. When they do not, the amount is confirmed
  // straight away as pay on delivery (cash or UPI to the delivery partner) and the order is ready to dispatch.
  const acceptRequired = (await pool.query('select customer_accept_required from store_settings where id = 1')).rows[0]?.customer_accept_required !== false;
  await tx(async (c) => {
    if (acceptRequired || order.status === 'quoted') {
      await transition(c, order.id, ['requested', 'quoted'], 'quoted', req.user!.id, fields);
      await notify(order.customer!.id, order.id, 'quote_ready', 'Your order amount is ready', `${order.orderNumber}: pay ₹${amount} (free delivery). Please review and accept.`, c);
      return;
    }
    await transition(c, order.id, ['requested'], 'ready_to_dispatch', req.user!.id, { ...fields, payment_method: 'cod', payment_status: 'cod_pending' });
    await c.query('delete from payments where order_id = $1 and status = $2', [order.id, 'pending']);
    await c.query("insert into payments (order_id, method, amount, status) values ($1, 'cod', $2, 'cod_pending')", [order.id, amount]);
    await notify(order.customer!.id, order.id, 'order_confirmed', 'Your order is confirmed', `${order.orderNumber}: ₹${amount} (free delivery). Pay on delivery by cash or UPI. The bill is in your order.`, c);
    const partner = (await c.query('select partner_id from orders where id = $1', [order.id])).rows[0]?.partner_id as string | undefined;
    if (partner) await notify(partner, order.id, 'order_confirmed', 'Order confirmed', `${order.orderNumber} is confirmed. You can start the delivery when you are ready.`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/reject', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    await transition(c, order.id, ['requested'], 'rejected', req.user!.id, { rejection_reason: reason, reviewed_by: req.user!.id }, reason);
    await notify(order.customer!.id, order.id, 'order_rejected', 'Order could not be accepted', `${order.orderNumber}: ${reason}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/cancel', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const prev = await c.query('select partner_id from orders where id = $1', [order.id]);
    await transition(c, order.id, CANCELLABLE, 'cancelled', req.user!.id, { cancel_reason: reason, cancelled_by: req.user!.id, partner_id: null, partner_accepted_at: null }, reason);
    const partnerId = prev.rows[0]?.partner_id as string | undefined;
    await c.query("update assignments set status = 'cancelled', responded_at = coalesce(responded_at, now()) where order_id = $1 and status in ('pending','accepted')", [order.id]);
    if (partnerId) {
      await releasePartner(c, partnerId);
      await notify(partnerId, order.id, 'order_cancelled', 'Delivery cancelled', `${order.orderNumber} was cancelled by the store`, c);
    }
    await notify(order.customer!.id, order.id, 'order_cancelled', 'Order cancelled by the store', `${order.orderNumber}: ${reason}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

/**
 * Sends the order to a partner who covers the pincode, whether they are on duty or off, and even if they already hold other
 * orders (a partner can carry several). It can be done as soon as the amount is sent, without waiting for the customer to
 * confirm: the partner accepts now and can start the ride once the customer has confirmed.
 */
const ASSIGNABLE: OrderStatus[] = ['quoted', 'awaiting_payment', 'ready_to_dispatch'];
adminRouter.post('/orders/:id/assign', async (req, res) => {
  const { partnerId } = parse(z.object({ partnerId: z.string().uuid() }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  if (order.partner) throw conflict('This order already has a delivery partner. Unassign first.', 'already_assigned');
  if (!ASSIGNABLE.includes(order.status)) throw conflict('A delivery partner can be assigned once the amount has been sent.', 'invalid_state');
  await tx(async (c) => {
    const cover = await c.query('select pincode from partner_pincodes where partner_id = $1', [partnerId]);
    if (cover.rows.length && !cover.rows.some((r) => r.pincode === order.address.pincode)) throw conflict('That delivery partner does not cover this pincode.', 'out_of_coverage');
    const p = await c.query('select state, active from delivery_partners where user_id = $1 for update', [partnerId]);
    if (!p.rows[0]?.active) throw conflict('That delivery partner is not active.', 'partner_unavailable');
    // Free partners become "reserved"; ones already riding or holding orders keep their state (busy stays busy).
    if (['available', 'off', 'break'].includes(p.rows[0].state)) await setPartnerState(c, partnerId, 'reserved');
    await c.query("insert into assignments (order_id, partner_id) values ($1, $2)", [order.id, partnerId]);
    await transition(c, order.id, ASSIGNABLE, order.status, req.user!.id, { partner_id: partnerId, partner_accepted_at: null }, 'Partner assigned');
    const waiting = order.status !== 'ready_to_dispatch';
    await notify(partnerId, order.id, 'assigned', 'New delivery request', `${order.orderNumber} to ${order.address.line1}.${waiting ? ' The customer has not confirmed yet; you can accept now.' : ' Please accept or reject.'}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

/** Takes the order back from its delivery partner at any point before delivery (no response, wrong partner, partner out of reach) so it can be assigned again. */
adminRouter.post('/orders/:id/unassign', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const prev = await c.query('select partner_id from orders where id = $1 for update', [order.id]);
    const partnerId = prev.rows[0]?.partner_id as string | null;
    if (!partnerId) throw conflict('No delivery partner is assigned.', 'not_assigned');
    const wasOut = order.status === 'out_for_delivery';
    await transition(c, order.id, [...ASSIGNABLE, 'out_for_delivery'], wasOut ? 'ready_to_dispatch' : order.status, req.user!.id, { partner_id: null, partner_accepted_at: null }, 'Partner unassigned');
    await c.query("update assignments set status = 'cancelled', responded_at = coalesce(responded_at, now()) where order_id = $1 and status in ('pending','accepted')", [order.id]);
    await releasePartner(c, partnerId);
    await notify(partnerId, order.id, 'unassigned', 'Delivery removed', `${order.orderNumber} was taken back by the store`, c);
    if (wasOut) await notify(order.customer!.id, order.id, 'reassigning', 'Delivery being reassigned', `${order.orderNumber} will be handed to another delivery partner shortly.`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.get('/partners', async (_req, res) => {
  const { rows } = await pool.query(`
    select u.id, u.name, u.phone, d.active, d.can_call_customer, ${EFFECTIVE_STATE} as state,
      (d.on_duty and d.on_duty_day = ${TODAY_IST}) as on_duty, d.last_seen, d.last_lat, d.last_lng,
      a.checked_in_at, a.checked_out_at, ${DUTY_STATUS} as duty_status, (a.status = 'paid_leave') as paid_leave, coalesce(a.break_minutes,0) as break_minutes,
      (select count(*) from orders o where o.partner_id = u.id and o.status in ('quoted','awaiting_payment','ready_to_dispatch','out_for_delivery')) as active_orders,
      (select count(*) from assignments x where x.partner_id = u.id and x.status = 'completed' and x.completed_at >= (${TODAY_IST})::timestamp at time zone 'Asia/Kolkata') as delivered_today,
      (select coalesce(array_agg(pp.pincode order by pp.pincode), '{}') from partner_pincodes pp where pp.partner_id = u.id) as pincodes,
      (select coalesce(sum(o.quoted_amount),0) from orders o join payments p on p.order_id = o.id
        where o.partner_id = u.id and p.status = 'cod_collected' and o.updated_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as cod_today
    from users u join delivery_partners d on d.user_id = u.id
    left join attendance a on a.partner_id = u.id and a.day = ${TODAY_IST}
    order by u.name`);
  res.json({ partners: rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, active: r.active, state: r.state, isAvailable: r.state === 'available', onDuty: r.on_duty,
    dutyStatus: r.duty_status, paidLeave: r.paid_leave, breakMinutes: +r.break_minutes, canCallCustomer: r.can_call_customer, checkedInAt: r.on_duty ? r.checked_in_at : r.checked_in_at ?? null, checkedOutAt: r.checked_out_at, lastSeen: r.last_seen,
    activeOrders: +r.active_orders, deliveredToday: +r.delivered_today, codCollectedToday: Number(r.cod_today), pincodes: r.pincodes,
  })) });
});

/** Attendance for today plus a day-by-day strip for the last N days. */
adminRouter.get('/attendance', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }), req.query);
  const [partners, marks, closed] = await Promise.all([
    pool.query(`select u.id, u.name, u.phone, d.active, ${EFFECTIVE_STATE} as state, ${DUTY_STATUS} as duty_status, (a.status = 'paid_leave') as paid_leave,
                  a.checked_in_at, a.checked_out_at, coalesce(a.break_minutes, 0) as break_minutes
                from users u join delivery_partners d on d.user_id = u.id left join attendance a on a.partner_id = u.id and a.day = ${TODAY_IST}
                where d.active order by u.name`),
    pool.query(`select partner_id, to_char(day, 'YYYY-MM-DD') as day, status from attendance where day > ${TODAY_IST} - $1::int`, [days]),
    pool.query("select to_char(day, 'YYYY-MM-DD') as day from store_closed_days"),
  ]);
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() + 5.5 * 3600000 - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  const marked = new Map<string, Map<string, string>>();
  for (const m of marks.rows) { if (!marked.has(m.partner_id)) marked.set(m.partner_id, new Map()); marked.get(m.partner_id)!.set(m.day, m.status); }
  const today = partners.rows.map((r) => ({
    id: r.id, name: r.name, phone: r.phone, state: r.state, dutyStatus: r.duty_status as string, paidLeave: r.paid_leave === true,
    present: r.checked_in_at != null, checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at, breakMinutes: +r.break_minutes,
    // Nobody has checked in or applied for leave: counted as absent for today.
    notIn: r.duty_status === 'off_duty' && r.checked_in_at == null,
  }));
  const n = (f: (p: (typeof today)[number]) => boolean) => today.filter(f).length;
  res.json({
    dates,
    closedDays: closed.rows.map((r) => r.day),
    today,
    summary: {
      total: today.length, present: n((p) => p.present),
      onDuty: n((p) => p.dutyStatus === 'on_duty'), onBreak: n((p) => p.dutyStatus === 'on_break'),
      offDuty: n((p) => p.dutyStatus === 'off_duty' && p.present), onLeave: n((p) => p.dutyStatus === 'leave'),
      absent: n((p) => p.notIn || p.dutyStatus === 'absent'),
      available: n((p) => p.state === 'available'),
      busy: n((p) => ['reserved', 'busy', 'returning'].includes(p.state)),
    },
    history: partners.rows.map((r) => ({ id: r.id, name: r.name, days: dates.map((d) => marked.get(r.id)?.get(d) ?? null) })),
  });
});

adminRouter.post('/partners', async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().transform(normalisePhone) }), req.body);
  const id = await tx(async (c) => {
    const existing = await c.query('select id, role from users where phone = $1', [b.phone]);
    if (existing.rows[0] && existing.rows[0].role !== 'delivery_partner') throw conflict('This number already belongs to another account type.', 'phone_in_use');
    const u = await c.query(`insert into users (phone, name, role) values ($1,$2,'delivery_partner')
      on conflict (phone) do update set name = excluded.name returning id`, [b.phone, b.name]);
    await c.query('insert into delivery_partners (user_id) values ($1) on conflict do nothing', [u.rows[0].id]);
    return u.rows[0].id as string;
  });
  res.status(201).json({ id });
});

adminRouter.patch('/partners/:id', async (req, res) => {
  const b = parse(z.object({ active: z.boolean().optional(), canCallCustomer: z.boolean().optional() }), req.body);
  if (b.active === undefined && b.canCallCustomer === undefined) throw bad('Nothing to change.');
  const { rowCount } = await pool.query(
    `update delivery_partners set
       active = coalesce($2, active),
       can_call_customer = coalesce($3, can_call_customer),
       state = case when $2 = false and state in ('available','returning') then 'off' else state end,
       is_available = case when $2 = false then false else is_available end,
       on_duty = case when $2 = false then false else on_duty end
     where user_id = $1`, [req.params.id, b.active ?? null, b.canCallCustomer ?? null]);
  if (!rowCount) throw notFound('Partner not found');
  emitAdmins('partner:update', { partnerId: req.params.id });
  emitUser(String(req.params.id), 'partner:update', { partnerId: req.params.id });
  res.status(204).end();
});

/** Admin override, e.g. a partner forgot to check in, or their phone cannot report a location when they return. */
adminRouter.post('/partners/:id/state', async (req, res) => {
  const { state } = parse(z.object({ state: z.enum(['available', 'off']) }), req.body);
  await tx(async (c) => {
    const p = await c.query('select state, active from delivery_partners where user_id = $1 for update', [req.params.id]);
    if (!p.rows[0]) throw notFound('Partner not found');
    if (['reserved', 'busy'].includes(p.rows[0].state)) throw conflict('This partner has an order in progress.', 'has_active_order');
    if (state === 'available' && !p.rows[0].active) throw conflict('This partner is inactive.', 'inactive');
    await c.query(`update delivery_partners set on_duty = $2, on_duty_day = case when $2 then ${TODAY_IST} else on_duty_day end where user_id = $1`, [req.params.id, state === 'available']);
    if (state === 'available') await c.query(`insert into attendance (partner_id, day) values ($1, ${TODAY_IST}) on conflict (partner_id, day) do update set status = 'present', checked_in_at = coalesce(attendance.checked_in_at, now()), checked_out_at = null`, [req.params.id]);
    else await c.query(`update attendance set checked_out_at = now() where partner_id = $1 and day = ${TODAY_IST} and checked_out_at is null`, [req.params.id]);
    await setPartnerState(c, String(req.params.id), state);
  });
  res.status(204).end();
});

adminRouter.put('/partners/:id/pincodes', async (req, res) => {
  const { pincodes } = parse(z.object({ pincodes: z.array(z.string().regex(/^\d{6}$/)).max(300) }), req.body);
  const unique = [...new Set(pincodes)];
  if (unique.length) {
    const ok = await pool.query('select pincode from service_pincodes where pincode = any($1)', [unique]);
    const bad = unique.filter((p) => !ok.rows.some((r) => r.pincode === p));
    if (bad.length) throw bad_(`Not in the delivery area: ${bad.join(', ')}`);
  }
  await tx(async (c) => {
    const exists = await c.query('select 1 from delivery_partners where user_id = $1', [req.params.id]);
    if (!exists.rows[0]) throw notFound('Partner not found');
    await c.query('delete from partner_pincodes where partner_id = $1', [req.params.id]);
    for (const p of unique) await c.query('insert into partner_pincodes (partner_id, pincode) values ($1,$2)', [req.params.id, p]);
  });
  res.status(204).end();
});

// ---- Delivery area (pincodes) ----
adminRouter.get('/pincodes', async (_req, res) => {
  const { rows } = await pool.query('select pincode, area, active from service_pincodes order by pincode');
  res.json({ pincodes: rows });
});
adminRouter.post('/pincodes', async (req, res) => {
  const b = parse(z.object({ pincodes: z.array(z.string().regex(/^\d{6}$/, 'Pincodes must be 6 digits')).min(1).max(200), area: z.string().trim().max(80).optional() }), req.body);
  for (const p of new Set(b.pincodes)) {
    await pool.query(`insert into service_pincodes (pincode, area) values ($1,$2) on conflict (pincode) do update set active = true, area = coalesce($2, service_pincodes.area)`, [p, b.area ?? null]);
  }
  clearPincodeCache();
  res.status(201).json({ added: new Set(b.pincodes).size });
});
adminRouter.patch('/pincodes/:pincode', async (req, res) => {
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  const { rowCount } = await pool.query('update service_pincodes set active = $2 where pincode = $1', [req.params.pincode, active]);
  if (!rowCount) throw notFound('Pincode not found');
  clearPincodeCache();
  res.status(204).end();
});
adminRouter.delete('/pincodes/:pincode', async (req, res) => {
  const { rowCount } = await pool.query('delete from service_pincodes where pincode = $1', [req.params.pincode]);
  if (!rowCount) throw notFound('Pincode not found');
  await pool.query('delete from partner_pincodes where pincode = $1', [req.params.pincode]);
  clearPincodeCache();
  res.status(204).end();
});

adminRouter.get('/reports', async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(1).max(366).default(30) }), req.query);
  const [daily, split, perPartner] = await Promise.all([
    pool.query(`select to_char((updated_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*) as orders, coalesce(sum(quoted_amount),0) as sales
                from orders where status = 'delivered' and updated_at >= now() - ($1 || ' days')::interval group by 1 order by 1 desc`, [q.days]),
    pool.query(`select payment_method, count(*) as orders, coalesce(sum(quoted_amount),0) as sales from orders
                where status = 'delivered' and updated_at >= now() - ($1 || ' days')::interval group by 1`, [q.days]),
    pool.query(`select u.name, count(*) as orders from orders o join users u on u.id = o.partner_id
                where o.status = 'delivered' and o.updated_at >= now() - ($1 || ' days')::interval group by u.name order by 2 desc`, [q.days]),
  ]);
  res.json({
    days: q.days,
    daily: daily.rows.map((r) => ({ day: r.day, orders: +r.orders, sales: Number(r.sales) })),
    paymentSplit: split.rows.map((r) => ({ method: r.payment_method, orders: +r.orders, sales: Number(r.sales) })),
    perPartner: perPartner.rows.map((r) => ({ name: r.name, orders: +r.orders })),
  });
});

const settingsSchema = z.object({
  isOpen: z.boolean(), openingTime: z.string().regex(/^\d{2}:\d{2}$/), closingTime: z.string().regex(/^\d{2}:\d{2}$/),
  address: z.string().trim().max(300).nullable().optional(), phone: z.string().trim().max(20).nullable().optional(), email: z.string().trim().max(120).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceM: z.number().int().min(30).max(2000).optional(),
  /** After this time of day customers can only choose dates from tomorrow; before it, today is included. */
  orderCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** Whether customers see the page to accept the amount (and choose how to pay). Off: confirmed as pay on delivery. */
  customerAcceptRequired: z.boolean().optional(),
});
adminRouter.get('/settings', async (_req, res) => {
  const { rows } = await pool.query('select * from store_settings where id = 1');
  const s = rows[0];
  res.json({ isOpen: s.is_open, openingTime: s.opening_time, closingTime: s.closing_time, address: s.address, phone: s.phone, email: s.email, latitude: s.latitude, longitude: s.longitude, geofenceM: s.geofence_m, orderCutoffTime: s.order_cutoff_time, customerAcceptRequired: s.customer_accept_required });
});
adminRouter.put('/settings', async (req, res) => {
  const s = parse(settingsSchema, req.body);
  await tx(async (c) => {
  const before = (await c.query('select is_open from store_settings where id = 1 for update')).rows[0]?.is_open as boolean | undefined;
  await c.query('update store_settings set is_open=$1, opening_time=$2, closing_time=$3, address=coalesce($4, address), phone=coalesce($5, phone), email=coalesce($6, email), latitude=$7, longitude=$8, geofence_m=coalesce($9, geofence_m), order_cutoff_time=coalesce($10, order_cutoff_time), customer_accept_required=coalesce($11, customer_accept_required) where id = 1',
    [s.isOpen, s.openingTime, s.closingTime, s.address ?? null, s.phone ?? null, s.email ?? null, s.latitude ?? null, s.longitude ?? null, s.geofenceM ?? null, s.orderCutoffTime ?? null, s.customerAcceptRequired ?? null]);
  if (before && !s.isOpen) await closeStore(c);
  else if (before === false && s.isOpen) await reopenStore(c);
  });
  res.status(204).end();
});

/** Quick open / closed switch. Closing notifies customers and partners and gives partners paid leave. */
adminRouter.put('/store-open', async (req, res) => {
  const { isOpen } = parse(z.object({ isOpen: z.boolean() }), req.body);
  await tx(async (c) => {
    const before = (await c.query('select is_open from store_settings where id = 1 for update')).rows[0]?.is_open as boolean | undefined;
    await c.query('update store_settings set is_open = $1 where id = 1', [isOpen]);
    if (before && !isOpen) await closeStore(c);
    else if (before === false && isOpen) await reopenStore(c);
  });
  emitAdmins('store:update', { isOpen });
  res.json({ isOpen });
});

// ---- Terms & conditions (shown to customers in the app) ----
adminRouter.get('/terms', async (_req, res) => {
  const { rows } = await pool.query('select terms_text, terms_updated_at from store_settings where id = 1');
  res.json({ text: rows[0].terms_text ?? '', updatedAt: rows[0].terms_updated_at });
});
adminRouter.put('/terms', async (req, res) => {
  const { text } = parse(z.object({ text: z.string().max(30000) }), req.body);
  await pool.query('update store_settings set terms_text = $1, terms_updated_at = now() where id = 1', [text.trim() || null]);
  res.status(204).end();
});

// ---- Store payment details (shown by the delivery partner on cash-on-delivery orders) ----
const paymentSchema = z.object({
  upiId: z.string().trim().max(80).regex(/^[\w.\-]{2,}@[\w.\-]{2,}$/, 'Enter a valid UPI ID, e.g. shop@upi').nullable().optional().or(z.literal('')),
  upiName: z.string().trim().max(80).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6–20 digits').nullable().optional().or(z.literal('')),
  bankIfsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC, e.g. SBIN0001234').nullable().optional().or(z.literal('')),
});
const paymentView = (s: Record<string, any>) => ({
  upiId: s.upi_id, upiName: s.upi_name, bankName: s.bank_name, bankAccountName: s.bank_account_name, bankAccountNumber: s.bank_account_number, bankIfsc: s.bank_ifsc,
});
adminRouter.get('/payment-details', async (_req, res) => {
  const { rows } = await pool.query('select * from store_settings where id = 1');
  res.json(paymentView(rows[0]));
});
adminRouter.put('/payment-details', async (req, res) => {
  const p = parse(paymentSchema, req.body);
  const v = (x: string | null | undefined) => (x ? x : null);
  await pool.query('update store_settings set upi_id=$1, upi_name=$2, bank_name=$3, bank_account_name=$4, bank_account_number=$5, bank_ifsc=$6 where id = 1',
    [v(p.upiId), v(p.upiName), v(p.bankName), v(p.bankAccountName), v(p.bankAccountNumber), v(p.bankIfsc)]);
  res.status(204).end();
});

// ============================================================ Delivery partner
async function partnerRow(id: string) {
  const { rows } = await pool.query(`select d.*, ${EFFECTIVE_STATE} as eff_state, (d.on_duty and d.on_duty_day = ${TODAY_IST}) as duty_today from delivery_partners d where d.user_id = $1`, [id]);
  if (!rows[0]) throw notFound('Partner profile not found');
  return rows[0];
}

partnerRouter.get('/me', async (req, res) => {
  const d = await partnerRow(req.user!.id);
  const store = await storeLocation();
  const att = await dutyReply(req.user!.id);
  const open = (await pool.query('select is_open from store_settings where id = 1')).rows[0]?.is_open ?? true;
  res.json({
    state: d.eff_state, isAvailable: d.eff_state === 'available', onDuty: d.duty_today, active: d.active, canCallCustomer: d.can_call_customer,
    dutyStatus: att.dutyStatus, paidLeave: att.paidLeave, storeOpen: open,
    store: store ? { lat: store.lat, lng: store.lng, geofenceM: store.geofenceM } : null,
  });
});

const dutyStatusSchema = z.object({ status: z.enum(['on_duty', 'off_duty', 'on_break', 'leave']) });
async function dutyReply(userId: string) {
  const { rows } = await pool.query(`select ${EFFECTIVE_STATE} as state, ${DUTY_STATUS} as duty_status, (a.status = 'paid_leave') as paid_leave
    from delivery_partners d left join attendance a on a.partner_id = d.user_id and a.day = ${TODAY_IST} where d.user_id = $1`, [userId]);
  return { state: rows[0].state, dutyStatus: rows[0].duty_status, paidLeave: rows[0].paid_leave === true, onDuty: rows[0].duty_status === 'on_duty' || rows[0].duty_status === 'on_break' };
}

/** The partner's own attendance: on duty, off duty, on break or leave. */
partnerRouter.post('/status', async (req, res) => {
  const { status } = parse(dutyStatusSchema, req.body);
  await tx((c) => setDutyStatus(c, req.user!.id, status as DutyStatus, req.user!.name ?? null));
  res.json(await dutyReply(req.user!.id));
});

/** Older builds: simple on/off duty switch. */
partnerRouter.post('/duty', async (req, res) => {
  const { onDuty } = parse(z.object({ onDuty: z.boolean() }), req.body);
  await tx((c) => setDutyStatus(c, req.user!.id, onDuty ? 'on_duty' : 'off_duty', req.user!.name ?? null));
  res.json(await dutyReply(req.user!.id));
});

/** My attendance for the last N days. */
partnerRouter.get('/attendance', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(31).default(14) }), req.query);
  const [rows, closed] = await Promise.all([
    pool.query(`select to_char(day, 'YYYY-MM-DD') as day, status, checked_in_at, checked_out_at, break_minutes from attendance where partner_id = $1 and day > ${TODAY_IST} - $2::int order by day desc`, [req.user!.id, days]),
    pool.query(`select to_char(day, 'YYYY-MM-DD') as day from store_closed_days where day > ${TODAY_IST} - $1::int`, [days]),
  ]);
  const summary = { present: 0, leave: 0, paidLeave: 0, absent: 0 };
  for (const r of rows.rows) { if (r.status === 'present') summary.present++; else if (r.status === 'leave') summary.leave++; else if (r.status === 'paid_leave') summary.paidLeave++; else if (r.status === 'absent') summary.absent++; }
  res.json({
    days: rows.rows.map((r) => ({ day: r.day, status: r.status, checkedInAt: r.checked_in_at, checkedOutAt: r.checked_out_at, breakMinutes: r.break_minutes })),
    closedDays: closed.rows.map((r) => r.day), summary,
  });
});

// Legacy route used by older app builds: same as duty on/off.
partnerRouter.put('/availability', async (req, res) => {
  const { available } = parse(z.object({ available: z.boolean() }), req.body);
  req.body = { onDuty: available };
  const d0 = await partnerRow(req.user!.id);
  if (available === d0.duty_today) return res.json({ isAvailable: d0.eff_state === 'available' });
  await tx(async (c) => {
    if (!available && ['reserved', 'busy'].includes(d0.eff_state)) throw conflict('Finish your current delivery first.', 'has_active_order');
    await c.query(`update delivery_partners set on_duty = $2, on_duty_day = ${TODAY_IST} where user_id = $1`, [req.user!.id, available]);
    await setPartnerState(c, req.user!.id, available ? 'available' : 'off');
  });
  res.json({ isAvailable: available });
});

partnerRouter.get('/orders', async (req, res) => {
  const { scope } = parse(z.object({ scope: z.enum(['active', 'delivered', 'rejected', 'history']).default('active') }), req.query);
  if (scope === 'active') {
    const { rows } = await pool.query(`${LIST_SQL} where o.partner_id = $1 and o.status in ('quoted','awaiting_payment','ready_to_dispatch','out_for_delivery') order by o.updated_at desc limit 50`, [req.user!.id]);
    return res.json({ orders: rows.map(listRow) });
  }
  const status = scope === 'rejected' ? 'rejected' : 'completed';
  const { rows } = await pool.query(
    `select o.*, c.name as customer_name, c.phone as customer_phone, null::text as partner_name, a.reason as assignment_reason,
            coalesce(a.completed_at, a.responded_at) as assignment_at,
            (select count(*) from prescriptions x where x.order_id = o.id) as file_count,
            (select string_agg(name || ' x' || quantity, ', ') from order_items i where i.order_id = o.id) as summary
     from assignments a join orders o on o.id = a.order_id join users c on c.id = o.customer_id
     where a.partner_id = $1 and a.status = $2 order by coalesce(a.completed_at, a.responded_at) desc limit 100`, [req.user!.id, status]);
  // Partners do not get customer phone numbers in lists.
  res.json({ orders: rows.map((r) => ({ ...listRow(r), customerPhone: undefined })) });
});

partnerRouter.post('/orders/:id/accept', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const a = await c.query("update assignments set status = 'accepted', responded_at = now() where order_id = $1 and partner_id = $2 and status = 'pending' returning id", [order.id, req.user!.id]);
    if (!a.rows[0]) throw conflict('This delivery is no longer waiting for your response.', 'invalid_state');
    await transition(c, order.id, ASSIGNABLE, order.status, req.user!.id, { partner_accepted_at: new Date() }, 'Partner accepted');
    if (order.status === 'ready_to_dispatch') await notify(order.customer!.id, order.id, 'partner_assigned', 'Delivery partner confirmed', `${order.orderNumber} will be delivered by our staff.`, c);
    await notifyAdmins(order.id, 'partner_accepted', 'Delivery accepted', `${req.user!.name ?? 'A delivery partner'} accepted ${order.orderNumber}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

partnerRouter.post('/orders/:id/reject', async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional() }), req.body ?? {});
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const a = await c.query("update assignments set status = 'rejected', reason = $3, responded_at = now() where order_id = $1 and partner_id = $2 and status in ('pending','accepted') returning id", [order.id, req.user!.id, reason ?? null]);
    if (!a.rows[0]) throw conflict('This delivery can no longer be rejected.', 'invalid_state');
    await transition(c, order.id, ASSIGNABLE, order.status, req.user!.id, { partner_id: null, partner_accepted_at: null }, `Rejected by partner${reason ? `: ${reason}` : ''}`);
    await releasePartner(c, req.user!.id);
    await notifyAdmins(order.id, 'partner_rejected', 'Delivery rejected', `${req.user!.name ?? 'A delivery partner'} rejected ${order.orderNumber}${reason ? `: ${reason}` : ''}. Please assign someone else.`, c);
  });
  res.json({ ok: true });
});

partnerRouter.post('/orders/:id/out-for-delivery', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  if (!order.partnerAccepted) throw conflict('Accept the delivery first.', 'not_accepted');
  if (order.status !== 'ready_to_dispatch') throw conflict('The customer has not confirmed this order yet. You can start once they do.', 'waiting_for_customer');
  await tx(async (c) => {
    await transition(c, order.id, ['ready_to_dispatch'], 'out_for_delivery', req.user!.id);
    await setPartnerState(c, req.user!.id, 'busy');
    await notify(order.customer!.id, order.id, 'out_for_delivery', 'Your order is out for delivery', `${order.orderNumber} is on its way. Track it live in the app.`, c);
    await notifyAdmins(order.id, 'out_for_delivery', 'Out for delivery', `${order.orderNumber} left the store`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

/** Store payment details for the partner to show the customer on a COD order. */
partnerRouter.get('/orders/:id/payment-details', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  if (order.paymentMethod !== 'cod') throw conflict('This order is already paid online.', 'not_cod');
  const { rows } = await pool.query('select * from store_settings where id = 1');
  const s = rows[0];
  const amount = order.quotedAmount ?? 0;
  const upiUri = s.upi_id ? `upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.upi_name ?? 'Kamal Medical Hall')}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(order.orderNumber)}` : null;
  res.json({ ...paymentView(s), amount, orderNumber: order.orderNumber, upiUri, configured: Boolean(s.upi_id || s.bank_account_number) });
});

/**
 * Completing a delivery is mandatory and, for cash-on-delivery, requires recording how the customer paid.
 * The partner then rides back; they become available again automatically once they reach the shop.
 */
partnerRouter.post('/orders/:id/delivered', async (req, res) => {
  const b = parse(z.object({
    collectedVia: z.enum(['cash', 'upi', 'bank']).optional(),
    /** UPI / bank transaction id read from the payment screenshot. */
    reference: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9._\-/]+$/, 'Transaction id has unexpected characters').optional(),
    proof: z.object({ publicId: z.string().max(300), mimeType: z.string().max(100), resourceType: z.enum(['image', 'raw', 'video']).default('image'), sizeBytes: z.number().int().max(15_000_000).optional() }).optional(),
  }), req.body ?? {});
  const order = await loadOrder(String(req.params.id), req.user!);
  const cod = order.paymentMethod === 'cod';
  if (cod && !b.collectedVia) throw bad('Record how the customer paid before completing the delivery.', 'payment_required');
  // Online payment (UPI / bank transfer) needs the transaction id and the screenshot of the payment.
  const online = cod && b.collectedVia !== 'cash';
  if (online && (!b.reference || !b.proof)) throw bad('Add the payment screenshot and its transaction id.', 'payment_proof_required');
  if (b.proof && !b.proof.publicId.startsWith(`proofs/${req.user!.id}/`)) throw bad('That file does not belong to you.', 'bad_proof');
  const store = await storeLocation();
  await tx(async (c) => {
    // UPI / bank with a transaction id is already in the shop's account: fully paid. Cash stays "collected" until the admin receives it from the partner.
    await transition(c, order.id, ['out_for_delivery'], 'delivered', req.user!.id, cod ? { payment_status: online ? 'paid' : 'cod_collected' } : {});
    if (cod) {
      await c.query("update payments set status = $5, collected_by = $2, collected_via = $3, collection_ref = $4, collected_at = now(), proof_public_id = $6, proof_mime = $7, proof_resource_type = $8 where order_id = $1 and method = 'cod'",
        [order.id, req.user!.id, b.collectedVia, b.reference ?? null, online ? 'paid' : 'cod_collected', b.proof?.publicId ?? null, b.proof?.mimeType ?? null, b.proof?.resourceType ?? null]);
    }
    await c.query("update assignments set status = 'completed', completed_at = now() where order_id = $1 and partner_id = $2 and status = 'accepted'", [order.id, req.user!.id]);
    // With a known shop location the partner rides back and is freed on arrival; without one they are freed immediately.
    const stillOut = (await c.query("select count(*)::int as n from orders where partner_id = $1 and status = 'out_for_delivery'", [req.user!.id])).rows[0].n as number;
    if (stillOut > 0) await setPartnerState(c, req.user!.id, 'busy'); // more deliveries on this trip
    else if (store) await setPartnerState(c, req.user!.id, 'returning'); else await releasePartner(c, req.user!.id);
    await notify(order.customer!.id, order.id, 'delivered', 'Order delivered', `${order.orderNumber} has been delivered. Thank you!`, c);
    const who = req.user!.name ?? 'The delivery partner';
    const amount = `₹${Math.round(order.quotedAmount ?? 0).toLocaleString('en-IN')}`;
    if (cod && b.collectedVia === 'cash') await notifyAdmins(order.id, 'cash_to_collect', 'Collect cash from delivery partner', `${who} collected ${amount} cash for ${order.orderNumber}. Please collect it from them.`, c);
    else await notifyAdmins(order.id, 'delivered', 'Order delivered', `${order.orderNumber} delivered${cod ? ` (paid by ${b.collectedVia}, ref ${b.reference})` : ''}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

/** Partner uploads the payment screenshot to their own folder (signed upload, like other files). */


/**
 * The partner app reports its position while a delivery or the ride back is in progress.
 * - during a delivery the customer's map follows the rider;
 * - on the ride back, reaching the shop (admin-set location) makes the partner available automatically.
 */
partnerRouter.post('/location', async (req, res) => {
  const { lat, lng } = parse(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }), req.body);
  const { rows } = await pool.query('update delivery_partners set last_lat = $2, last_lng = $3, last_seen = now() where user_id = $1 returning state', [req.user!.id, lat, lng]);
  const state = rows[0]?.state as string | undefined;
  if (state === 'busy') {
    const o = await pool.query("select id, customer_id, address_snapshot from orders where partner_id = $1 and status = 'out_for_delivery'", [req.user!.id]);
    for (const order of o.rows) {
      const snap = order.address_snapshot;
      const eta = snap?.latitude != null ? etaMinutes(distanceMeters({ lat, lng }, { lat: snap.latitude, lng: snap.longitude })) : null;
      const payload = { orderId: order.id, lat, lng, etaMinutes: eta, at: new Date().toISOString() };
      emitUser(order.customer_id, 'partner:location', payload);
      emitAdmins('partner:location', { ...payload, partnerId: req.user!.id });
    }
  }
  let arrived = false;
  if (state === 'returning') {
    const store = await storeLocation();
    if (store && distanceMeters({ lat, lng }, store) <= store.geofenceM) {
      await tx(async (c) => {
        await releasePartner(c, req.user!.id);
        await notify(req.user!.id, null, 'back_at_shop', 'Back at the shop', 'You are available for the next delivery.', c);
      });
      arrived = true;
    }
  }
  const now = arrived ? ((await pool.query('select state from delivery_partners where user_id = $1', [req.user!.id])).rows[0]?.state as string) : state;
  res.json({ state: now, arrived });
});

/** Manual "I'm back" for when no shop location is set; otherwise the partner must actually be at the shop. */
partnerRouter.post('/arrived', async (req, res) => {
  const d = await partnerRow(req.user!.id);
  if (d.eff_state !== 'returning') return res.json({ state: d.eff_state });
  const store = await storeLocation();
  if (store) {
    const near = d.last_lat != null && distanceMeters({ lat: d.last_lat, lng: d.last_lng }, store) <= store.geofenceM * 2;
    if (!near) throw conflict('You do not seem to be at the shop yet. You become available automatically when you arrive.', 'not_at_shop');
  }
  await tx(async (c) => { await releasePartner(c, req.user!.id); });
  res.json({ state: (await partnerRow(req.user!.id)).eff_state });
});
