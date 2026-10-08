import express, { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { HttpError, bad, conflict, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { fillOrderCoordinates } from '../geocode.js';
import { distanceMeters, etaMinutes, releasePartner, storeLocation } from '../partnerState.js';
import { CANCELLABLE, loadOrder, transition } from '../orderService.js';
import { isServiceable } from '../pincodes.js';
import { isSlotBookable, SLOTS } from '../slots.js';
import jwt from 'jsonwebtoken';
import type { AuthUser } from '../auth.js';
import { INVOICE_STATUSES, streamInvoice } from '../invoice.js';
import { isBlockedFile, jpgUrl, razorpayClient, verifyPaymentSignature, verifyWebhookSignature } from '../services.js';

export const orders = Router();
export const razorpayWebhook = Router();

const MAX_FILES = 3;
const MAX_BYTES = 10 * 1024 * 1024;

const createSchema = z.object({
  kind: z.enum(['prescription', 'medicines']),
  items: z.array(z.object({ name: z.string().trim().min(2).max(120), quantity: z.number().int().min(1).max(99) })).max(30).default([]),
  prescriptions: z.array(z.object({
    publicId: z.string().min(1).max(300),
    mimeType: z.string().min(3).max(120),
    resourceType: z.enum(['image', 'raw', 'video']).default('image'),
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
  // A prescription is required for every order. Typed medicine names are optional extras that go with it.
  if (b.prescriptions.length < 1) throw bad('Please upload your prescription to place an order.', 'prescription_required');
  if (b.prescriptions.some((p) => !p.publicId.startsWith(`prescriptions/${user.id}/`) || isBlockedFile(p.publicId))) throw bad('Invalid prescription file.', 'invalid_file');
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
      [user.id, 'prescription', b.note ?? null, snapshot, b.deliveryDate, SLOTS.find((s) => s.id === b.deliverySlot)!.label, b.idempotencyKey],
    );
    const id = ins.rows[0].id as string;
    for (const item of b.items) await c.query('insert into order_items (order_id, name, quantity) values ($1,$2,$3)', [id, item.name, item.quantity]);
    for (const p of b.prescriptions) await c.query('insert into prescriptions (order_id, url, public_id, mime_type, size_bytes, resource_type) values ($1,$2,$3,$4,$5,$6)', [id, p.url, p.publicId, p.mimeType, p.sizeBytes, p.resourceType]);
    await c.query('insert into status_history (order_id, status, actor_id) values ($1,$2,$3)', [id, 'requested', user.id]);
    await notifyAdmins(id, 'order_requested', 'New order request', `${ins.rows[0].order_number} from ${user.name ?? user.phone}`, c);
    return { id, replay: false };
  });
  if (!created.replay) void fillOrderCoordinates(created.id, snapshot).catch(() => undefined); // best-effort map pin for live tracking
  res.status(created.replay ? 200 : 201).json({ order: await loadOrder(created.id, user) });
});

orders.get('/', authed, requireRole('customer'), async (req, res) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
  const { scope, limit, offset, from, to } = parse(z.object({
    scope: z.enum(['completed', 'cancelled', 'active']).default('completed'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    from: date, to: date,
  }), req.query);
  const where = scope === 'completed' ? "status = 'delivered'" : scope === 'cancelled' ? "status in ('cancelled','rejected')" : "status not in ('delivered','rejected','cancelled')";
  const { rows } = await pool.query(
    `select o.id, o.order_number, o.kind, o.status, o.quoted_amount, o.created_at, o.delivery_date,
            (select count(*) from prescriptions p where p.order_id = o.id) as file_count,
            (select string_agg(name || ' x' || quantity, ', ') from order_items i where i.order_id = o.id) as summary
     from orders o where o.customer_id = $1 and ${where}
       and ($4::date is null or (o.created_at at time zone 'Asia/Kolkata')::date >= $4::date)
       and ($5::date is null or (o.created_at at time zone 'Asia/Kolkata')::date <= $5::date)
     order by o.created_at desc limit $2 offset $3`,
    [req.user!.id, limit, offset, from ?? null, to ?? null],
  );
  res.json({ orders: rows.map((r) => ({
    id: r.id, orderNumber: r.order_number, kind: r.kind, status: r.status, createdAt: r.created_at,
    quotedAmount: r.quoted_amount === null ? null : Number(r.quoted_amount), fileCount: Number(r.file_count), summary: r.summary,
  })), hasMore: rows.length === limit });
});

/** Downloads the customer's prescription pictures (as JPEG) so they can be placed on the invoice. Failures are skipped. */
async function prescriptionImages(orderId: string): Promise<Buffer[]> {
  const { rows } = await pool.query('select public_id, mime_type, resource_type from prescriptions where order_id = $1 order by id limit 3', [orderId]);
  const out: Buffer[] = [];
  for (const r of rows) {
    const url = jpgUrl(r.public_id, r.mime_type, r.resource_type, 1, 1000);
    if (!url) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const jpeg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50;
      if (buf.length > 0 && buf.length < 6_000_000 && (jpeg || png)) out.push(buf);
    } catch { /* skip this picture */ } finally { clearTimeout(timer); }
  }
  return out;
}

/** A short-lived download link for the invoice PDF (the app opens it in the browser, which cannot send the login token). */
orders.get('/:id/invoice-link', authed, async (req, res) => {
  if (req.user!.role === 'delivery_partner') throw new HttpError(403, 'forbidden', 'Not allowed');
  const order = await loadOrder(String(req.params.id), req.user!);
  if (order.quotedAmount === null || !INVOICE_STATUSES.includes(order.status)) throw conflict('The invoice is available after you accept the amount.', 'no_invoice');
  const token = jwt.sign({ oid: order.id, purpose: 'invoice' }, config.jwtSecret, { expiresIn: '10m' });
  res.json({ url: `${req.protocol}://${req.get('host')}/orders/${order.id}/invoice.pdf?t=${encodeURIComponent(token)}` });
});

orders.get('/:id/invoice.pdf', async (req, res) => {
  let oid = '';
  try {
    const p = jwt.verify(String(req.query.t ?? ''), config.jwtSecret) as { oid?: string; purpose?: string };
    if (p.purpose !== 'invoice' || p.oid !== req.params.id) throw new Error('wrong token');
    oid = p.oid;
  } catch { throw new HttpError(401, 'invalid_link', 'This invoice link has expired. Please open it again from the app.'); }
  const order = await loadOrder(oid, { id: 'system', role: 'admin', phone: '', name: null } as unknown as AuthUser);
  const s = (await pool.query('select address, phone, email from store_settings where id = 1')).rows[0];
  const images = await prescriptionImages(order.id);
  streamInvoice(res, order, { name: 'Kamal Medical Hall', address: s?.address ?? null, phone: s?.phone ?? null, email: s?.email ?? null }, images);
});

orders.get('/:id', authed, async (req, res) => {
  res.json({ order: await loadOrder(String(req.params.id), req.user!) });
});

orders.post('/:id/cancel', authed, requireRole('customer'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(300) }), req.body);
  const order = await loadOrder(String(req.params.id), req.user!);
  await tx(async (c) => {
    const prev = await c.query('select partner_id from orders where id = $1', [order.id]);
    const row = await transition(c, order.id, CANCELLABLE, 'cancelled', req.user!.id, { cancel_reason: reason, cancelled_by: req.user!.id, partner_id: null, partner_accepted_at: null }, reason);
    row.prevPartner = prev.rows[0]?.partner_id;
    const partnerId = row.prevPartner as string | undefined;
    await c.query("update assignments set status = 'cancelled', responded_at = coalesce(responded_at, now()) where order_id = $1 and status in ('pending','accepted')", [order.id]);
    if (partnerId) await releasePartner(c, partnerId);
    const paid = row.payment_status === 'paid';
    await notifyAdmins(order.id, 'order_cancelled', 'Order cancelled by customer',
      `${order.orderNumber}: ${reason}${paid ? ' (online payment was already received; handle manually)' : ''}`, c);
    if (partnerId) await notify(partnerId, order.id, 'order_cancelled', 'Delivery cancelled', `${order.orderNumber} was cancelled`, c);
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
    try {
      razorpayOrder = await razorpayClient().orders.create({ amount: Math.round(order.quotedAmount * 100), currency: 'INR', receipt: order.orderNumber }) as unknown as RzOrder;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      console.error(JSON.stringify({ level: 'error', msg: 'razorpay order not created', status: (e as { statusCode?: number }).statusCode, reason: (e as { error?: { description?: string } }).error?.description }));
      throw new HttpError(502, 'payment_provider_error', 'Online payment is not available right now. Please try again or choose cash on delivery.');
    }
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

async function markPaid(c: pg.PoolClient, razorpayOrderId: string, paymentId: string, signature: string | null, paidPaise?: number) {
  const pay = await c.query('select * from payments where razorpay_order_id = $1 for update', [razorpayOrderId]);
  const p = pay.rows[0];
  if (!p) throw notFound('Payment not found');
  if (p.status === 'paid') return p.order_id as string; // idempotent: verify call + webhook may both arrive
  if (paidPaise !== undefined && paidPaise !== Math.round(Number(p.amount) * 100)) throw conflict('Paid amount does not match the order.', 'amount_mismatch');
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
  const event = JSON.parse(req.body.toString('utf8')) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount?: number } } } };
  const entity = event.payload?.payment?.entity;
  if ((event.event === 'payment.captured' || event.event === 'order.paid') && entity) {
    try {
      await tx((c) => markPaid(c, entity.order_id, entity.id, null, entity.amount));
    } catch (e) {
      // An order of ours that cannot be matched (or a wrong amount) will never succeed on retry: answer 200 so Razorpay stops retrying, and leave it for manual review.
      if (e instanceof HttpError && [404, 409].includes(e.status)) console.error(JSON.stringify({ level: 'error', msg: 'razorpay webhook not applied', code: e.code, event: event.event, razorpayOrder: entity.order_id }));
      else throw e;
    }
  }
  res.json({ ok: true });
});

