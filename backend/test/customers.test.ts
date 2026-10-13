import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';
import { forgetSmsSettings, setSmsFetch } from '../src/sms.js';

const NEW = '9555000081';
const OTHER = '9555000082';
const ADDED = '9555000083';
let base = '';
let server: ReturnType<typeof createServer>;
let savedChannel = 'static';
let smsCalls = 0;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function devLogin(phone: string) {
  const r = await call('POST', '/auth/dev-login', undefined, { phone, otp: '123456' });
  await call('POST', '/auth/session', r.body.token);
  return r.body.token as string;
}

describe('customer sign-up, test OTP, account (de)activation requests and customer management', () => {
  let admin = '', cust = '';
  const mode = config.authMode;
  before(async () => {
    savedChannel = (await pool.query('select otp_channel from sms_settings where id = 1')).rows[0].otp_channel;
    await pool.query("update sms_settings set otp_channel = 'static' where id = 1");
    forgetSmsSettings();
    setSmsFetch((async () => { smsCalls++; return new Response('{"status":"OK"}', { status: 200 }); }) as typeof fetch);
    await pool.query('delete from users where phone = any($1)', [[NEW, OTHER, ADDED]]);
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await devLogin('9000000001');
    config.authMode = 'sms';
  });
  after(async () => {
    config.authMode = mode;
    delete process.env.FIREBASE_SESSIONS;
    await pool.query('update sms_settings set otp_channel = $1 where id = 1', [savedChannel]);
    await pool.query('delete from users where phone = any($1)', [[NEW, OTHER, ADDED]]);
    await pool.query('delete from otp_codes where phone = any($1)', [[NEW, OTHER, ADDED]]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('with the test channel, sends no SMS and accepts only 123456', async () => {
    const sent = await call('POST', '/auth/otp/send', undefined, { phone: NEW, purpose: 'signup' });
    assert.equal(sent.status, 200); assert.equal(sent.body.testMode, true); assert.equal(smsCalls, 0);
    assert.equal((await call('GET', '/config')).body.otpTestMode, true);
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: NEW, code: '654321' })).status, 401);
    const ok = await call('POST', '/auth/otp/verify', undefined, { phone: NEW, code: '123456' });
    assert.equal(ok.status, 200); assert.ok(ok.body.token);
  });

  it('log-in needs a registered number and sign-up a new one', async () => {
    const login = await call('POST', '/auth/otp/send', undefined, { phone: OTHER, purpose: 'login' });
    assert.equal(login.status, 404); assert.equal(login.body.error.code, 'not_registered');
    const signupTaken = await call('POST', '/auth/otp/send', undefined, { phone: '9000000001', purpose: 'signup' });
    assert.equal(signupTaken.status, 409); assert.equal(signupTaken.body.error.code, 'already_registered');
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: '9000000001', purpose: 'login' })).status, 200);
  });

  it('creates the customer from the sign-up form and tells the admin', async () => {
    const { token } = (await call('POST', '/auth/otp/verify', undefined, { phone: NEW, code: '123456' })).body;
    assert.equal((await call('POST', '/auth/session', token, { purpose: 'login' })).status, 404, 'not registered yet');
    assert.equal((await call('POST', '/auth/session', token, { purpose: 'signup', profile: { name: 'A' } })).status, 422);
    const s = await call('POST', '/auth/session', token, { purpose: 'signup', profile: { name: 'Riya Sharma', email: 'Riya@Example.com', gender: 'female', dateOfBirth: '1994-03-21', city: 'Ajmer' } });
    assert.equal(s.status, 200);
    assert.equal(s.body.needsProfile, false);
    assert.deepEqual({ name: s.body.user.name, email: s.body.user.email, gender: s.body.user.gender, dob: s.body.user.dateOfBirth, city: s.body.user.city, active: s.body.user.isActive },
      { name: 'Riya Sharma', email: 'riya@example.com', gender: 'female', dob: '1994-03-21', city: 'Ajmer', active: true });
    assert.equal((await call('POST', '/auth/session', token, { purpose: 'signup', profile: { name: 'Again' } })).status, 409);
    const note = await pool.query("select 1 from notifications n join users u on u.id = n.user_id where u.phone = '9000000001' and n.type = 'customer_signup' and n.body like '%' || $1 || '%'", [NEW]);
    assert.ok(note.rows[0]);
    cust = token;
  });

  it('deactivates only after the admin approves; a deactivated customer can only ask to come back', async () => {
    const asked = await call('POST', '/account/requests', cust, { kind: 'deactivate', reason: 'Moving to another city', details: 'Shifting to Jaipur' });
    assert.equal(asked.status, 201);
    assert.equal((await call('POST', '/account/requests', cust, { kind: 'deactivate', reason: 'Twice' })).status, 409, 'one pending request at a time');
    assert.equal((await call('POST', '/account/requests', cust, { kind: 'reactivate', reason: 'Already active' })).status, 409);
    assert.equal((await call('GET', '/me', cust)).body.user.isActive, true, 'nothing changes before the admin decides');
    assert.equal((await call('GET', '/me', cust)).body.accountRequest.status, 'pending');

    const list = await call('GET', '/admin/account-requests', admin);
    const req = list.body.requests.find((r: { customer: { phone: string } }) => r.customer.phone === NEW);
    assert.equal(req.kind, 'deactivate'); assert.equal(req.details, 'Shifting to Jaipur');
    assert.equal((await call('POST', `/admin/account-requests/${req.id}/decide`, cust, { approve: true })).status, 403);
    assert.equal((await call('POST', `/admin/account-requests/${req.id}/decide`, admin, { approve: true, note: 'Take care' })).status, 204);
    assert.equal((await call('POST', `/admin/account-requests/${req.id}/decide`, admin, { approve: true })).status, 404, 'already handled');

    const me = await call('GET', '/me', cust);
    assert.equal(me.body.user.isActive, false); assert.equal(me.body.accountRequest.status, 'approved'); assert.equal(me.body.accountRequest.adminNote, 'Take care');
    const blocked = await call('GET', '/orders', cust);
    assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'account_deactivated');
    assert.equal((await call('GET', '/notifications', cust)).status, 200);

    const back = await call('POST', '/account/requests', cust, { kind: 'reactivate', reason: 'Back in town' });
    assert.equal(back.status, 201);
    assert.equal((await call('DELETE', `/account/requests/${back.body.request.id}`, cust)).status, 204, 'can be cancelled');
    const again = await call('POST', '/account/requests', cust, { kind: 'reactivate', reason: 'Back in town' });
    const rejected = await call('POST', `/admin/account-requests/${again.body.request.id}/decide`, admin, { approve: false, note: 'Please visit the shop' });
    assert.equal(rejected.status, 204);
    assert.equal((await call('GET', '/me', cust)).body.user.isActive, false);
    const third = await call('POST', '/account/requests', cust, { kind: 'reactivate', reason: 'Visited the shop' });
    assert.equal((await call('POST', `/admin/account-requests/${third.body.request.id}/decide`, admin, { approve: true })).status, 204);
    assert.equal((await call('GET', '/me', cust)).body.user.isActive, true);
    assert.equal((await call('GET', '/orders', cust)).status, 200);
  });

  it('lets the admin list, filter, add, edit and switch customers', async () => {
    const added = await call('POST', '/admin/customers', admin, { phone: ADDED, name: 'Walk-in Customer', city: 'Ajmer' });
    assert.equal(added.status, 201);
    assert.equal((await call('POST', '/admin/customers', admin, { phone: ADDED, name: 'Dup' })).status, 409);
    const id = added.body.customer.id;
    const edited = await call('PATCH', `/admin/customers/${id}`, admin, { name: 'Walk-in Kumar', gender: 'male', email: 'wk@example.com' });
    assert.equal(edited.body.customer.name, 'Walk-in Kumar'); assert.equal(edited.body.customer.city, 'Ajmer'); assert.equal(edited.body.customer.gender, 'male');

    assert.equal((await call('POST', `/admin/customers/${id}/status`, admin, { active: false, note: 'Duplicate' })).status, 204);
    const deact = await call('GET', '/admin/customers?status=deactivated&search=Walk-in', admin);
    assert.deepEqual(deact.body.customers.map((c: { phone: string }) => c.phone), [ADDED]);
    assert.ok(deact.body.counts.deactivated >= 1);
    assert.equal((await call('GET', '/admin/customers?status=active&search=Walk-in', admin)).body.customers.length, 0);
    const detail = await call('GET', `/admin/customers/${id}`, admin);
    assert.equal(detail.body.customer.isActive, false); assert.equal(detail.body.customer.email, 'wk@example.com');
    assert.equal((await call('POST', `/admin/customers/${id}/status`, admin, { active: true })).status, 204);
    assert.equal((await call('GET', '/admin/customers', cust)).status, 403);
  });

  it('signs the app in to Firebase with a custom token carrying the phone number', async () => {
    process.env.FIREBASE_SESSIONS = 'on';
    try {
      if (!config.firebaseServiceAccount) return; // no service account on this machine
      const ok = await call('POST', '/auth/otp/verify', undefined, { phone: NEW, code: '123456' });
      assert.equal(ok.status, 200);
      const [, payload] = String(ok.body.firebaseToken).split('.');
      const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      assert.equal(claims.claims.phone, NEW);
      assert.match(claims.aud, /identitytoolkit/);
    } finally { delete process.env.FIREBASE_SESSIONS; }
  });
});
