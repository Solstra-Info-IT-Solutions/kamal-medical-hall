import { withAcceptPage } from './acceptPage.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';
import { razorpayClient } from '../src/services.js';

const BILL = { publicId: 'bills/test/bill-pay', mimeType: 'application/pdf', sizeBytes: 1000, name: 'bill.pdf' };
const CUSTOMER = '9555000031';
const OTHER = '9555000032';
const KEY_SECRET = 'test_key_secret_for_unit_tests';
const WEBHOOK_SECRET = 'test_webhook_secret_for_unit_tests';
let base = '';
let server: ReturnType<typeof createServer>;
let seq = 0;
const created: { amount: number; receipt: string }[] = [];
let failCreate = false;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function login(phone: string) {
  const r = await call('POST', '/auth/dev-login', undefined, { phone, otp: '123456' });
  await call('POST', '/auth/session', r.body.token);
  return r.body.token as string;
}
const sign = (orderId: string, paymentId: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
async function webhook(payload: object, secret = WEBHOOK_SECRET) {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${base}/webhooks/razorpay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }, body: raw });
  return { status: res.status };
}
const captured = (rzOrder: string, payId: string, paise: number) => ({ event: 'payment.captured', payload: { payment: { entity: { id: payId, order_id: rzOrder, amount: paise } } } });

