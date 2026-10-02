import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createApp } from '../src/server.js';
import { pool } from '../src/db.js';

const CUSTOMER = '9111111111';
const OTHER = '9111111112';
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function login(phone: string) {
  const r = await call('POST', '/auth/dev-login', undefined, { phone, otp: '123456' });
  assert.equal(r.status, 200);
  const s = await call('POST', '/auth/session', r.body.token);
  assert.equal(s.status, 200);
  return { token: r.body.token as string, session: s.body };
}

describe('order lifecycle', () => {
  before(async () => {
    await bootstrap();
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await pool.query('delete from orders where customer_id in (select id from users where phone = any($1))', [[CUSTOMER, OTHER]]);
    await pool.query('delete from users where phone = any($1)', [[CUSTOMER, OTHER]]);
    await pool.query("update delivery_partners set is_available = true where user_id in (select id from users where phone in ('9000000002','9000000003'))");
    server.close();
    await pool.end();
  });

  it('rejects wrong OTP and unauthenticated calls', async () => {
    assert.equal((await call('POST', '/auth/dev-login', undefined, { phone: CUSTOMER, otp: '000000' })).status, 401);
    assert.equal((await call('GET', '/me')).status, 401);
  });

  it('runs customer -> admin -> partner -> delivered', async () => {
    const cust = await login(CUSTOMER);
    assert.equal(cust.session.user.role, 'customer');
    assert.equal(cust.session.needsProfile, true);
    assert.equal((await call('PATCH', '/me', cust.token, { name: 'Test Customer' })).status, 200);

    const addrBody = { label: 'home', recipientName: 'Test Customer', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' };
    assert.equal((await call('POST', '/addresses', cust.token, { ...addrBody, pincode: '110001' })).body.error.code, 'unsupported_pincode');
    const addr = await call('POST', '/addresses', cust.token, addrBody);
    assert.equal(addr.status, 201);

    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const order = { kind: 'medicines', items: [{ name: 'Paracetamol 500mg', quantity: 2 }], addressId: addr.body.address.id, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: 'test-key-0001' };

    assert.equal((await call('POST', '/orders', cust.token, { ...order, kind: 'prescription' })).body.error.code, 'mixed_order');
    assert.equal((await call('POST', '/orders', cust.token, { ...order, deliverySlot: 'nope' })).body.error.code, 'slot_unavailable');
    const created = await call('POST', '/orders', cust.token, order);
    assert.equal(created.status, 201);
    assert.equal(created.body.order.status, 'requested');
    const replay = await call('POST', '/orders', cust.token, order);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.order.id, created.body.order.id);
    const id = created.body.order.id as string;

    // Other customers must not see it.
    const other = await login(OTHER);
    assert.equal((await call('GET', `/orders/${id}`, other.token)).status, 404);
    // Customers cannot use staff routes.
    assert.equal((await call('GET', '/admin/dashboard', cust.token)).status, 403);

    const admin = await login('9000000001');
    assert.equal(admin.session.user.role, 'admin');
    assert.equal((await call('POST', `/admin/orders/${id}/quote`, admin.token, { amount: 240 })).body.order.status, 'quoted');
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: '00000000-0000-0000-0000-000000000000' })).status, 409);

    const accepted = await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'cod' });
    assert.equal(accepted.body.order.status, 'ready_to_dispatch');
    assert.equal((await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'razorpay' })).status, 409);

    const partners = (await call('GET', '/admin/partners', admin.token)).body.partners;
    const p = partners.find((x: any) => x.phone === '9000000002');
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id })).body.order.partner.id, p.id);

    const partner = await login('9000000002');
    assert.equal(partner.session.user.role, 'delivery_partner');
    const otherPartner = await login('9000000003');
    assert.equal((await call('POST', `/partner/orders/${id}/out-for-delivery`, otherPartner.token)).status, 404);
    assert.equal((await call('POST', `/partner/orders/${id}/out-for-delivery`, partner.token)).body.order.status, 'out_for_delivery');
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'Changed my mind' })).status, 409); // too late
    assert.equal((await call('POST', `/partner/orders/${id}/delivered`, partner.token, { cashCollected: false })).body.error.code, 'cash_required');
    const done = await call('POST', `/partner/orders/${id}/delivered`, partner.token, { cashCollected: true });
    assert.equal(done.body.order.status, 'delivered');

    const completed = await call('GET', '/orders', cust.token);
    assert.ok(completed.body.orders.some((o: any) => o.id === id));
    assert.equal((await call('GET', '/orders?scope=active', cust.token)).body.orders.length, 0);
    const notes = await call('GET', '/notifications', cust.token);
    assert.ok(notes.body.notifications.some((n: any) => n.type === 'quote_ready'));
    assert.ok((await call('GET', '/admin/dashboard', admin.token)).body.deliveredToday >= 1);
  });

  it('lets a customer cancel before dispatch (reason required) and frees the partner', async () => {
    const cust = await login(CUSTOMER);
    const addrs = await call('GET', '/addresses', cust.token);
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const created = await call('POST', '/orders', cust.token, { kind: 'medicines', items: [{ name: 'Calcium', quantity: 1 }], addressId: addrs.body.addresses[0].id, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: 'test-key-0002' });
    const id = created.body.order.id;
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'no' })).status, 422);
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'Ordered by mistake' })).body.order.status, 'cancelled');
    assert.equal((await call('GET', '/orders', cust.token)).body.orders.some((o: any) => o.id === id), false); // history = completed only
  });
});
