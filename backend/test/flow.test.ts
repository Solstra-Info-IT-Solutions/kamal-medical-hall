import { withAcceptPage } from './acceptPage.js';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createServer } from '../src/server.js';
import { closeRealtime } from '../src/realtime.js';
import { pool } from '../src/db.js';

const BILL = { publicId: 'bills/test/bill-1', mimeType: 'application/pdf', sizeBytes: 1000, name: 'bill.pdf' };
const CUSTOMER = '9111111111';
const OTHER = '9111111112';
const SHOP = { lat: 26.85, lng: 75.76 };
let base = '';
let server: ReturnType<typeof createServer>;

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
async function newOrder(token: string, addressId: string, key: string) {
  const cfg = await call('GET', '/config');
  const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
  const slot = day.slots.find((s: any) => s.available);
  const uid = (await call('GET', '/me', token)).body.user.id;
  const rx = [{ publicId: `prescriptions/${uid}/rx-1`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx-1.jpg' }];
  const none = await call('POST', '/orders', token, { kind: 'prescription', items: [{ name: 'Paracetamol 500mg', quantity: 2 }], prescriptions: [], addressId, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: `${key}-norx` });
  assert.equal(none.status, 400); assert.equal(none.body.error.code, 'prescription_required');
  const r = await call('POST', '/orders', token, { kind: 'prescription', prescriptions: rx, items: [{ name: 'Paracetamol 500mg', quantity: 2 }], addressId, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: key });
  assert.equal(r.status, 201);
  return r.body.order.id as string;
}
const settings = (extra: object = {}) => ({ isOpen: true, openingTime: '09:00', closingTime: '21:00', latitude: SHOP.lat, longitude: SHOP.lng, geofenceM: 150, ...extra });

let restoreAccept: () => Promise<void> = async () => undefined;
describe('order lifecycle with partner duty, acceptance and return-to-shop', () => {
  before(async () => {
    await bootstrap();
    restoreAccept = await withAcceptPage();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const admin = await login('9000000001');
    await call('PUT', '/admin/settings', admin.token, settings());
    await pool.query("update delivery_partners set on_duty = false, state = 'off', is_available = false, can_call_customer = true where user_id in (select id from users where phone in ('9000000002','9000000003'))");
  });
  after(async () => {
    await pool.query('delete from orders where customer_id in (select id from users where phone = any($1))', [[CUSTOMER, OTHER]]);
    await pool.query('delete from users where phone = any($1)', [[CUSTOMER, OTHER]]);
    await pool.query("update delivery_partners set on_duty = false, state = 'off', is_available = false, can_call_customer = true where user_id in (select id from users where phone in ('9000000002','9000000003'))");
    await pool.query("delete from attendance where partner_id in (select id from users where phone in ('9000000002','9000000003'))");
    await pool.query('update store_settings set latitude = null, longitude = null, upi_id = null, upi_name = null, bank_name = null, bank_account_name = null, bank_account_number = null, bank_ifsc = null where id = 1');
    closeRealtime(); server.close();
    await restoreAccept();
    await pool.end();
  });

  it('rejects wrong OTP and unauthenticated calls', async () => {
    assert.equal((await call('POST', '/auth/dev-login', undefined, { phone: CUSTOMER, otp: '000000' })).status, 401);
    assert.equal((await call('GET', '/me')).status, 401);
  });

  it('runs customer -> admin -> partner (accept, ride, pay, return) end to end', async () => {
    const cust = await login(CUSTOMER);
    assert.equal(cust.session.needsProfile, true);
    await call('PATCH', '/me', cust.token, { name: 'Test Customer' });
    const addrBody = { label: 'home', recipientName: 'Test Customer', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' };
    assert.equal((await call('POST', '/addresses', cust.token, { ...addrBody, pincode: '110001' })).body.error.code, 'unsupported_pincode');
    const addr = await call('POST', '/addresses', cust.token, addrBody);
    assert.equal(addr.status, 201);
    const id = await newOrder(cust.token, addr.body.address.id, 'test-key-0001');

    const other = await login(OTHER);
    assert.equal((await call('GET', `/orders/${id}`, other.token)).status, 404);
    assert.equal((await call('GET', '/admin/dashboard', cust.token)).status, 403);

    const admin = await login('9000000001');
    assert.equal((await call('POST', `/admin/orders/${id}/quote`, admin.token, { amount: 240, bill: BILL })).body.order.status, 'quoted');
    assert.equal((await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'cod' })).body.order.status, 'ready_to_dispatch');

    const partners = (await call('GET', '/admin/partners', admin.token)).body.partners;
    const p = partners.find((x: any) => x.phone === '9000000002');
    assert.equal(p.state, 'off');
    // The admin may assign an absent (off duty) partner; taking the order back returns them to off duty.
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id })).status, 200);
    assert.equal((await call('POST', `/admin/orders/${id}/unassign`, admin.token)).status, 200);
    assert.equal((await call('GET', '/admin/partners', admin.token)).body.partners.find((x: any) => x.id === p.id).state, 'off');

    // Partner checks in -> available -> assigned (reserved) but the customer is not told until they accept.
    const partner = await login('9000000002');
    assert.equal((await call('POST', '/partner/duty', partner.token, { onDuty: true })).body.state, 'available');
    const att = (await call('GET', '/admin/attendance', admin.token)).body;
    assert.ok(att.today.find((x: any) => x.id === p.id).present);
    const assigned = await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id });
    assert.equal(assigned.status, 200);
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'reserved');
    assert.equal((await call('GET', `/orders/${id}`, cust.token)).body.order.partner, null);

    // Before accepting: no customer phone, cannot ride.
    const pending = (await call('GET', `/orders/${id}`, partner.token)).body.order;
    assert.equal(pending.customer.phone, null);
    assert.equal(pending.address.phone, null);
    assert.equal((await call('POST', `/partner/orders/${id}/out-for-delivery`, partner.token)).body.error.code, 'not_accepted');

    const otherPartner = await login('9000000003');
    assert.equal((await call('POST', `/partner/orders/${id}/accept`, otherPartner.token)).status, 404);
    assert.equal((await call('POST', `/partner/orders/${id}/accept`, partner.token)).status, 200);
    const accepted = (await call('GET', `/orders/${id}`, partner.token)).body.order;
    assert.equal(accepted.customer.phone, CUSTOMER);
    assert.equal(accepted.canCallCustomer, true);
    assert.equal((await call('GET', `/orders/${id}`, cust.token)).body.order.partner.name, 'Staff One');

    // Admin can withdraw calling permission: the phone number disappears for that partner.
    assert.equal((await call('PATCH', `/admin/partners/${p.id}`, admin.token, { canCallCustomer: false })).status, 204);
    const masked = (await call('GET', `/orders/${id}`, partner.token)).body.order;
    assert.equal(masked.customer.phone, null);
    assert.equal(masked.canCallCustomer, false);
    await call('PATCH', `/admin/partners/${p.id}`, admin.token, { canCallCustomer: true });

    // Ride: busy; the customer's map follows the rider.
    assert.equal((await call('POST', `/partner/orders/${id}/out-for-delivery`, partner.token)).body.order.status, 'out_for_delivery');
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'busy');
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'Changed my mind' })).status, 409);
    await call('POST', '/partner/location', partner.token, { lat: 26.87, lng: 75.78 });
    const track = (await call('GET', `/orders/${id}/tracking`, cust.token)).body;
    assert.equal(track.rider.lat, 26.87);
    assert.equal(track.store.lat, SHOP.lat);

    // Payment details are available to show on a COD order, and completing without recording payment is refused.
    await call('PUT', '/admin/payment-details', admin.token, { upiId: 'kamalmedical@upi', upiName: 'Kamal Medical Hall', bankName: 'SBI', bankAccountName: 'Kamal Medical Hall', bankAccountNumber: '123456789012', bankIfsc: 'sbin0001234' });
    const pay = (await call('GET', `/partner/orders/${id}/payment-details`, partner.token)).body;
    assert.equal(pay.amount, 240);
    assert.match(pay.upiUri, /^upi:\/\/pay\?pa=kamalmedical%40upi/);
    assert.equal(pay.bankIfsc, 'SBIN0001234');
    assert.equal((await call('POST', `/partner/orders/${id}/delivered`, partner.token, {})).body.error.code, 'payment_required');
    // UPI needs the transaction id and the payment screenshot (uploaded into the partner's own folder).
    assert.equal((await call('POST', `/partner/orders/${id}/delivered`, partner.token, { collectedVia: 'upi', reference: 'UTR12345' })).body.error.code, 'payment_proof_required');
    assert.equal((await call('POST', `/partner/orders/${id}/delivered`, partner.token, { collectedVia: 'upi', reference: 'UTR12345', proof: { publicId: 'proofs/someone-else/shot', mimeType: 'image/jpeg' } })).body.error.code, 'bad_proof');
    const me = (await call('GET', '/me', partner.token)).body.user;
    const done = await call('POST', `/partner/orders/${id}/delivered`, partner.token, { collectedVia: 'upi', reference: 'UTR12345', proof: { publicId: `proofs/${me.id}/shot-1`, mimeType: 'image/jpeg' } });
    assert.equal(done.body.order.status, 'delivered');
    assert.equal(done.body.order.paymentStatus, 'paid', 'UPI with a transaction id is paid straight away');
    const seen = (await call('GET', `/orders/${id}`, admin.token)).body.order.collection;
    assert.equal(seen.via, 'upi'); assert.equal(seen.reference, 'UTR12345'); assert.equal(seen.collectedBy, me.name);

    // Back to the shop: stays "returning" until the partner is actually at the shop, then becomes available by itself.
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'returning');
    assert.equal((await call('POST', '/partner/location', partner.token, { lat: 26.9, lng: 75.9 })).body.arrived, false);
    assert.equal((await call('POST', '/partner/arrived', partner.token)).body.error.code, 'not_at_shop');
    const back = await call('POST', '/partner/location', partner.token, { lat: SHOP.lat + 0.0003, lng: SHOP.lng });
    assert.equal(back.body.arrived, true);
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'available');

    const delivered = (await call('GET', '/partner/orders?scope=delivered', partner.token)).body.orders;
    assert.ok(delivered.some((o: any) => o.id === id));
    const completed = await call('GET', '/orders', cust.token);
    assert.ok(completed.body.orders.some((o: any) => o.id === id));
    const row = (await pool.query("select collected_via, collection_ref from payments where order_id = $1", [id])).rows[0];
    assert.equal(row.collected_via, 'upi');
    assert.equal(row.collection_ref, 'UTR12345');
  });

  it('lets a partner reject an assignment and the admin reassign', async () => {
    const cust = await login(CUSTOMER);
    const addrs = await call('GET', '/addresses', cust.token);
    const id = await newOrder(cust.token, addrs.body.addresses[0].id, 'test-key-0002');
    const admin = await login('9000000001');
    await call('POST', `/admin/orders/${id}/quote`, admin.token, { amount: 100, bill: BILL });
    await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'cod' });
    const partner = await login('9000000002');
    await call('POST', '/partner/duty', partner.token, { onDuty: true });
    const p = (await call('GET', '/admin/partners', admin.token)).body.partners.find((x: any) => x.phone === '9000000002');
    await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id });
    assert.equal((await call('POST', `/partner/orders/${id}/reject`, partner.token, { reason: 'Bike puncture' })).status, 200);
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'available');
    const order = (await call('GET', `/orders/${id}`, admin.token)).body.order;
    assert.equal(order.partner, null);
    assert.equal(order.status, 'ready_to_dispatch');
    const rejected = (await call('GET', '/partner/orders?scope=rejected', partner.token)).body.orders;
    assert.equal(rejected.find((o: any) => o.id === id).rejectedReason, 'Bike puncture');
    // Reassign, then admin takes it back; the partner is freed.
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id })).status, 200);
    assert.equal((await call('POST', `/admin/orders/${id}/unassign`, admin.token)).status, 200);
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'available');
  });

  it('lets a customer cancel before dispatch (reason required) and frees the partner', async () => {
    const cust = await login(CUSTOMER);
    const addrs = await call('GET', '/addresses', cust.token);
    const id = await newOrder(cust.token, addrs.body.addresses[0].id, 'test-key-0003');
    const admin = await login('9000000001');
    await call('POST', `/admin/orders/${id}/quote`, admin.token, { amount: 90, bill: BILL });
    await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'cod' });
    const partner = await login('9000000002');
    const p = (await call('GET', '/admin/partners', admin.token)).body.partners.find((x: any) => x.phone === '9000000002');
    await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id });
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'reserved');
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'no' })).status, 422);
    assert.equal((await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'Ordered by mistake' })).body.order.status, 'cancelled');
    assert.equal((await call('GET', '/partner/me', partner.token)).body.state, 'available');
    assert.equal((await call('GET', '/orders', cust.token)).body.orders.some((o: any) => o.id === id), false); // history = completed only
  });

  it('tracks attendance and lets the partner check out only when idle', async () => {
    const admin = await login('9000000001');
    const partner = await login('9000000002');
    const att = (await call('GET', '/admin/attendance?days=7', admin.token)).body;
    assert.equal(att.dates.length, 7);
    assert.ok(att.summary.present >= 1);
    assert.equal(att.history.find((h: any) => h.name === 'Staff One').days.at(-1), 'present');
    assert.equal((await call('POST', '/partner/duty', partner.token, { onDuty: false })).body.state, 'off');
    assert.equal((await call('GET', '/admin/partners', admin.token)).body.partners.find((x: any) => x.phone === '9000000002').onDuty, false);
  });
});
