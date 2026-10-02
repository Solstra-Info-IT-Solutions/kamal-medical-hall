import { Router } from 'express';
import { z } from 'zod';
import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { bad, bad as bad_, conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { clearPincodeCache } from '../pincodes.js';
import { emitAdmins } from '../realtime.js';
import { CANCELLABLE, loadOrder, transition } from '../orderService.js';

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
});
const LIST_SQL = `
  select o.*, c.name as customer_name, c.phone as customer_phone, p.name as partner_name,
         (select count(*) from prescriptions x where x.order_id = o.id) as file_count,
         (select string_agg(name || ' x' || quantity, ', ') from order_items i where i.order_id = o.id) as summary
  from orders o join users c on c.id = o.customer_id left join users p on p.id = o.partner_id`;

// ---- Admin -----------------------------------------------------------------
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
  res.json({ requested: +r.requested, awaitingPayment: +r.awaiting, readyToDispatch: +r.ready, outForDelivery: +r.out_for_delivery, deliveredToday: +r.delivered_today, salesToday: Number(r.sales_today) });
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
  const { amount } = parse(z.object({ amount: z.number().positive().max(500000) }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  const expires = new Date(Date.now() + config.quoteValidHours * 3600000);
  await tx(async (c) => {
    await transition(c, order.id, ['requested', 'quoted'], 'quoted', req.user!.id, { quoted_amount: amount, quote_expires_at: expires, reviewed_by: req.user!.id });
    await notify(order.customer!.id, order.id, 'quote_ready', 'Your order amount is ready', `${order.orderNumber}: pay ₹${amount} (free delivery). Please review and accept.`, c);
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
    await transition(c, order.id, CANCELLABLE, 'cancelled', req.user!.id, { cancel_reason: reason, cancelled_by: req.user!.id, partner_id: null }, reason);
    if (order.partner?.id) {
      await c.query('update delivery_partners set is_available = true where user_id = $1', [order.partner.id]);
      await notify(order.partner.id, order.id, 'order_cancelled', 'Delivery cancelled', `${order.orderNumber} was cancelled by the store`, c);
    }
    await notify(order.customer!.id, order.id, 'order_cancelled', 'Order cancelled by the store', `${order.orderNumber}: ${reason}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.post('/orders/:id/assign', async (req, res) => {
  const { partnerId } = parse(z.object({ partnerId: z.string().uuid() }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const cover = await c.query('select pincode from partner_pincodes where partner_id = $1', [partnerId]);
    if (cover.rows.length && !cover.rows.some((r) => r.pincode === order.address.pincode)) throw conflict('That delivery partner does not cover this pincode.', 'out_of_coverage');
    const p = await c.query('update delivery_partners set is_available = false where user_id = $1 and is_available and active returning user_id', [partnerId]);
    if (!p.rows[0]) throw conflict('That delivery partner is not available.', 'partner_unavailable');
    c.afterCommit(() => emitAdmins('partner:update', { partnerId, isAvailable: false }));
    await transition(c, order.id, ['ready_to_dispatch'], 'ready_to_dispatch', req.user!.id, { partner_id: partnerId }, 'Partner assigned');
    await notify(partnerId, order.id, 'assigned', 'New delivery assigned', `${order.orderNumber} to ${order.address.line1}`, c);
    await notify(order.customer!.id, order.id, 'partner_assigned', 'Delivery partner assigned', `${order.orderNumber} will be delivered by our staff.`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

adminRouter.get('/partners', async (_req, res) => {
  const { rows } = await pool.query(`
    select u.id, u.name, u.phone, d.is_available, d.active,
      (select count(*) from orders o where o.partner_id = u.id and o.status in ('ready_to_dispatch','out_for_delivery')) as active_orders,
      (select coalesce(array_agg(pp.pincode order by pp.pincode), '{}') from partner_pincodes pp where pp.partner_id = u.id) as pincodes,
      (select coalesce(sum(o.quoted_amount),0) from orders o join payments p on p.order_id = o.id
        where o.partner_id = u.id and p.status = 'cod_collected' and o.updated_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as cod_today
    from users u join delivery_partners d on d.user_id = u.id order by u.name`);
  res.json({ partners: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, isAvailable: r.is_available, active: r.active, activeOrders: +r.active_orders, codCollectedToday: Number(r.cod_today), pincodes: r.pincodes })) });
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
  const { active } = parse(z.object({ active: z.boolean() }), req.body);
  const { rowCount } = await pool.query('update delivery_partners set active = $2, is_available = case when $2 then is_available else false end where user_id = $1', [req.params.id, active]);
  if (!rowCount) throw notFound('Partner not found');
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

adminRouter.get('/customers', async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(40).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query);
  const { rows } = await pool.query(
    `select u.id, u.name, u.phone, u.created_at, (select count(*) from orders o where o.customer_id = u.id) as order_count
     from users u where u.role = 'customer' and ($1::text is null or u.phone like '%' || $1 || '%' or u.name ilike '%' || $1 || '%')
     order by u.created_at desc limit $2 offset $3`, [q.search ?? null, q.limit, q.offset]);
  res.json({ customers: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, joinedAt: r.created_at, orderCount: +r.order_count })) });
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
});
adminRouter.get('/settings', async (_req, res) => {
  const { rows } = await pool.query('select * from store_settings where id = 1');
  const s = rows[0];
  res.json({ isOpen: s.is_open, openingTime: s.opening_time, closingTime: s.closing_time, address: s.address, phone: s.phone, email: s.email });
});
adminRouter.put('/settings', async (req, res) => {
  const s = parse(settingsSchema, req.body);
  await pool.query('update store_settings set is_open=$1, opening_time=$2, closing_time=$3, address=$4, phone=$5, email=$6 where id = 1',
    [s.isOpen, s.openingTime, s.closingTime, s.address ?? null, s.phone ?? null, s.email ?? null]);
  res.status(204).end();
});

// ---- Delivery partner --------------------------------------------------------
partnerRouter.get('/me', async (req, res) => {
  const { rows } = await pool.query('select is_available, active from delivery_partners where user_id = $1', [req.user!.id]);
  if (!rows[0]) throw notFound('Partner profile not found');
  res.json({ isAvailable: rows[0].is_available, active: rows[0].active });
});

partnerRouter.put('/availability', async (req, res) => {
  const { available } = parse(z.object({ available: z.boolean() }), req.body);
  if (available) {
    const busy = await pool.query("select 1 from orders where partner_id = $1 and status in ('ready_to_dispatch','out_for_delivery')", [req.user!.id]);
    if (busy.rows[0]) throw conflict('Finish your current delivery first.', 'has_active_order');
  }
  const { rowCount } = await pool.query('update delivery_partners set is_available = $2 where user_id = $1 and active', [req.user!.id, available]);
  if (!rowCount) throw conflict('Your account is not active.', 'inactive');
  emitAdmins('partner:update', { partnerId: req.user!.id, isAvailable: available });
  res.json({ isAvailable: available });
});

partnerRouter.get('/orders', async (req, res) => {
  const { scope } = parse(z.object({ scope: z.enum(['active', 'history']).default('active') }), req.query);
  const { rows } = await pool.query(
    `${LIST_SQL} where o.partner_id = $1 and ${scope === 'active' ? "o.status in ('ready_to_dispatch','out_for_delivery')" : "o.status = 'delivered'"} order by o.updated_at desc limit 50`,
    [req.user!.id]);
  res.json({ orders: rows.map(listRow) });
});

partnerRouter.post('/orders/:id/out-for-delivery', async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    await transition(c, order.id, ['ready_to_dispatch'], 'out_for_delivery', req.user!.id);
    await notify(order.customer!.id, order.id, 'out_for_delivery', 'Your order is out for delivery', `${order.orderNumber} is on its way.`, c);
    await notifyAdmins(order.id, 'out_for_delivery', 'Out for delivery', `${order.orderNumber} left the store`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

partnerRouter.post('/orders/:id/delivered', async (req, res) => {
  const { cashCollected } = parse(z.object({ cashCollected: z.boolean().default(false) }), req.body ?? {});
  const order = await loadOrder(String(req.params.id), req.user!);
  const cod = order.paymentMethod === 'cod';
  if (cod && !cashCollected) throw bad('Confirm that the cash was collected.', 'cash_required');
  await tx(async (c) => {
    await transition(c, order.id, ['out_for_delivery'], 'delivered', req.user!.id, cod ? { payment_status: 'cod_collected' } : {});
    if (cod) await c.query("update payments set status = 'cod_collected', collected_by = $2 where order_id = $1 and method = 'cod'", [order.id, req.user!.id]);
    await c.query('update delivery_partners set is_available = true where user_id = $1', [req.user!.id]);
    c.afterCommit(() => emitAdmins('partner:update', { partnerId: req.user!.id, isAvailable: true }));
    await notify(order.customer!.id, order.id, 'delivered', 'Order delivered', `${order.orderNumber} has been delivered. Thank you!`, c);
    await notifyAdmins(order.id, 'delivered', 'Order delivered', `${order.orderNumber} delivered${cod ? ' (cash collected)' : ''}`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});
