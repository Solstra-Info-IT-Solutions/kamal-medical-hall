import { withAcceptPage } from './acceptPage.js';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';
import { DAYS_AHEAD, isDateBookable, listDeliveryDates } from '../src/slots.js';

/** A moment in India time: 2026-10-10 at the given hour:minute, as a Date. */
const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 10, hh, mm) - 5.5 * 3600 * 1000);

let restoreAccept: () => Promise<void> = async () => undefined;
describe('delivery dates and the order cut-off time', () => {
  it('shows today and the next six days before the cut-off, and starts tomorrow after it', () => {
    const before = listDeliveryDates(ist(14, 0), '18:00');
    assert.equal(before.length, DAYS_AHEAD);
    assert.equal(before[0], '2026-10-10'); assert.equal(before[6], '2026-10-16');
    assert.equal(listDeliveryDates(ist(17, 59), '18:00')[0], '2026-10-10');
    const after = listDeliveryDates(ist(18, 0), '18:00');
    assert.equal(after[0], '2026-10-11'); assert.equal(after[6], '2026-10-17');
    assert.equal(listDeliveryDates(ist(23, 30), '18:00')[0], '2026-10-11');
    assert.equal(listDeliveryDates(ist(0, 5), '18:00')[0], '2026-10-10');
  });
  it('follows whatever cut-off the admin sets', () => {
    assert.equal(listDeliveryDates(ist(14, 0), '12:30')[0], '2026-10-11');
    assert.equal(listDeliveryDates(ist(14, 0), '20:00')[0], '2026-10-10');
  });
  it('only accepts dates in the list', () => {
    assert.equal(isDateBookable('2026-10-10', ist(14), '18:00'), true);
    assert.equal(isDateBookable('2026-10-10', ist(19), '18:00'), false, 'today is gone after the cut-off');
    assert.equal(isDateBookable('2026-10-17', ist(14), '18:00'), false, 'only seven days');
    assert.equal(isDateBookable('2026-10-09', ist(14), '18:00'), false, 'not the past');
  });
});

const CUSTOMER = '9555000091';
const P1 = '9555000092';
let base = '';
let server: ReturnType<typeof createServer>;
let seq = 0;
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

