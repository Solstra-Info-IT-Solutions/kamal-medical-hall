import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { closingAlertTick } from '../src/cash.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';

const CUSTOMER = '9555000041';
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

describe('cash from delivery partners, and the closing alert', () => {
  let admin = '', cust = '', addressId = '', partnerId = '', adminId = '';

  /** An order that a partner already delivered for cash, built directly in the database. */
  async function cashOrder(amount: number, via: 'cash' | 'upi' = 'cash') {
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const uid = (await call('GET', '/me', cust)).body.user.id;
    const r = await call('POST', '/orders', cust, { kind: 'prescription', items: [{ name: 'Cough syrup', quantity: 1 }], addressId, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: `cash-test-${Date.now()}-${++seq}`,
      prescriptions: [{ publicId: `prescriptions/${uid}/rx-${seq}`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx.jpg' }] });
    const id = r.body.order.id as string;
    await pool.query("update orders set status = 'delivered', quoted_amount = $2, payment_method = 'cod', payment_status = $3, partner_id = $4, updated_at = now() where id = $1", [id, amount, via === 'cash' ? 'cod_collected' : 'paid', partnerId]);
    await pool.query("insert into payments (order_id, method, amount, status, collected_by, collected_via, collection_ref, collected_at) values ($1,'cod',$2,$3,$4,$5,$6,now())", [id, amount, via === 'cash' ? 'cod_collected' : 'paid', partnerId, via, via === 'upi' ? 'UTR999888' : null]);
    return id;
  }

  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001');
    await login('9000000002');
    cust = await login(CUSTOMER);
    await call('PATCH', '/me', cust, { name: 'Cash Tester' });
    addressId = (await call('POST', '/addresses', cust, { label: 'home', recipientName: 'Cash Tester', phone: CUSTOMER, line1: 'B-12 Mansarovar', pincode: '302020' })).body.address.id;
    partnerId = (await pool.query("select id from users where phone = '9000000002'")).rows[0].id;
    adminId = (await pool.query("select id from users where phone = '9000000001'")).rows[0].id;
    // start from a clean slate: nothing left over from other runs
    await pool.query("update payments set cash_settled_at = now() where collected_via = 'cash' and cash_settled_at is null");
  });
  after(async () => {
    await pool.query('delete from orders where customer_id in (select id from users where phone = $1)', [CUSTOMER]);
    await pool.query('delete from users where phone = $1', [CUSTOMER]);
    await pool.query('update store_settings set closing_time = $1, closing_alert_day = null where id = 1', ['21:00']);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('lists the cash each partner still has to hand over, and ignores UPI payments', async () => {
    const a = await cashOrder(300);
    const b = await cashOrder(450);
    await cashOrder(999, 'upi');
    const r = await call('GET', '/admin/cash', admin);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 750);
    assert.equal(r.body.partners.length, 1);
    assert.equal(r.body.partners[0].name, 'Staff One');
    assert.deepEqual(r.body.partners[0].orders.map((o: any) => o.amount).sort(), [300, 450]);
    assert.equal((await call('GET', '/admin/cash', cust)).status, 403);

    // receiving part of it: only that order is marked paid
    const s1 = await call('POST', '/admin/cash/settle', admin, { partnerId, orderIds: [a] });
    assert.equal(s1.status, 200); assert.equal(s1.body.settled, 1); assert.equal(s1.body.amount, 300);
    assert.equal(s1.body.total, 450);
    assert.equal((await call('GET', `/orders/${a}`, admin)).body.order.paymentStatus, 'paid');
    assert.equal((await call('GET', `/orders/${b}`, admin)).body.order.paymentStatus, 'cod_collected');
    // the rest
    const s2 = await call('POST', '/admin/cash/settle', admin, { partnerId });
    assert.equal(s2.body.settled, 1); assert.equal(s2.body.total, 0);
    assert.equal((await call('POST', '/admin/cash/settle', admin, { partnerId })).body.error.code, 'nothing_to_settle');
    assert.equal((await call('GET', `/orders/${b}`, admin)).body.order.paymentStatus, 'paid');
    assert.equal((await pool.query('select cash_settled_by from payments where order_id = $1', [b])).rows[0].cash_settled_by, adminId);
  });

  it("sums up today's revenue and says who has to hand in what", async () => {
    await cashOrder(200);
    const r = await call('GET', '/admin/closing-summary', admin);
    assert.equal(r.status, 200);
    assert.ok(r.body.revenue.total >= 1649 + 0, 'includes the orders delivered above');
    assert.ok(r.body.revenue.orders >= 4);
    assert.equal(r.body.cash.total, 200);
    assert.match(r.body.message, /Staff One ₹200/);
    assert.match(r.body.message, /Today's revenue/);
    await call('POST', '/admin/cash/settle', admin, { partnerId });
  });

  it('sends the closing alert once, from one hour before closing time', async () => {
    await cashOrder(120);
    const ist = (add: number) => { const d = new Date(Date.now() + add * 60000); const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); return p; };
    const count = async () => (await pool.query("select count(*)::int as n from notifications where type = 'closing_alert' and created_at > now() - interval '5 minutes'")).rows[0].n as number;
    await pool.query('update store_settings set is_open = true, closing_alert_day = null where id = 1');

    await pool.query('update store_settings set closing_time = $1 where id = 1', [ist(180)]); // closes in 3 hours: too early
    const before = await count();
    await closingAlertTick();
    assert.equal(await count(), before, 'nothing yet');

    await pool.query('update store_settings set closing_time = $1 where id = 1', [ist(50)]); // closes in 50 minutes
    await closingAlertTick();
    const admins = (await pool.query("select count(*)::int as n from users where role = 'admin'")).rows[0].n as number;
    assert.equal(await count(), before + admins, 'every admin is told');
    const n = (await pool.query("select body from notifications where type = 'closing_alert' order by created_at desc limit 1")).rows[0];
    assert.match(n.body, /Staff One ₹120/);
    await closingAlertTick();
    assert.equal(await count(), before + admins, 'only once a day');

    await pool.query('update store_settings set is_open = false, closing_alert_day = null where id = 1'); // closed today: no alert
    await closingAlertTick();
    assert.equal(await count(), before + admins);
    await pool.query('update store_settings set is_open = true where id = 1');
    await call('POST', '/admin/cash/settle', admin, { partnerId });
  });
});
