import express, { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { HttpError, bad, conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { CANCELLABLE, loadOrder, transition } from '../orderService.js';
import { isServiceable } from '../pincodes.js';
import { isSlotBookable, SLOTS } from '../slots.js';
import { razorpayClient, verifyPaymentSignature, verifyWebhookSignature } from '../services.js';

export const orders = Router();
export const razorpayWebhook = Router();

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

const createSchema = z.object({
  kind: z.enum(['prescription', 'medicines']),
  items: z.array(z.object({ name: z.string().trim().min(2).max(120), quantity: z.number().int().min(1).max(99) })).max(30).default([]),
  prescriptions: z.array(z.object({
    publicId: z.string().min(1).max(300),
    mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
    url: z.string().url().max(600),
  })).max(MAX_FILES).default([]),
  note: z.string().trim().max(300).optional(),
  addressId: z.string().uuid(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliverySlot: z.string(),
  idempotencyKey: z.string().min(8).max(100),
});

orders.post('/', authed, requireRole('customer'), async (req, res) => {
  const user = req.user!;
  const b = parse(createSchema, req.body);
  if (b.kind === 'prescription' && (b.prescriptions.length < 1 || b.items.length)) throw bad('A prescription order needs 1 to 3 prescription files and no typed medicines.', 'mixed_order');
  if (b.kind === 'medicines' && (b.items.length < 1 || b.prescriptions.length)) throw bad('A medicine order needs at least one medicine and no prescription files.', 'mixed_order');
  if (b.prescriptions.some((p) => !p.publicId.startsWith(`prescriptions/${user.id}/`))) throw bad('Invalid prescription file.', 'invalid_file');
  if (!SLOTS.some((s) => s.id === b.deliverySlot) || !isSlotBookable(b.deliveryDate, b.deliverySlot)) throw bad('That delivery time is no longer available. Please choose another.', 'slot_unavailable');

  const store = await pool.query('select is_open from store_settings where id = 1');
  if (!store.rows[0].is_open) throw new HttpError(409, 'store_closed', 'The store is currently not accepting orders.');

  const addr = await pool.query('select * from addresses where id = $1 and user_id = $2', [b.addressId, user.id]);
  if (!addr.rows[0]) throw notFound('Address not found');
  if (!(await isServiceable(addr.rows[0].pincode))) throw new HttpError(422, 'unsupported_pincode', 'Sorry, we do not deliver to this pincode yet.');
  const a = addr.rows[0];
  const snapshot = { recipientName: a.recipient_name, phone: a.phone, line1: a.line1, line2: a.line2, landmark: a.landmark, pincode: a.pincode, city: a.city, latitude: a.latitude, longitude: a.longitude };

  const created = await tx(async (c) => {
    const existing = await c.query('select id from orders where customer_id = $1 and idempotency_key = $2', [user.id, b.idempotencyKey]);
    if (existing.rows[0]) return { id: existing.rows[0].id as string, replay: true };
    const ins = await c.query(
      `insert into orders (customer_id, kind, note, address_snapshot, delivery_date, delivery_slot, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, order_number`,
      [user.id, b.kind, b.note ?? null, snapshot, b.deliveryDate, SLOTS.find((s) => s.id === b.deliverySlot)!.label, b.idempotencyKey],
    );
    const id = ins.rows[0].id as string;
    for (const item of b.items) await c.query('insert into order_items (order_id, name, quantity) values ($1,$2,$3)', [id, item.name, item.quantity]);
    for (const p of b.prescriptions) await c.query('insert into prescriptions (order_id, url, public_id, mime_type, size_bytes) values ($1,$2,$3,$4,$5)', [id, p.url, p.publicId, p.mimeType, p.sizeBytes]);
    await c.query('insert into status_history (order_id, status, actor_id) values ($1,$2,$3)', [id, 'requested', user.id]);
    await notifyAdmins(id, 'order_requested', 'New order request', `${ins.rows[0].order_number} from ${user.name ?? user.phone}`, c);
    return { id, replay: false };
  });
  res.status(created.replay ? 200 : 201).json({ order: await loadOrder(created.id, user) });
});

orders.get('/', authed, requireRole('customer'), async (req, res) => {
  const { scope, limit, offset } = parse(z.object({
    scope: z.enum(['completed', 'active']).default('completed'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }), req.query);
  const where = scope === 'completed' ? "status = 'delivered'" : "status not in ('delivered','rejected','cancelled')";
  const { rows } = await pool.query(
    `select o.id, o.order_number, o.kind, o.status, o.quoted_amount, o.created_at, o.delivery_date,
            (select count(*) from prescriptions p where p.order_id = o.id) as file_count,
            (select string_agg(name || ' x' || quantity, ', ') from order_items i where i.order_id = o.id) as summary
     from orders o where o.customer_id = $1 and ${where} order by o.created_at desc limit $2 offset $3`,
    [req.user!.id, limit, offset],
  );
  res.json({ orders: rows.map((r) => ({
    id: r.id, orderNumber: r.order_number, kind: r.kind, status: r.status, createdAt: r.created_at,
    quotedAmount: r.quoted_amount === null ? null : Number(r.quoted_amount), fileCount: Number(r.file_count), summary: r.summary,
  })), hasMore: rows.length === limit });
});

orders.get('/:id', authed, async (req, res) => {
  res.json({ order: await loadOrder(String(req.params.id), req.user!) });
});

orders.post('/:id/cancel', authed, requireRole('customer'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const row = await transition(c, order.id, CANCELLABLE, 'cancelled', req.user!.id, { cancel_reason: reason, cancelled_by: req.user!.id, partner_id: null }, reason);
    if (order.partner?.id) await c.query('update delivery_partners set is_available = true where user_id = $1', [order.partner.id]);
    const paid = row.payment_status === 'paid';
    await notifyAdmins(order.id, 'order_cancelled', 'Order cancelled by customer',
      `${order.orderNumber}: ${reason}${paid ? ' (online payment was already received; handle manually)' : ''}`, c);
    if (order.partner?.id) await notify(order.partner.id, order.id, 'order_cancelled', 'Delivery cancelled', `${order.orderNumber} was cancelled`, c);
  });
  res.json({ order: await loadOrder(order.id, req.user!) });
});

const acceptSchema = z.object({ paymentMethod: z.enum(['razorpay', 'cod']) });

/** Customer accepts the pharmacy quote and picks how to pay. */
orders.post('/:id/accept-quote', authed, requireRole('customer'), async (req, res) => {
  const { paymentMethod } = parse(acceptSchema, req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  if (order.status !== 'quoted' && order.status !== 'awaiting_payment') throw conflict('This order can no longer be changed this way. Please refresh.', 'invalid_state');
  if (order.status === 'quoted' && order.quoteExpiresAt && new Date(order.quoteExpiresAt) < new Date()) throw conflict('This quote has expired. Please contact the store.', 'quote_expired');
  if (order.quotedAmount === null) throw conflict('No quote available yet.', 'no_quote');
  type RzOrder = { id: string; amount: number; currency: string };
  let razorpayOrder = null as RzOrder | null;
  if (paymentMethod === 'razorpay') {
    razorpayOrder = await razorpayClient().orders.create({ amount: Math.round(order.quotedAmount * 100), currency: 'INR', receipt: order.orderNumber }) as unknown as RzOrder;
  }
  await tx(async (c) => {
    await transition(c, order.id, ['quoted', 'awaiting_payment'], paymentMethod === 'cod' ? 'ready_to_dispatch' : 'awaiting_payment', req.user!.id,
      { payment_method: paymentMethod, payment_status: paymentMethod === 'cod' ? 'cod_pending' : 'pending' });
    await c.query('delete from payments where order_id = $1 and status = $2', [order.id, 'pending']);
    await c.query('insert into payments (order_id, method, amount, status, razorpay_order_id) values ($1,$2,$3,$4,$5)',
      [order.id, paymentMethod, order.quotedAmount, paymentMethod === 'cod' ? 'cod_pending' : 'pending', razorpayOrder?.id ?? null]);
    await notifyAdmins(order.id, paymentMethod === 'cod' ? 'ready_to_dispatch' : 'awaiting_payment', 'Quote accepted',
      `${order.orderNumber} accepted (${paymentMethod === 'cod' ? 'Cash on delivery' : 'Razorpay'})`, c);
  });
  res.json({
    order: await loadOrder(order.id, req.user!),
    razorpay: razorpayOrder ? { orderId: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency, keyId: config.razorpay.keyId } : null,
  });
});

async function markPaid(c: pg.PoolClient, razorpayOrderId: string, paymentId: string, signature: string | null) {
  const pay = await c.query('select * from payments where razorpay_order_id = $1 for update', [razorpayOrderId]);
  const p = pay.rows[0];
  if (!p) throw notFound('Payment not found');
  if (p.status === 'paid') return p.order_id as string; // idempotent: verify call + webhook may both arrive
  await c.query("update payments set status = 'paid', razorpay_payment_id = $2, razorpay_signature = $3 where id = $1", [p.id, paymentId, signature]);
  const { rows } = await c.query("select status from orders where id = $1 for update", [p.order_id]);
  if (rows[0].status === 'awaiting_payment') {
    const o = await transition(c, p.order_id, ['awaiting_payment'], 'ready_to_dispatch', null, { payment_status: 'paid' });
    await notifyAdmins(p.order_id, 'payment_received', 'Payment received', `${o.order_number} paid online and is ready to dispatch`, c);
    await notify(o.customer_id, p.order_id, 'payment_received', 'Payment received', `Your payment for ${o.order_number} was successful.`, c);
  } else {
    // Paid after the order was cancelled: surface it for manual handling; never auto-promise a refund.
    await c.query("update orders set payment_status = 'paid' where id = $1", [p.order_id]);
    await notifyAdmins(p.order_id, 'payment_after_cancel', 'Payment received on a closed order', `Order ${p.order_id} was paid but is ${rows[0].status}. Handle manually.`, c);
  }
  return p.order_id as string;
}

orders.post('/:id/payment/verify', authed, requireRole('customer'), async (req, res) => {
  const b = parse(z.object({ razorpayOrderId: z.string(), razorpayPaymentId: z.string(), razorpaySignature: z.string() }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  const own = await pool.query('select 1 from payments where order_id = $1 and razorpay_order_id = $2', [order.id, b.razorpayOrderId]);
  if (!own.rows[0]) throw bad('Payment does not belong to this order.', 'payment_mismatch');
  if (!verifyPaymentSignature(b.razorpayOrderId, b.razorpayPaymentId, b.razorpaySignature)) throw bad('Payment could not be verified.', 'bad_signature');
  await tx((c) => markPaid(c, b.razorpayOrderId, b.razorpayPaymentId, b.razorpaySignature));
  res.json({ order: await loadOrder(order.id, req.user!) });
});

// Razorpay -> server webhook. Mounted with a raw body parser so the signature can be checked.
razorpayWebhook.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) throw new HttpError(400, 'bad_signature', 'Invalid signature');
  const event = JSON.parse(req.body.toString('utf8')) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
  const entity = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity) {
    await tx((c) => markPaid(c, entity.order_id, entity.id, null));
  }
  res.json({ ok: true });
});
