import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createServer } from '../src/server.js';
import { closeRealtime } from '../src/realtime.js';
import { pool } from '../src/db.js';
import { sweepDuty } from '../src/partnerState.js';

const CUSTOMER = '9222222221';
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
  assert.equal(s.status, 200);
  return r.body.token as string;
}
const settings = (isOpen: boolean) => ({ isOpen, openingTime: '09:00', closingTime: '21:00' });
const PARTNERS = "('9000000002','9000000003')";
const reset = async () => {
  await pool.query(`update delivery_partners set on_duty = false, state = 'off', is_available = false where user_id in (select id from users where phone in ${PARTNERS})`);
  await pool.query(`delete from attendance where partner_id in (select id from users where phone in ${PARTNERS})`);
  await pool.query("delete from store_closed_days where day = (now() at time zone 'Asia/Kolkata')::date");
};

describe('partner attendance statuses, store closing and terms', () => {
  let admin = '', p1 = '', p2 = '', cust = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); p1 = await login('9000000002'); p2 = await login('9000000003'); cust = await login(CUSTOMER);
    await call('PUT', '/admin/settings', admin, settings(true));
    await reset();
  });
  after(async () => {
    await call('PUT', '/admin/settings', admin, settings(true));
    await reset();
    await pool.query('delete from users where phone = $1', [CUSTOMER]);
    await pool.query("update store_settings set terms_text = null, terms_updated_at = null where id = 1");
    closeRealtime(); server.close();
    await pool.end();
  });

  it('on duty, break, back, off duty and leave', async () => {
    let r = await call('POST', '/partner/status', p1, { status: 'on_break' });
    assert.equal(r.status, 409); assert.equal(r.body.error?.code ?? r.body.code, 'not_on_duty');

    r = await call('POST', '/partner/status', p1, { status: 'on_duty' });
    assert.equal(r.body.dutyStatus, 'on_duty'); assert.equal(r.body.state, 'available');

    r = await call('POST', '/partner/status', p1, { status: 'on_break' });
    assert.equal(r.body.dutyStatus, 'on_break'); assert.equal(r.body.state, 'break');
    const team = (await call('GET', '/admin/partners', admin)).body.partners.find((p: any) => p.phone === '9000000002');
    assert.equal(team.dutyStatus, 'on_break'); assert.equal(team.isAvailable, false);

    // A partner on a break cannot be assigned an order.
    const att = (await call('GET', '/admin/attendance', admin)).body;
    assert.equal(att.summary.onBreak, 1);

    r = await call('POST', '/partner/status', p1, { status: 'on_duty' });
    assert.equal(r.body.dutyStatus, 'on_duty'); assert.equal(r.body.state, 'available');

    r = await call('POST', '/partner/status', p1, { status: 'off_duty' });
    assert.equal(r.body.dutyStatus, 'off_duty'); assert.equal(r.body.state, 'off');

    r = await call('POST', '/partner/status', p2, { status: 'leave' });
    assert.equal(r.body.dutyStatus, 'leave'); assert.equal(r.body.paidLeave, false);
    const att2 = (await call('GET', '/admin/attendance', admin)).body;
    assert.equal(att2.summary.onLeave, 1);
    assert.equal(att2.history.find((h: any) => h.id === att2.today.find((t: any) => t.phone === '9000000003').id).days.at(-1), 'leave');
    // Back from leave to duty is allowed on a day the store is open.
    r = await call('POST', '/partner/status', p2, { status: 'on_duty' });
    assert.equal(r.body.dutyStatus, 'on_duty');
    await call('POST', '/partner/status', p2, { status: 'off_duty' });

    assert.equal((await call('POST', '/partner/status', p1, { status: 'absent' })).status, 422);
    const mine = (await call('GET', '/partner/attendance', p1)).body;
    assert.equal(mine.days[0].status, 'present'); assert.equal(mine.summary.present, 1);
  });

  it('closing the store notifies customers and partners and gives partners paid leave', async () => {
    await reset();
    await call('POST', '/partner/status', p1, { status: 'on_duty' }); // p1 works today, p2 does not
    const before = await pool.query('select count(*)::int as n from notifications where type = $1', ['store_closed']);

    assert.equal((await call('PUT', '/admin/settings', admin, settings(false))).status, 204);

    const mine = await call('GET', '/me', cust);
    const notes = await call('GET', '/notifications', cust);
    assert.ok(JSON.stringify(notes.body).includes('Store closed'), 'customer notified');
    assert.ok(mine.status === 200);

    const p2notes = await call('GET', '/notifications', p2);
    assert.ok(JSON.stringify(p2notes.body).includes('paid leave'), 'partner told about paid leave');

    const a = (await call('GET', '/admin/attendance', admin)).body;
    const p2row = a.today.find((t: any) => t.phone === '9000000003');
    assert.equal(p2row.dutyStatus, 'leave'); assert.equal(p2row.paidLeave, true);
    const p1row = a.today.find((t: any) => t.phone === '9000000002');
    assert.equal(p1row.dutyStatus, 'off_duty'); // worked earlier today: checked out, not paid leave
    assert.equal(a.closedDays.length >= 1, true);

    // No check-in while the store is closed.
    const blocked = await call('POST', '/partner/status', p2, { status: 'on_duty' });
    assert.equal(blocked.status, 409);

    // Reopening gives the day back.
    assert.equal((await call('PUT', '/admin/settings', admin, settings(true))).status, 204);
    const after = (await call('GET', '/admin/attendance', admin)).body.today.find((t: any) => t.phone === '9000000003');
    assert.notEqual(after.dutyStatus, 'leave');
    assert.equal((await call('POST', '/partner/status', p2, { status: 'on_duty' })).body.dutyStatus, 'on_duty');
    assert.ok((await pool.query('select count(*)::int as n from notifications where type = $1', ['store_closed'])).rows[0].n > before.rows[0].n);
  });

  it('the sweep marks a missed working day absent but not a closed day', async () => {
    await reset();
    await pool.query(`update users set created_at = now() - interval '10 days' where phone in ${PARTNERS}`);
    const ids = (await pool.query(`select id from users where phone in ${PARTNERS}`)).rows.map((r) => r.id);
    await pool.query("insert into store_closed_days (day) values ((now() at time zone 'Asia/Kolkata')::date - 2) on conflict do nothing");
    await sweepDuty();
    const rows = await pool.query("select partner_id, status, (now() at time zone 'Asia/Kolkata')::date - day as ago from attendance where partner_id = any($1)", [ids]);
    const yesterday = rows.rows.filter((r) => r.ago === 1);
    assert.equal(yesterday.length, 2); assert.ok(yesterday.every((r) => r.status === 'absent'));
    assert.equal(rows.rows.filter((r) => r.ago === 2).length, 0, 'closed day is not an absence');
    await pool.query("delete from store_closed_days where day = (now() at time zone 'Asia/Kolkata')::date - 2");
  });

  it('admin edits terms and customers can read them', async () => {
    assert.equal((await call('GET', '/terms')).body.text, '');
    assert.equal((await call('PUT', '/admin/terms', admin, { text: '1. Prescription medicines need a valid prescription.' })).status, 204);
    const t = await call('GET', '/terms');
    assert.match(t.body.text, /valid prescription/); assert.ok(t.body.updatedAt);
    assert.equal((await call('PUT', '/admin/terms', cust, { text: 'x' })).status, 403);
  });
});