let restoreAccept: () => Promise<void> = async () => undefined;
describe('online payment with Razorpay', () => {
  let admin = '', cust = '', other = '', addressId = '';
  const saved = { ...config.razorpay };

  /** A quoted order that is ready for the customer to pay. */
  async function quotedOrder(amount: number) {
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const uid = (await call('GET', '/me', cust)).body.user.id;
    const r = await call('POST', '/orders', cust, {
      kind: 'prescription', items: [{ name: 'Paracetamol', quantity: 1 }], addressId, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: `pay-test-${Date.now()}-${++seq}`,
      prescriptions: [{ publicId: `prescriptions/${uid}/rx-${seq}`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx.jpg' }],
    });
    assert.equal(r.status, 201);
    const id = r.body.order.id as string;
    assert.equal((await call('POST', `/admin/orders/${id}/quote`, admin, { amount, bill: BILL })).body.order.status, 'quoted');
    return id;
  }
  const pay = (id: string) => call('POST', `/orders/${id}/accept-quote`, cust, { paymentMethod: 'razorpay' });

  before(async () => {
    Object.assign(config.razorpay, { keyId: 'rzp_test_unit', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
    (razorpayClient().orders as any).create = async (o: { amount: number; receipt: string }) => {
      if (failCreate) throw Object.assign(new Error('boom'), { statusCode: 500, error: { description: 'Razorpay is down' } });
      created.push(o);
      return { id: `order_test_${++seq}_${crypto.randomBytes(3).toString('hex')}`, amount: o.amount, currency: 'INR' };
    };
    await bootstrap();
    restoreAccept = await withAcceptPage();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001');
    await call('PUT', '/admin/settings', admin, { isOpen: true, openingTime: '09:00', closingTime: '21:00' });
    cust = await login(CUSTOMER); other = await login(OTHER);
    await call('PATCH', '/me', cust, { name: 'Pay Tester' });
    addressId = (await call('POST', '/addresses', cust, { label: 'home', recipientName: 'Pay Tester', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' })).body.address.id;
  });
  after(async () => {
    Object.assign(config.razorpay, saved);
    await pool.query('delete from orders where customer_id in (select id from users where phone = any($1))', [[CUSTOMER, OTHER]]);
    await pool.query('delete from users where phone = any($1)', [[CUSTOMER, OTHER]]);
    closeRealtime(); server.close();
    await restoreAccept();
    await pool.end();
  });

  it('creates a Razorpay order for the exact quoted amount, in paise, and waits for payment', async () => {
    const id = await quotedOrder(249.5);
    const r = await pay(id);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.status, 'awaiting_payment');
    assert.equal(r.body.razorpay.amount, 24950);
    assert.equal(r.body.razorpay.currency, 'INR');
    assert.equal(r.body.razorpay.keyId, 'rzp_test_unit');
    assert.equal(created.at(-1)!.amount, 24950);
    assert.equal(created.at(-1)!.receipt, r.body.order.orderNumber);
    assert.equal((await pool.query('select status from payments where order_id = $1', [id])).rows[0].status, 'pending');
    // trying again (payment sheet closed) replaces the pending payment instead of duplicating it
    assert.equal((await pay(id)).status, 200);
    assert.equal((await pool.query('select count(*)::int as n from payments where order_id = $1', [id])).rows[0].n, 1);
  });

  it('confirms a payment only with a valid signature, for the right order, and only once', async () => {
    const id = await quotedOrder(100);
    const rz = (await pay(id)).body.razorpay.orderId as string;
    const verify = (token: string, body: object) => call('POST', `/orders/${id}/payment/verify`, token, body);
    assert.equal((await verify(cust, { razorpayOrderId: rz, razorpayPaymentId: 'pay_1', razorpaySignature: 'f'.repeat(64) })).body.error.code, 'bad_signature');
    assert.equal((await verify(cust, { razorpayOrderId: 'order_other', razorpayPaymentId: 'pay_1', razorpaySignature: sign('order_other', 'pay_1') })).body.error.code, 'payment_mismatch');
    assert.equal((await verify(other, { razorpayOrderId: rz, razorpayPaymentId: 'pay_1', razorpaySignature: sign(rz, 'pay_1') })).status, 404, 'another customer cannot touch it');
    assert.equal((await call('GET', `/orders/${id}`, cust)).body.order.status, 'awaiting_payment', 'nothing changed so far');

    const ok = await verify(cust, { razorpayOrderId: rz, razorpayPaymentId: 'pay_1', razorpaySignature: sign(rz, 'pay_1') });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.order.status, 'ready_to_dispatch');
    assert.equal(ok.body.order.paymentStatus, 'paid');
    assert.equal((await verify(cust, { razorpayOrderId: rz, razorpayPaymentId: 'pay_1', razorpaySignature: sign(rz, 'pay_1') })).status, 200, 'repeat is harmless');
    assert.equal((await pool.query("select count(*)::int as n from notifications n join users u on u.id = n.user_id where n.order_id = $1 and n.type = 'payment_received' and u.phone = $2", [id, CUSTOMER])).rows[0].n, 1, 'customer is told once');
  });

  it('accepts the webhook as a back-up when the app never got to confirm', async () => {
    const id = await quotedOrder(80);
    const rz = (await pay(id)).body.razorpay.orderId as string;
    assert.equal((await webhook(captured(rz, 'pay_w1', 8000), 'wrong_secret')).status, 400);
    assert.equal((await fetch(`${base}/webhooks/razorpay`, { method: 'POST', body: '{}' })).status, 400, 'unsigned is refused');
    assert.equal((await webhook(captured(rz, 'pay_w1', 9999))).status, 200, 'wrong amount: acknowledged but not applied');
    assert.equal((await call('GET', `/orders/${id}`, cust)).body.order.status, 'awaiting_payment');
    assert.equal((await webhook(captured(rz, 'pay_w1', 8000))).status, 200);
    assert.equal((await call('GET', `/orders/${id}`, cust)).body.order.status, 'ready_to_dispatch');
    assert.equal((await webhook(captured(rz, 'pay_w1', 8000))).status, 200, 'Razorpay retries are harmless');
    assert.equal((await webhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_not_ours', amount: 100 } } } })).status, 200, 'unknown orders do not make Razorpay retry forever');
    assert.equal((await webhook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: rz } } } })).status, 200);
  });

  it('flags a payment that arrives after the order was cancelled instead of reviving it', async () => {
    const id = await quotedOrder(60);
    const rz = (await pay(id)).body.razorpay.orderId as string;
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust, { reason: 'Changed my mind' })).status, 200);
    assert.equal((await webhook(captured(rz, 'pay_late', 6000))).status, 200);
    const o = (await call('GET', `/orders/${id}`, cust)).body.order;
    assert.equal(o.status, 'cancelled');
    assert.equal(o.paymentStatus, 'paid');
    assert.ok((await pool.query("select 1 from notifications where order_id = $1 and type = 'payment_after_cancel'", [id])).rows.length >= 1, 'admins are told to handle it');
  });

  it('shows a clear message and keeps the order intact when Razorpay is unavailable; cash on delivery still works', async () => {
    const id = await quotedOrder(50);
    failCreate = true;
    const down = await pay(id);
    failCreate = false;
    assert.equal(down.status, 502); assert.equal(down.body.error.code, 'payment_provider_error');
    assert.match(down.body.error.message, /cash on delivery/i);
    assert.equal((await call('GET', `/orders/${id}`, cust)).body.order.status, 'quoted', 'order untouched');
    assert.equal((await call('POST', `/orders/${id}/accept-quote`, cust, { paymentMethod: 'cod' })).body.order.status, 'ready_to_dispatch');
  });

  it('refuses online payment when Razorpay keys are not configured', async () => {
    const id = await quotedOrder(40);
    const keep = config.razorpay.keyId;
    config.razorpay.keyId = '';
    try { assert.equal((await pay(id)).status, 503); } finally { config.razorpay.keyId = keep; }
  });
});
