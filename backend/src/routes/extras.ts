import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { HttpError, conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins, notifyMany } from '../notify.js';
import { isBlockedFile, signedPrescriptionUrl, type ResourceType } from '../services.js';
import { latencySnapshot } from '../observability.js';
import { queueSnapshot } from './chat.js';

/** Customer side of reviews. */
export const reviewsRouter = Router();
/** Admin tools that go beyond the basics: review moderation, analytics, exports, announcements, customer detail. */
export const adminExtras = Router();
reviewsRouter.use(authed, requireRole('customer'));
adminExtras.use(authed, requireRole('admin'));

const TODAY_IST = "(now() at time zone 'Asia/Kolkata')::date";
const DAY_IST = (col: string) => `(${col} at time zone 'Asia/Kolkata')::date`;

// ============================================================ Reviews
const imageUrl = (r: { public_id: string; mime_type: string; resource_type: string }) => signedPrescriptionUrl(r.public_id, r.mime_type, r.resource_type as ResourceType);

async function reviewRows(where: string, params: unknown[]) {
  const { rows } = await pool.query(
    `select r.*, o.order_number, u.name as customer_name, u.phone as customer_phone,
            coalesce((select json_agg(json_build_object('id', i.id, 'public_id', i.public_id, 'mime_type', i.mime_type, 'resource_type', i.resource_type) order by i.id)
                      from review_images i where i.review_id = r.id), '[]'::json) as images
     from reviews r join orders o on o.id = r.order_id join users u on u.id = r.customer_id ${where} order by r.created_at desc limit 100`, params);
  return rows.map((r) => ({
    id: r.id, orderId: r.order_id, orderNumber: r.order_number, rating: r.rating, comment: r.comment, status: r.status, adminNote: r.admin_note,
    createdAt: r.created_at, decidedAt: r.decided_at, customerName: r.customer_name, customerPhone: r.customer_phone,
    images: (r.images as { id: string; public_id: string; mime_type: string; resource_type: string }[]).map((i) => ({ id: i.id, url: imageUrl(i) })),
  }));
}

reviewsRouter.post('/', async (req, res) => {
  const b = parse(z.object({
    orderId: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(),
    images: z.array(z.object({ publicId: z.string().min(3).max(300), mimeType: z.string().min(3).max(120), resourceType: z.enum(['image']).default('image'), sizeBytes: z.number().int().min(0).max(10_485_760).optional() })).max(3).default([]),
  }), req.body);
  if (b.images.some((i) => !i.publicId.startsWith(`reviews/${req.user!.id}/`) || isBlockedFile(i.publicId))) throw new HttpError(400, 'invalid_file', 'Invalid photo.');
  const order = (await pool.query('select id, order_number, status from orders where id = $1 and customer_id = $2', [b.orderId, req.user!.id])).rows[0];
  if (!order) throw notFound('Order not found');
  if (order.status !== 'delivered') throw conflict('You can review an order after it is delivered.', 'not_delivered');
  const id = await tx(async (c) => {
    const exists = await c.query('select 1 from reviews where order_id = $1', [order.id]);
    if (exists.rows[0]) throw conflict('You already reviewed this order.', 'already_reviewed');
    const r = await c.query('insert into reviews (order_id, customer_id, rating, comment) values ($1,$2,$3,$4) returning id', [order.id, req.user!.id, b.rating, b.comment || null]);
    for (const i of b.images) await c.query('insert into review_images (review_id, public_id, mime_type, resource_type, size_bytes) values ($1,$2,$3,$4,$5)', [r.rows[0].id, i.publicId, i.mimeType, i.resourceType, i.sizeBytes ?? null]);
    await notifyAdmins(order.id, 'review_new', 'New review to approve', `${req.user!.name ?? 'A customer'} rated ${order.order_number} ${b.rating}/5`, c);
    return r.rows[0].id as string;
  });
  res.status(201).json({ review: (await reviewRows('where r.id = $1', [id]))[0] });
});

