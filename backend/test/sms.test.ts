import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';
import { forgetSmsSettings, setSmsFetch } from '../src/sms.js';

const PHONE = '9555000071';
const OTHER = '9555000072';
const CUSTOMER = '9555000073';
let base = '';
let server: ReturnType<typeof createServer>;
let saved: Record<string, unknown>;
const sent: { url: string; form: URLSearchParams }[] = [];
let gateway: (form: URLSearchParams) => { status: number; json: object } = () => ({ status: 200, json: { status: 'OK', requestid: 'r1' } });

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
const lastCode = () => /Your OTP is (\d{6})/.exec(sent.at(-1)!.form.get('message') ?? '')?.[1] ?? '';
const allowResend = (phone: string) => pool.query("update otp_codes set last_sent_at = now() - interval '1 minute' where phone = $1", [phone]);

describe('SMS gateway (PearlSMS) OTP login and its admin settings', () => {
  let admin = '', cust = '';
  const mode = config.authMode;
  before(async () => {
    saved = (await pool.query('select api_url, sender_id, sms_type, api_key, otp_template, otp_channel from sms_settings where id = 1')).rows[0];
    await pool.query("update sms_settings set api_url = 'https://sms.example.test/send', sender_id = 'TESTID', sms_type = 'TRANS', api_key = 'secret-key-9876', otp_template = 'Your OTP is {otp}. Valid for 5 minutes.', otp_channel = 'sms' where id = 1");
    forgetSmsSettings();
    setSmsFetch((async (url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      sent.push({ url: String(url), form });
      const r = gateway(form);
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); cust = await login(CUSTOMER);
    config.authMode = 'sms';
    await pool.query('delete from otp_codes where phone = any($1)', [[PHONE, OTHER]]);
  });
  after(async () => {
    config.authMode = mode;
    await pool.query('update sms_settings set api_url = $1, sender_id = $2, sms_type = $3, api_key = $4, otp_template = $5, otp_channel = $6 where id = 1', [saved.api_url, saved.sender_id, saved.sms_type, saved.api_key, saved.otp_template, saved.otp_channel]);
    await pool.query('delete from otp_codes where phone = any($1)', [[PHONE, OTHER]]);
    await pool.query('delete from users where phone = any($1)', [[PHONE, CUSTOMER]]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('sends a fresh 6-digit code through the gateway with the configured sender, type and key', async () => {
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: `+91 ${PHONE}` })).status, 200);
    const f = sent.at(-1)!.form;
    assert.equal(sent.at(-1)!.url, 'https://sms.example.test/send');
    assert.equal(f.get('sender'), 'TESTID'); assert.equal(f.get('smstype'), 'TRANS'); assert.equal(f.get('apikey'), 'secret-key-9876'); assert.equal(f.get('numbers'), PHONE);
    assert.match(lastCode(), /^\d{6}$/);
    const row = (await pool.query('select code_hash from otp_codes where phone = $1', [PHONE])).rows[0];
    assert.notEqual(row.code_hash, lastCode(), 'only a hash is stored');
  });

  it('accepts the code once, rejects wrong and reused codes, and the token works', async () => {
    const code = lastCode();
    const wrong = await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error.message, 'Incorrect OTP');
    const ok = await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code });
    assert.equal(ok.status, 200);
    assert.equal((await call('POST', '/auth/session', ok.body.token)).body.user.phone, PHONE);
    assert.equal((await call('GET', '/me', ok.body.token)).status, 200);
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code })).status, 401, 'a code works only once');
  });

  it('waits 30 s between sends, burns the code after 5 wrong tries, and reports gateway errors', async () => {
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: OTHER })).status, 200);
    const code = lastCode();
    const again = await call('POST', '/auth/otp/send', undefined, { phone: OTHER });
    assert.equal(again.status, 429); assert.equal(again.body.error.code, 'otp_rate_limited');
    for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/verify', undefined, { phone: OTHER, code: code === '999999' ? '888888' : '999999' });
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: OTHER, code })).status, 401, 'the right code no longer works');

    await allowResend(OTHER);
    gateway = () => ({ status: 400, json: { status: 'ERROR', errormsg: 'Invalid Api Key', statuscode: 400 } });
    const down = await call('POST', '/auth/otp/send', undefined, { phone: OTHER });
    assert.equal(down.status, 502); assert.equal(down.body.error.code, 'otp_unavailable');
    gateway = () => ({ status: 200, json: { status: 'OK' } });
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: OTHER })).status, 200, 'a failed send can be retried at once');
  });

  it('lets only the admin read and change the settings; the key is never shown in full', async () => {
    assert.equal((await call('GET', '/admin/sms', cust)).status, 403);
    const g = await call('GET', '/admin/sms', admin);
    assert.equal(g.status, 200);
    assert.equal(g.body.senderId, 'TESTID'); assert.equal(g.body.apiKeySet, true); assert.equal(g.body.apiKeyHint, '••••9876');
    assert.equal(JSON.stringify(g.body).includes('secret-key'), false);

    const bad = await call('PUT', '/admin/sms', admin, { senderId: 'AB', smsType: 'TRANS', otpTemplate: 'no placeholder here' });
    assert.equal(bad.status, 422);
    const kept = await call('PUT', '/admin/sms', admin, { senderId: 'newid', smsType: 'promo', otpTemplate: 'Code {otp} for KMH', apiKey: '' });
    assert.equal(kept.status, 200); assert.equal(kept.body.senderId, 'NEWID'); assert.equal(kept.body.smsType, 'PROMO'); assert.equal(kept.body.apiKeyHint, '••••9876', 'empty key keeps the saved one');
    const changed = await call('PUT', '/admin/sms', admin, { senderId: 'TESTID', smsType: 'TRANS', otpTemplate: 'Your OTP is {otp}. Valid for 5 minutes.', apiKey: 'another-key-1234' });
    assert.equal(changed.body.apiKeyHint, '••••1234');

    const test = await call('POST', '/admin/sms/test', admin, { phone: OTHER });
    assert.equal(test.status, 200); assert.equal(sent.at(-1)!.form.get('apikey'), 'another-key-1234'); assert.equal(sent.at(-1)!.form.get('message'), 'Your OTP is 123456. Valid for 5 minutes.');
    gateway = () => ({ status: 400, json: { status: 'ERROR', errormsg: 'Invalid Sender' } });
    const failed = await call('POST', '/admin/sms/test', admin, { phone: OTHER });
    assert.equal(failed.status, 502); assert.match(failed.body.error.message, /Invalid Sender/);
  });
});
