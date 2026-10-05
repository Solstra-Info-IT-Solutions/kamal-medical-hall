import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { bootstrap, createServer } from '../src/server.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';

const BILL = { publicId: 'bills/test/bill-1', mimeType: 'application/pdf', sizeBytes: 1000, name: 'bill.pdf' };
const CUSTOMER = '9222222221';
const TEST_PIN = '399999';
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
  const s = await call('POST', '/auth/session', r.body.token);
  return { token: r.body.token as string, user: s.body.user };
}
const waitFor = (socket: Socket, event: string, ms = 8000) => new Promise<any>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
  socket.once(event, (p) => { clearTimeout(t); resolve(p); });
});
const open = async (token: string) => {
  const s = connect(base, { auth: { token }, transports: ['websocket'], reconnection: false });
  await waitFor(s, 'ready');
  return s;
};

describe('realtime, pincodes, coverage and account deletion', () => {
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    await pool.query('delete from service_pincodes where pincode = $1', [TEST_PIN]);
    await pool.query('delete from orders where customer_id in (select id from users where phone = $1 or phone like $2)', [CUSTOMER, 'deleted-%']);
    await pool.query("delete from users where phone = $1 or (phone like 'deleted-%' and name is null and role = 'customer')", [CUSTOMER]);
    await pool.query("update delivery_partners set on_duty = false, state = 'off', is_available = false where user_id in (select id from users where phone in ('9000000002','9000000003'))");
    await pool.query("delete from partner_pincodes where partner_id in (select id from users where phone in ('9000000002','9000000003'))");
    closeRealtime(); server.close(); await pool.end();
  });

  it('rejects sockets without a valid token', async () => {
    const s = connect(base, { auth: { token: 'nope' }, transports: ['websocket'], reconnection: false });
    const err = await waitFor(s, 'connect_error');
    assert.match(String(err.message), /unauthorized/);
    s.close();
  });

  it('pushes notifications and order updates instantly to the right people', async () => {
    const cust = await login(CUSTOMER);
    await call('PATCH', '/me', cust.token, { name: 'Socket Tester' });
    const addr = await call('POST', '/addresses', cust.token, { label: 'home', recipientName: 'Socket Tester', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' });
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);

    const admin = await login('9000000001');
    const adminSock = await open(admin.token);
    const custSock = await open(cust.token);

    const adminGetsRequest = waitFor(adminSock, 'notification');
    const created = await call('POST', '/orders', cust.token, { kind: 'prescription', prescriptions: [{ publicId: `prescriptions/${(await call('GET', '/me', cust.token)).body.user.id}/rx-1`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx-1.jpg' }], items: [{ name: 'Paracetamol', quantity: 1 }], addressId: addr.body.address.id, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: 'rt-test-0001' });
    assert.equal(created.status, 201);
    assert.equal((await adminGetsRequest).type, 'order_requested');

    const id = created.body.order.id;
    const custGetsQuote = waitFor(custSock, 'notification');
    const custOrderUpdate = waitFor(custSock, 'order:update');
    await call('POST', `/admin/orders/${id}/quote`, admin.token, { amount: 100, bill: BILL });
    assert.equal((await custGetsQuote).type, 'quote_ready');
    assert.equal((await custOrderUpdate).status, 'quoted');

    // Coverage: a partner limited to another pincode cannot be assigned to this order.
    await call('POST', `/orders/${id}/accept-quote`, cust.token, { paymentMethod: 'cod' });
    const partners = (await call('GET', '/admin/partners', admin.token)).body.partners;
    const p = partners.find((x: any) => x.phone === '9000000002');
    await call('POST', '/admin/pincodes', admin.token, { pincodes: [TEST_PIN] });
    assert.equal((await call('PUT', `/admin/partners/${p.id}/pincodes`, admin.token, { pincodes: [TEST_PIN] })).status, 204);
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id })).body.error.code, 'out_of_coverage');
    await call('PUT', `/admin/partners/${p.id}/pincodes`, admin.token, { pincodes: ['302020'] });
    const partnerLogin = await login('9000000002');
    await call('POST', '/partner/duty', partnerLogin.token, { onDuty: true });
    const partnerSock = await open(partnerLogin.token);
    const partnerGetsJob = waitFor(partnerSock, 'notification');
    const adminSeesBusy = waitFor(adminSock, 'partner:update');
    assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin.token, { partnerId: p.id })).status, 200);
    assert.equal((await partnerGetsJob).type, 'assigned');
    assert.equal((await adminSeesBusy).isAvailable, false);

    // A customer cannot delete the account mid-order.
    assert.equal((await call('DELETE', '/me', cust.token)).body.error.code, 'active_orders');
    await call('POST', `/orders/${id}/cancel`, cust.token, { reason: 'Testing deletion flow' });
    adminSock.close(); custSock.close(); partnerSock.close();
  });

  it('lets admins manage the delivery area', async () => {
    const admin = await login('9000000001');
    const cust = await login(CUSTOMER);
    const body = { label: 'home', recipientName: 'Socket Tester', phone: CUSTOMER, line1: 'Somewhere 12', pincode: TEST_PIN };
    // TEST_PIN was added in the previous test; disabling it must block new addresses immediately.
    assert.equal((await call('POST', '/addresses', cust.token, body)).status, 201);
    assert.equal((await call('PATCH', `/admin/pincodes/${TEST_PIN}`, admin.token, { active: false })).status, 204);
    assert.equal((await call('POST', '/addresses', cust.token, body)).body.error.code, 'unsupported_pincode');
    assert.ok(!(await call('GET', '/pincodes')).body.pincodes.includes(TEST_PIN));
    assert.equal((await call('POST', '/admin/pincodes', cust.token, { pincodes: [TEST_PIN] })).status, 403);
    assert.equal((await call('POST', '/admin/pincodes', admin.token, { pincodes: ['12'] })).status, 422);
  });

  it('deletes a customer account and anonymises what must be kept', async () => {
    const cust = await login(CUSTOMER);
    const res = await call('DELETE', '/me', cust.token);
    assert.equal(res.status, 204);
    assert.equal((await call('GET', '/me', cust.token)).status, 401);
    const { rows } = await pool.query("select count(*) from users where phone = $1", [CUSTOMER]);
    assert.equal(Number(rows[0].count), 0);
    const admin = await login('9000000001');
    assert.equal((await call('DELETE', '/me', admin.token)).status, 403);
  });
});