/** Everything this customer wrote, with status. The profile page shows the approved ones. */
reviewsRouter.get('/mine', async (req, res) => {
  res.json({ reviews: await reviewRows('where r.customer_id = $1', [req.user!.id]) });
});

adminExtras.get('/reviews', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending') }), req.query);
  res.json({ reviews: await reviewRows('where r.status = $1', [status]) });
});

adminExtras.post('/reviews/:id/decision', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(200).optional() }), req.body);
  const r = (await pool.query(
    `update reviews set status = $2, admin_note = $3, decided_at = now(), decided_by = $4 where id = $1 and status = 'pending' returning id, customer_id, order_id`,
    [req.params.id, b.status, b.note || null, req.user!.id])).rows[0];
  if (!r) throw conflict('This review was already handled.', 'already_decided');
  await notify(r.customer_id, r.order_id, b.status === 'approved' ? 'review_approved' : 'review_rejected',
    b.status === 'approved' ? 'Your review is live' : 'Review not published', b.status === 'approved' ? 'Thank you! Your review now shows on your profile.' : (b.note || 'The shop could not publish your review.'));
  res.json({ review: (await reviewRows('where r.id = $1', [r.id]))[0] });
});

// ============================================================ Analytics
/** Slowest endpoints first (p50 / p95 / p99 in ms over the most recent requests since the server started). */
adminExtras.get('/metrics', (_req, res) => { res.json({ routes: latencySnapshot() }); });

adminExtras.get('/overview', async (_req, res) => {
  const [a, snap, rv] = await Promise.all([
    pool.query(`
      select (select count(*) from users where role = 'customer' and phone not like 'deleted-%') as customers,
             count(*) as orders_total,
             count(*) filter (where ${DAY_IST('created_at')} = ${TODAY_IST}) as orders_today,
             count(*) filter (where status = 'cancelled' and ${DAY_IST('updated_at')} = ${TODAY_IST}) as cancelled_today
      from orders`),
    queueSnapshot(),
    pool.query("select count(*) as n from reviews where status = 'pending'"),
  ]);
  const sales = await pool.query(`
    select coalesce(sum(o.quoted_amount) filter (where ${DAY_IST('h.created_at')} = ${TODAY_IST}), 0) as today,
           coalesce(sum(o.quoted_amount) filter (where ${DAY_IST('h.created_at')} > ${TODAY_IST} - 7), 0) as week,
           coalesce(sum(o.quoted_amount) filter (where ${DAY_IST('h.created_at')} > ${TODAY_IST} - 30), 0) as month,
           count(*) filter (where ${DAY_IST('h.created_at')} > ${TODAY_IST} - 30) as month_orders
    from orders o join status_history h on h.order_id = o.id and h.status = 'delivered' where o.status = 'delivered'`);
  const s = sales.rows[0], r = a.rows[0];
  res.json({
    customers: +r.customers, ordersTotal: +r.orders_total, ordersToday: +r.orders_today, cancelledToday: +r.cancelled_today,
    salesToday: Number(s.today), sales7d: Number(s.week), sales30d: Number(s.month),
    avgOrder30d: +s.month_orders ? Math.round(Number(s.month) / +s.month_orders) : 0,
    pendingReviews: +rv.rows[0].n, chatWaiting: snap.waitingCount, chatOpen: snap.waitingCount + snap.activeCount,
  });
});

