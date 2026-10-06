import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createServer } from '../src/server.js';
import { closeRealtime } from '../src/realtime.js';
import { pool } from '../src/db.js';

const PHONE = '9555000011';
let base = '';
let server: ReturnType<typeof createServer>;

async function raw(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}
async function login(phone: string) {
  const r = await (await raw('POST', '/auth/dev-login', { body: { phone, otp: '123456' } })).json() as { token: string };
  await raw('POST', '/auth/session', { token: r.token });
  return r.token;
}

describe('transport, caching, abuse limits and observability', () => {
  let admin = '', cust = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); cust = await login(PHONE);
  });
  after(async () => {
    await raw('PUT', '/admin/terms', { token: admin, body: { text: '' } });
    await pool.query('delete from users where phone = $1', [PHONE]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('gives every request an id and reports database time', async () => {
    const res = await raw('GET', '/me', { token: cust });
    assert.match(res.headers.get('x-request-id') ?? '', /^[\w-]{8,64}$/);
    assert.match(res.headers.get('server-timing') ?? '', /db;dur=\d+;desc="\d+ queries", app;dur=\d+/);
    const echoed = await raw('GET', '/config', { headers: { 'x-request-id': 'trace-12345678' } });
    assert.equal(echoed.headers.get('x-request-id'), 'trace-12345678');
    const junk = await raw('GET', '/config', { headers: { 'x-request-id': 'bad id with spaces!' } });
    assert.notEqual(junk.headers.get('x-request-id'), 'bad id with spaces!');
    const err = await (await raw('GET', '/me')).json() as { error: { code: string; requestId: string; message: string } };
    assert.equal(err.error.code, 'unauthenticated'); assert.ok(err.error.requestId);
  });

  it('caches only public store data and never personal responses', async () => {
    const cfg = await raw('GET', '/config');
    assert.match(cfg.headers.get('cache-control') ?? '', /public, max-age=15, stale-while-revalidate=60/);
    const etag = cfg.headers.get('etag');
    assert.ok(etag);
    // (fetch would otherwise add "Cache-Control: no-cache" to a conditional request, which always forces a full reply)
    const again = await fetch(base + '/config', { headers: { 'if-none-match': etag! }, cache: 'no-cache' });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0, 'a 304 carries no body');
    assert.equal((await raw('GET', '/me', { token: cust })).headers.get('cache-control'), 'no-store');
    assert.equal((await raw('GET', '/orders', { token: cust })).headers.get('cache-control'), 'no-store');
  });

  it('compresses larger responses', async () => {
    await raw('PUT', '/admin/terms', { token: admin, body: { text: 'Terms and conditions. '.repeat(300) } });
    const res = await raw('GET', '/terms', { headers: { 'accept-encoding': 'gzip' } });
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    assert.match((await res.json() as { text: string }).text, /^Terms and conditions\./);
  });

  it('answers browsers only for allowed origins and never exposes the server stack', async () => {
    const evil = await raw('OPTIONS', '/config', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const local = await raw('GET', '/config', { headers: { origin: 'http://localhost:8081' } });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:8081');
    assert.equal((await raw('GET', '/config')).status, 200, 'native apps send no Origin and are not affected');
    assert.equal((await raw('GET', '/config')).headers.get('x-powered-by'), null);
    const bad = await raw('GET', '/me', { token: 'not-a-token' });
    assert.equal(bad.status, 401);
    const text = JSON.stringify(await bad.json());
    assert.doesNotMatch(text, /jwt|jsonwebtoken|stack|node_modules|secret/i);
  });

  it('stops a client that floods an expensive endpoint', async () => {
    const flooder = await login('9555000012');
    const codes: number[] = [];
    for (let i = 0; i < 34; i++) codes.push((await raw('POST', '/uploads/sign', { token: flooder, body: { purpose: 'prescription' } })).status);
    assert.ok(codes.includes(429), `expected a 429 in ${codes.join(',')}`);
    // another person is not affected
    assert.notEqual((await raw('POST', '/uploads/sign', { token: cust, body: { purpose: 'prescription' } })).status, 429);
    await pool.query("delete from users where phone = '9555000012'");
  });

  it('applies profile changes immediately despite the short user cache', async () => {
    await raw('PATCH', '/me', { token: cust, body: { name: 'Cache Check One' } });
    assert.equal(((await (await raw('GET', '/me', { token: cust })).json()) as { user: { name: string } }).user.name, 'Cache Check One');
    await raw('PATCH', '/me', { token: cust, body: { name: 'Cache Check Two' } });
    assert.equal(((await (await raw('GET', '/me', { token: cust })).json()) as { user: { name: string } }).user.name, 'Cache Check Two');
  });

  it('shows the slowest endpoints to the admin only', async () => {
    assert.equal((await raw('GET', '/admin/metrics', { token: cust })).status, 403);
    const m = await (await raw('GET', '/admin/metrics', { token: admin })).json() as { routes: { route: string; p95: number; count: number }[] };
    assert.ok(m.routes.length > 3);
    assert.ok(m.routes.every((r) => !/[?=]/.test(r.route)), 'no query strings or tokens in route names');
    assert.ok(m.routes.some((r) => r.route === 'GET /config'));
  });
});
