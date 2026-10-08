import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { setTwilioFetch } from '../src/otp.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';

const PHONE = '9555000051';
let base = '';
let server: ReturnType<typeof createServer>;
const sent: { url: string; body: string; auth: string }[] = [];
let twilioReply: (url: string, body: URLSearchParams) => { status: number; json: object } = () => ({ status: 200, json: { status: 'pending' } });

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('SMS OTP login through Twilio Verify', () => {
  const saved = { mode: config.authMode, tw: { ...config.twilio } };
  before(async () => {
    config.authMode = 'twilio';
    Object.assign(config.twilio, { accountSid: 'ACtest', authToken: 'tok', verifyServiceSid: 'VAtest' });
    setTwilioFetch((async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: String(init.body), auth: (init.headers as Record<string, string>).authorization });
      const r = twilioReply(String(url), new URLSearchParams(String(init.body)));
      return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(async () => {
    config.authMode = saved.mode; Object.assign(config.twilio, saved.tw);
    await pool.query('delete from users where phone = $1', [PHONE]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('sends the OTP to the +91 number through Verify and never exposes the code', async () => {
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: '+91 95550 00051' })).status, 204);
    assert.match(sent.at(-1)!.url, /verify\.twilio\.com\/v2\/Services\/VAtest\/Verifications$/);
    assert.equal(new URLSearchParams(sent.at(-1)!.body).get('To'), `+91${PHONE}`);
    assert.equal(new URLSearchParams(sent.at(-1)!.body).get('Channel'), 'sms');
    assert.equal(sent.at(-1)!.auth, `Basic ${Buffer.from('ACtest:tok').toString('base64')}`);
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: '12345' })).status, 422);
  });

  it('gives a session token only when Twilio approves the code; that token works for the API', async () => {
    twilioReply = () => ({ status: 200, json: { status: 'pending' } });
    const wrong = await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code: '111111' });
    assert.equal(wrong.status, 401); assert.equal(wrong.body.error.code, 'invalid_otp'); assert.equal(wrong.body.token, undefined);
    twilioReply = () => ({ status: 404, json: { code: 20404 } });
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code: '111111' })).status, 401, 'expired / no pending code');
    twilioReply = (url, body) => (url.endsWith('/VerificationCheck') && body.get('Code') === '654321' ? { status: 200, json: { status: 'approved' } } : { status: 200, json: { status: 'pending' } });
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code: 'abc' })).status, 422);
    const ok = await call('POST', '/auth/otp/verify', undefined, { phone: PHONE, code: '654321' });
    assert.equal(ok.status, 200);
    const session = await call('POST', '/auth/session', ok.body.token);
    assert.equal(session.status, 200);
    assert.equal(session.body.user.phone, PHONE);
    assert.equal((await call('GET', '/me', ok.body.token)).status, 200);
    assert.equal((await call('GET', '/me', 'garbage')).status, 401);
  });

  it('turns provider trouble into friendly errors and limits repeated attempts', async () => {
    twilioReply = () => ({ status: 500, json: {} });
    const down = await call('POST', '/auth/otp/send', undefined, { phone: '9555000052' });
    assert.equal(down.status, 502); assert.equal(down.body.error.code, 'otp_unavailable');
    twilioReply = () => ({ status: 429, json: { code: 60203 } });
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: '9555000053' })).status, 429);
    twilioReply = () => ({ status: 200, json: { status: 'pending' } });
    for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/send', undefined, { phone: '9555000054' });
    assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: '9555000054' })).body.error.code, 'otp_rate_limited');
    for (let i = 0; i < 5; i++) await call('POST', '/auth/otp/verify', undefined, { phone: '9555000055', code: '000000' });
    assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: '9555000055', code: '000000' })).body.error.code, 'otp_rate_limited');
  });

  it('is switched off in other modes', async () => {
    config.authMode = 'dev';
    try { assert.equal((await call('POST', '/auth/otp/send', undefined, { phone: PHONE })).status, 404); } finally { config.authMode = 'twilio'; }
  });
});