describe('ordering by date, and one partner carrying several orders', () => {
  let admin = '', cust = '', partner = '', addressId = '', partnerId = '', originalCutoff = '18:00';
  const stateOf = async () => (await pool.query('select state from delivery_partners where user_id = $1', [partnerId])).rows[0].state as string;

  before(async () => {
    await bootstrap();
    restoreAccept = await withAcceptPage();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    originalCutoff = (await pool.query('select order_cutoff_time from store_settings where id = 1')).rows[0].order_cutoff_time;
    const u = await pool.query("insert into users (phone, role, name) values ($1,'delivery_partner','Test Rider') on conflict (phone) do update set role = 'delivery_partner' returning id", [P1]);
    partnerId = u.rows[0].id;
    await pool.query('insert into delivery_partners (user_id) values ($1) on conflict do nothing', [partnerId]);
    admin = await login('9000000001'); cust = await login(CUSTOMER); partner = await login(P1);
    await call('PATCH', '/me', cust, { name: 'Date Tester' });
    addressId = (await call('POST', '/addresses', cust, { label: 'home', recipientName: 'Date Tester', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' })).body.address.id;
  });
  after(async () => {
    await pool.query('update store_settings set order_cutoff_time = $1 where id = 1', [originalCutoff]);
    await pool.query('delete from orders where customer_id in (select id from users where phone = $1)', [CUSTOMER]);
    await pool.query('delete from users where phone = any($1)', [[CUSTOMER, P1]]);
    closeRealtime(); server.close();
    await restoreAccept();
    await pool.end();
  });

  async function quotedOrder(date?: string) {
    const cfg = (await call('GET', '/config')).body;
    const uid = (await call('GET', '/me', cust)).body.user.id;
    const r = await call('POST', '/orders', cust, { kind: 'prescription', items: [{ name: 'Paracetamol', quantity: 1 }], addressId, deliveryDate: date ?? cfg.deliveryDates[0], idempotencyKey: `date-test-${Date.now()}-${++seq}`,
      prescriptions: [{ publicId: `prescriptions/${uid}/rx-${seq}`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx.jpg' }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const id = r.body.order.id as string;
    await call('POST', `/admin/orders/${id}/quote`, admin, { amount: 100, bill: { publicId: 'bills/test/b', mimeType: 'application/pdf', sizeBytes: 100, name: 'b.pdf' } });
    return id;
  }

  it('the admin can change the cut-off, the app config follows, and orders take a date only', async () => {
    const cfg0 = (await call('GET', '/config')).body;
    assert.equal(cfg0.deliveryDates.length, 7);
    assert.equal(cfg0.orderCutoffTime, originalCutoff);
    assert.equal((await call('PUT', '/admin/settings', cust, { isOpen: true, openingTime: '09:00', closingTime: '21:00', orderCutoffTime: '10:00' })).status, 403);
    assert.equal((await call('PUT', '/admin/settings', admin, { isOpen: true, openingTime: '09:00', closingTime: '21:00', orderCutoffTime: '25:00' })).status, 422);
    assert.equal((await call('PUT', '/admin/settings', admin, { isOpen: true, openingTime: '09:00', closingTime: '21:00', orderCutoffTime: '00:00' })).status, 204); // always "after" the cut-off: starts tomorrow
    const tomorrowFirst = (await call('GET', '/config')).body;
    assert.equal(tomorrowFirst.orderCutoffTime, '00:00');
    assert.equal((await call('GET', '/admin/settings', admin)).body.orderCutoffTime, '00:00');
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    assert.notEqual(tomorrowFirst.deliveryDates[0], today);
    assert.equal((await call('POST', '/orders', cust, { kind: 'prescription', items: [], addressId, deliveryDate: today, idempotencyKey: `date-test-today-${Date.now()}`, prescriptions: [{ publicId: 'x', mimeType: 'image/jpeg', sizeBytes: 1, url: 'https://example.com/x.jpg' }] })).status, 400, 'invalid file or date, either way not placed');
    await call('PUT', '/admin/settings', admin, { isOpen: true, openingTime: '09:00', closingTime: '21:00', orderCutoffTime: '23:59' });
    const order = await quotedOrder((await call('GET', '/config')).body.deliveryDates[0]);
    const o = (await call('GET', `/orders/${order}`, cust)).body.order;
    assert.equal(o.deliverySlot, null, 'no time slot is stored');
    const bad = await call('POST', '/orders', cust, { kind: 'prescription', items: [], addressId, deliveryDate: '2020-01-01', idempotencyKey: `date-test-old-${Date.now()}`, prescriptions: [{ publicId: `prescriptions/x/y`, mimeType: 'image/jpeg', sizeBytes: 1, url: 'https://example.com/x.jpg' }] });
    assert.ok([400].includes(bad.status));
    await call('PUT', '/admin/settings', admin, { isOpen: true, openingTime: '09:00', closingTime: '21:00', orderCutoffTime: originalCutoff });
  });

  it('gives several orders to one partner, even before the customer has confirmed, and keeps the state right', async () => {
    const [o1, o2, o3] = [await quotedOrder(), await quotedOrder(), await quotedOrder()];
    for (const id of [o1, o2]) assert.equal((await call('POST', `/admin/orders/${id}/assign`, admin, { partnerId })).status, 200, 'assigned while the customer is still to confirm');
    assert.equal(await stateOf(), 'reserved');
    assert.equal((await call('GET', '/partner/orders', partner)).body.orders.length, 2, 'both show up for the partner');
    assert.equal((await call('POST', `/orders/${o1}/accept`, partner)).status, 404);
    assert.equal((await call('POST', `/partner/orders/${o1}/accept`, partner)).status, 200);
    assert.equal((await call('POST', `/partner/orders/${o2}/accept`, partner)).status, 200);
    const early = await call('POST', `/partner/orders/${o1}/out-for-delivery`, partner);
    assert.equal(early.status, 409); assert.equal(early.body.error.code, 'waiting_for_customer');

    // the customer confirms (cash on delivery): the partner is told, and can start
    assert.equal((await call('POST', `/orders/${o1}/accept-quote`, cust, { paymentMethod: 'cod' })).body.order.status, 'ready_to_dispatch');
    assert.ok((await pool.query("select 1 from notifications where order_id = $1 and type = 'order_confirmed' and user_id = $2", [o1, partnerId])).rows.length >= 1, 'partner notified');
    assert.equal((await call('POST', `/orders/${o2}/accept-quote`, cust, { paymentMethod: 'cod' })).status, 200);
    assert.equal((await call('POST', `/partner/orders/${o1}/out-for-delivery`, partner)).status, 200);
    assert.equal(await stateOf(), 'busy');

    // more work can be added while they are out
    assert.equal((await call('POST', `/admin/orders/${o3}/assign`, admin, { partnerId })).status, 200);
    assert.equal(await stateOf(), 'busy', 'still busy, not downgraded');
    assert.equal((await call('POST', `/admin/orders/${o3}/unassign`, admin)).status, 200, 'taken back before the customer confirmed');
    assert.equal(await stateOf(), 'busy');

    // delivering the first leaves the second waiting at the shop: reserved, not available
    assert.equal((await call('POST', `/partner/orders/${o1}/delivered`, partner, { collectedVia: 'cash' })).status, 200);
    assert.equal(await stateOf(), 'reserved');
    assert.equal((await call('POST', `/partner/orders/${o2}/out-for-delivery`, partner)).status, 200);
    assert.equal(await stateOf(), 'busy');
    assert.equal((await call('POST', `/partner/orders/${o2}/delivered`, partner, { collectedVia: 'cash' })).status, 200);
    assert.ok(['off', 'available'].includes(await stateOf()), 'free again once everything is delivered');

    // a customer who cancels frees the partner too
    const o4 = await quotedOrder();
    await call('POST', `/admin/orders/${o4}/assign`, admin, { partnerId });
    assert.equal(await stateOf(), 'reserved');
    assert.equal((await call('POST', `/orders/${o4}/cancel`, cust, { reason: 'Not needed any more' })).status, 200);
    assert.ok(['off', 'available'].includes(await stateOf()));
  });
});
