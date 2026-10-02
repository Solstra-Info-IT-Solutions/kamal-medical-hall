import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createServer } from '../src/server.js';
import { closeRealtime } from '../src/realtime.js';
import { pool } from '../src/db.js';

const CUSTOMER = '9444444441';
const BILL = { publicId: 'bills/test/bill-9', mimeType: 'application/pdf', sizeBytes: 2048, name: 'bill.pdf' };
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
  await call('POST', '/auth/session', r.body.token);
  return r.body.token as string;
}

describe('bills, order history tabs and the open / closed switch', () => {
  let admin = '', cust = '', addressId = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); cust = await login(CUSTOMER);
    await call('PUT', '/admin/store-open', admin, { isOpen: true });
    await call('PATCH', '/me', cust, { name: 'Bill Tester' });
    addressId = (await call('POST', '/addresses', cust, { label: 'home', recipientName: 'Bill Tester', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' })).body.address.id;
  });
  after(async () => {
    await call('PUT', '/admin/store-open', admin, { isOpen: true });
    await pool.query('delete from orders where customer_id in (select id from users where phone = $1)', [CUSTOMER]);
    await pool.query('delete from users where phone = $1', [CUSTOMER]);
    closeRealtime(); server.close();
    await pool.end();
  });

  const place = async (key: string) => {
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const r = await call('POST', '/orders', cust, { kind: 'medicines', items: [{ name: 'Cetirizine 10mg', quantity: 1 }], addressId, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: key });
    assert.equal(r.status, 201);
    return r.body.order.id as string;
  };

  it('requires a bill with the amount and shows it to the customer', async () => {
    const id = await place('bill-key-0001');
    const noBill = await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 120 });
    assert.equal(noBill.status, 422);
    const badBill = await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 120, bill: { ...BILL, publicId: 'prescriptions/x/y' } });
    assert.equal(badBill.status, 400);
    const ok = await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 120, bill: BILL });
    assert.equal(ok.body.order.status, 'quoted');
    const seen = (await call('GET', `/orders/${id}`, cust)).body.order;
    assert.equal(seen.bill.name, 'bill.pdf'); assert.equal(seen.bill.mimeType, 'application/pdf');
    assert.equal(seen.store.name, 'Kamal Medical Hall');
    // Only the store admin can ask to upload a bill, and customers can still upload prescriptions.
    assert.equal((await call('POST', '/uploads/sign', cust, { purpose: 'bill' })).status, 403);
    assert.equal((await call('POST', '/uploads/sign', admin, { purpose: 'prescription' })).status, 403);
  });

  it('accepts a bill in any file type but not programs, and builds an invoice PDF', async () => {
    const id = await place('bill-key-0003');
    const exe = await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 150, bill: { publicId: 'bills/test/setup.exe', mimeType: 'application/octet-stream', resourceType: 'raw', name: 'setup.exe' } });
    assert.equal(exe.status, 400);
    const doc = await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 150, bill: { publicId: 'bills/test/bill-9.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', resourceType: 'raw', name: 'bill.docx' } });
    assert.equal(doc.body.order.status, 'quoted');
    // No invoice until the customer accepts the amount.
    assert.equal((await call('GET', `/orders/${id}/invoice-link`, cust)).status, 409);
    await call('POST', `/orders/${id}/accept-quote`, cust, { paymentMethod: 'cod' });
    const link = await call('GET', `/orders/${id}/invoice-link`, cust);
    assert.equal(link.status, 200);
    const res = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, base));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="Invoice-KMH\d+\.pdf"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.ok(bytes.length > 1500);
    // A tampered or foreign link is refused.
    assert.equal((await fetch(`${base}/orders/${id}/invoice.pdf?t=bad`)).status, 401);
    const other = await login('9444444442');
    assert.equal((await call('GET', `/orders/${id}/invoice-link`, other)).status, 404);
    await pool.query('delete from users where phone = $1', ['9444444442']);
  });

  it('lists delivered and cancelled orders separately with a date filter', async () => {
    const id = await place('bill-key-0002');
    const cancelled = await call('POST', `/orders/${id}/cancel`, cust, { reason: 'Ordered by mistake' });
    assert.equal(cancelled.body.order.status, 'cancelled');
    const list = (await call('GET', '/orders?scope=cancelled', cust)).body.orders;
    assert.ok(list.some((o: any) => o.id === id));
    assert.equal((await call('GET', '/orders?scope=completed', cust)).body.orders.some((o: any) => o.id === id), false);
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    assert.equal((await call('GET', `/orders?scope=cancelled&from=${today}&to=${today}`, cust)).body.orders.some((o: any) => o.id === id), true);
    assert.equal((await call('GET', '/orders?scope=cancelled&from=2020-01-01&to=2020-01-31', cust)).body.orders.length, 0);
    assert.equal((await call('GET', '/orders?scope=cancelled&from=bad', cust)).status, 422);
  });

  it('lets the admin open and close the store from the dashboard', async () => {
    assert.equal((await call('GET', '/admin/dashboard', admin)).body.isOpen, true);
    assert.equal((await call('PUT', '/admin/store-open', admin, { isOpen: false })).body.isOpen, false);
    assert.equal((await call('GET', '/config')).body.store.isOpen, false);
    assert.equal((await call('GET', '/admin/dashboard', admin)).body.isOpen, false);
    assert.equal((await call('PUT', '/admin/store-open', cust, { isOpen: true })).status, 403);
    assert.equal((await call('PUT', '/admin/store-open', admin, { isOpen: true })).body.isOpen, true);
  });
});