/** Live tracking data for the customer's map: shop, destination, rider position and a rough ETA. */
orders.get('/:id/tracking', authed, requireRole('customer'), async (req, res) => {
  const order = await loadOrder(String(req.params.id), req.user!);
  const raw = await pool.query('select o.partner_id, o.partner_accepted_at, d.last_lat, d.last_lng, d.last_seen from orders o left join delivery_partners d on d.user_id = o.partner_id where o.id = $1', [order.id]);
  const r = raw.rows[0];
  const store = await storeLocation();
  const dest = order.address.latitude != null && order.address.longitude != null ? { lat: order.address.latitude, lng: order.address.longitude } : null;
  const live = order.status === 'out_for_delivery' && r?.last_lat != null;
  const rider = live ? { lat: r.last_lat as number, lng: r.last_lng as number, updatedAt: r.last_seen as string } : null;
  const from = rider ?? store;
  res.json({
    orderId: order.id, orderNumber: order.orderNumber, status: order.status,
    store: store ? { lat: store.lat, lng: store.lng } : null, destination: dest,
    partner: order.partner ? { name: order.partner.name } : null, rider,
    etaMinutes: dest && from && ['ready_to_dispatch', 'out_for_delivery'].includes(order.status) ? etaMinutes(distanceMeters(from, dest)) : null,
  });
});