adminExtras.get('/revenue', async (req, res) => {
  const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const [daily, split, top, totals] = await Promise.all([
    pool.query(`select to_char(${DAY_IST('h.created_at')}, 'YYYY-MM-DD') as day, count(*) as orders, coalesce(sum(o.quoted_amount), 0) as sales
                from orders o join status_history h on h.order_id = o.id and h.status = 'delivered'
                where o.status = 'delivered' and ${DAY_IST('h.created_at')} > ${TODAY_IST} - $1::int group by 1 order by 1`, [days]),
    pool.query(`select o.payment_method, count(*) as orders, coalesce(sum(o.quoted_amount), 0) as sales
                from orders o join status_history h on h.order_id = o.id and h.status = 'delivered'
                where o.status = 'delivered' and ${DAY_IST('h.created_at')} > ${TODAY_IST} - $1::int group by 1`, [days]),
    pool.query(`select i.name, sum(i.quantity) as quantity, count(distinct i.order_id) as orders
                from order_items i join orders o on o.id = i.order_id join status_history h on h.order_id = o.id and h.status = 'delivered'
                where o.status = 'delivered' and ${DAY_IST('h.created_at')} > ${TODAY_IST} - $1::int group by i.name order by quantity desc limit 8`, [days]),
    pool.query(`select count(*) filter (where status = 'delivered') as delivered, count(*) filter (where status in ('cancelled','rejected')) as lost, count(*) as total
                from orders where ${DAY_IST('created_at')} > ${TODAY_IST} - $1::int`, [days]),
  ]);
  const sales = daily.rows.reduce((n, r) => n + Number(r.sales), 0);
  const delivered = daily.rows.reduce((n, r) => n + +r.orders, 0);
  const t = totals.rows[0];
  res.json({
    days, sales, delivered, avgOrder: delivered ? Math.round(sales / delivered) : 0, ordersPlaced: +t.total, ordersLost: +t.lost,
    daily: daily.rows.map((r) => ({ day: r.day, orders: +r.orders, sales: Number(r.sales) })),
    paymentSplit: split.rows.map((r) => ({ method: r.payment_method, orders: +r.orders, sales: Number(r.sales) })),
    topItems: top.rows.map((r) => ({ name: r.name, quantity: +r.quantity, orders: +r.orders })),
  });
});

// ============================================================ Downloads (CSV)
const KINDS = ['orders', 'revenue', 'customers', 'payments', 'attendance', 'reviews'] as const;
type Kind = (typeof KINDS)[number];

const csvCell = (v: unknown) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stops spreadsheets from running a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (headers: string[], rows: unknown[][]) => '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

async function buildExport(kind: Kind, days: number) {
  const since = `${DAY_IST('{c}')} > ${TODAY_IST} - $1::int`;
  const on = (col: string) => since.replace('{c}', col);
  if (kind === 'orders') {
    const { rows } = await pool.query(`select o.order_number, to_char(${DAY_IST('o.created_at')}, 'YYYY-MM-DD') as date, c.name, c.phone, o.status, o.quoted_amount, o.payment_method, o.payment_status, o.delivery_slot, p.name as partner,
        (select string_agg(i.name || ' x' || i.quantity, '; ') from order_items i where i.order_id = o.id) as items
      from orders o join users c on c.id = o.customer_id left join users p on p.id = o.partner_id where ${on('o.created_at')} order by o.created_at desc`, [days]);
    return toCsv(['Order', 'Date', 'Customer', 'Phone', 'Status', 'Amount', 'Payment method', 'Payment status', 'Slot', 'Delivery partner', 'Items'],
      rows.map((r) => [r.order_number, r.date, r.name, r.phone, r.status, r.quoted_amount, r.payment_method, r.payment_status, r.delivery_slot, r.partner, r.items]));
  }
  if (kind === 'revenue') {
    const { rows } = await pool.query(`select to_char(${DAY_IST('h.created_at')}, 'YYYY-MM-DD') as day, count(*) as orders, coalesce(sum(o.quoted_amount), 0) as sales,
        coalesce(sum(o.quoted_amount) filter (where o.payment_method = 'cod'), 0) as cod, coalesce(sum(o.quoted_amount) filter (where o.payment_method = 'razorpay'), 0) as online
      from orders o join status_history h on h.order_id = o.id and h.status = 'delivered' where o.status = 'delivered' and ${on('h.created_at')} group by 1 order by 1`, [days]);
    return toCsv(['Date', 'Delivered orders', 'Sales', 'Cash on delivery', 'Online'], rows.map((r) => [r.day, r.orders, r.sales, r.cod, r.online]));
  }
  if (kind === 'customers') {
    const { rows } = await pool.query(`select u.name, u.phone, u.email, to_char(${DAY_IST('u.created_at')}, 'YYYY-MM-DD') as joined, count(o.id) as orders,
        coalesce(sum(o.quoted_amount) filter (where o.status = 'delivered'), 0) as lifetime
      from users u left join orders o on o.customer_id = u.id where u.role = 'customer' and u.phone not like 'deleted-%' group by u.id order by lifetime desc`);
    return toCsv(['Name', 'Phone', 'Email', 'Joined', 'Orders', 'Lifetime value'], rows.map((r) => [r.name, r.phone, r.email, r.joined, r.orders, r.lifetime]));
  }
  if (kind === 'payments') {
    const { rows } = await pool.query(`select o.order_number, to_char(${DAY_IST('p.collected_at')}, 'YYYY-MM-DD') as date, c.name as customer, d.name as partner, p.collected_via, p.collection_ref, o.quoted_amount
      from payments p join orders o on o.id = p.order_id join users c on c.id = o.customer_id left join users d on d.id = o.partner_id
      where p.collected_at is not null and ${on('p.collected_at')} order by p.collected_at desc`, [days]);
    return toCsv(['Order', 'Date', 'Customer', 'Collected by', 'Mode', 'Reference', 'Amount'], rows.map((r) => [r.order_number, r.date, r.customer, r.partner, r.collected_via, r.collection_ref, r.quoted_amount]));
  }
  if (kind === 'attendance') {
    const { rows } = await pool.query(`select to_char(a.day, 'YYYY-MM-DD') as day, u.name, u.phone, a.status, a.checked_in_at, a.checked_out_at, a.break_minutes
      from attendance a join users u on u.id = a.partner_id where a.day > ${TODAY_IST} - $1::int order by a.day desc, u.name`, [days]);
    return toCsv(['Date', 'Partner', 'Phone', 'Status', 'Check-in', 'Check-out', 'Break minutes'], rows.map((r) => [r.day, r.name, r.phone, r.status, r.checked_in_at, r.checked_out_at, r.break_minutes]));
  }
  const { rows } = await pool.query(`select o.order_number, to_char(${DAY_IST('r.created_at')}, 'YYYY-MM-DD') as date, u.name, r.rating, r.comment, r.status
    from reviews r join orders o on o.id = r.order_id join users u on u.id = r.customer_id where ${on('r.created_at')} order by r.created_at desc`, [days]);
  return toCsv(['Order', 'Date', 'Customer', 'Rating', 'Comment', 'Status'], rows.map((r) => [r.order_number, r.date, r.name, r.rating, r.comment, r.status]));
}

/** Short-lived link so the phone's browser can download the file (it cannot send the login token). */
adminExtras.get('/export-link', (req, res) => {
  const { kind, days } = parse(z.object({ kind: z.enum(KINDS), days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
  const token = jwt.sign({ purpose: 'export', kind, days }, config.jwtSecret, { expiresIn: '10m' });
  res.json({ url: `${req.protocol}://${req.get('host')}/export/${kind}.csv?t=${encodeURIComponent(token)}` });
});

/** Mounted outside the admin guard: the signed token is the credential. */
export const exportDownload = Router();
exportDownload.get('/:kind.csv', async (req, res) => {
  let payload: { purpose?: string; kind?: string; days?: number };
  try { payload = jwt.verify(String(req.query.t ?? ''), config.jwtSecret) as typeof payload; } catch { throw new HttpError(401, 'invalid_link', 'This download link has expired. Please open it again from the app.'); }
  if (payload.purpose !== 'export' || payload.kind !== req.params.kind || !KINDS.includes(payload.kind as Kind)) throw new HttpError(401, 'invalid_link', 'This download link is not valid.');
  const csv = await buildExport(payload.kind as Kind, Math.min(365, Math.max(1, Number(payload.days) || 30)));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kamal-medical-${payload.kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
});
