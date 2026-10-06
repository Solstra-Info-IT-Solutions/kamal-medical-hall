import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';

const PHONE = '9555000021';
let base = '';
let server: ReturnType<typeof createServer>;
const sockets: Socket[] = [];

interface Reply { s: number; b: any; h: Record<string, string> }
const open = async (token?: string) => {
  const s = connect(base, { transports: ['websocket'], reconnection: false, auth: { token: token ?? '' } });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  return s;
};
/** One request over the socket, exactly as the app sends it. */
const rpc = (s: Socket, m: string, p: string, b?: unknown, token?: string): Promise<Reply> =>
  s.timeout(8000).emitWithAck('rpc', { m, p, b, a: token ? `Bearer ${token}` : undefined, id: 'test-request-0001' });

describe('everything over the socket', () => {
  let anon: Socket, admin = '', cust = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    anon = await open();
    const login = async (phone: string) => {
      const r = await rpc(anon, 'POST', '/auth/dev-login', { phone, otp: '123456' });
      assert.equal(r.s, 200);
      await rpc(anon, 'POST', '/auth/session', undefined, r.b.token);
      return r.b.token as string;
    };
    admin = await login('9000000001'); cust = await login(PHONE);
  });
  after(async () => {
    config.socketOnly = false;
    sockets.forEach((s) => s.close());
    await pool.query('delete from chat_threads where customer_id in (select id from users where phone = $1)', [PHONE]);
    await pool.query('delete from users where phone = $1', [PHONE]);
    closeRealtime(); server.close();
    await pool.end();
  });

  it('answers the same endpoints as HTTP, with the same bodies and status codes', async () => {
    const cfg = await rpc(anon, 'GET', '/config');
    assert.equal(cfg.s, 200); assert.equal(typeof cfg.b.store.isOpen, 'boolean'); assert.ok(Array.isArray(cfg.b.deliveryDays));
    assert.equal((await fetch(`${base}/config`).then((r) => r.json()) as any).store.isOpen, cfg.b.store.isOpen);
    assert.equal((await rpc(anon, 'GET', '/pincodes')).s, 200);
    assert.equal((await rpc(anon, 'GET', '/nope')).s, 404);
    assert.equal(cfg.h['x-request-id'], 'test-request-0001', 'request id round-trips');
  });

  it('checks the token on every call, not just when connecting', async () => {
    const none = await rpc(anon, 'GET', '/me');
    assert.equal(none.s, 401); assert.equal(none.b.error.code, 'unauthenticated');
    assert.equal((await rpc(anon, 'GET', '/me', undefined, 'garbage')).s, 401);
    const me = await rpc(anon, 'GET', '/me', undefined, cust);
    assert.equal(me.s, 200); assert.equal(me.b.user.phone, PHONE);
    // the same connection serves different people, each with their own rights
    assert.equal((await rpc(anon, 'GET', '/admin/dashboard', undefined, cust)).s, 403);
    assert.equal((await rpc(anon, 'GET', '/admin/dashboard', undefined, admin)).s, 200);
  });

  it('carries request bodies, validation errors and writes', async () => {
    const ok = await rpc(anon, 'PATCH', '/me', { name: 'Socket Tester' }, cust);
    assert.equal(ok.s, 200); assert.equal(ok.b.user.name, 'Socket Tester');
    assert.equal((await rpc(anon, 'GET', '/me', undefined, cust)).b.user.name, 'Socket Tester', 'no stale cache after a write');
    const bad = await rpc(anon, 'PATCH', '/me', { name: 'x' }, cust);
    assert.equal(bad.s, 422); assert.equal(bad.b.error.code, 'validation_failed');
    const del = await rpc(anon, 'DELETE', '/notifications', undefined, cust);
    assert.equal(del.s, 204); assert.equal(del.b, null);
  });

  it('refuses malformed, hostile and non-JSON requests', async () => {
    const send = (msg: unknown) => anon.timeout(8000).emitWithAck('rpc', msg) as Promise<Reply>;
    for (const msg of [null, 'x', {}, { m: 'GET' }, { m: 'TRACE', p: '/config' }, { m: 'GET', p: 'config' }, { m: 'GET', p: '//evil.example/x' }, { m: 'GET', p: '/config\r\nX: y' }, { m: 'GET', p: '/config x' }, { m: 'GET', p: '/config', a: 'Basic abc' }, { m: 'GET', p: '/config', a: 'Bearer a b' }]) {
      assert.equal((await send(msg)).s, 400, JSON.stringify(msg));
    }
    for (const p of ['/webhooks/razorpay', '/export/orders.csv?t=x', '/orders/00000000-0000-0000-0000-000000000000/invoice.pdf?t=x', '/socket.io/']) {
      assert.equal((await rpc(anon, 'GET', p)).s, 404, p);
    }
    // a message bigger than the transport allows gets that one connection dropped, and nothing else
    const big = await open();
    const dropped = new Promise((resolve) => big.once('disconnect', resolve));
    big.emit('rpc', { m: 'POST', p: '/me', b: { blob: 'x'.repeat(120_000) }, a: `Bearer ${cust}` }, () => {});
    await dropped;
    anon.emit('rpc', { m: 'GET', p: '/config' }); // no acknowledgement callback: must be ignored, not crash
    assert.equal((await rpc(anon, 'GET', '/config')).s, 200);
  });

  it('slows down a connection that floods it', async () => {
    const flooder = await open();
    const replies = await Promise.all(Array.from({ length: 90 }, () => rpc(flooder, 'GET', '/pincodes')));
    const limited = replies.filter((r) => r.s === 429);
    assert.ok(limited.length > 0, 'some requests were limited');
    assert.ok(limited.every((r) => r.h['retry-after']));
    assert.ok(replies.filter((r) => r.s === 200).length >= 50, 'but a normal burst still goes through');
    flooder.close();
  });

  it('delivers a chat message sent over the socket to the admin over the socket, with no HTTP request in between', async () => {
    const adminSocket = await open(admin);
    const got = new Promise<any>((resolve) => adminSocket.once('chat:message', resolve));
    const sent = await rpc(anon, 'POST', '/chat/messages', { body: 'Hello from the socket' }, cust);
    assert.equal(sent.s, 201);
    const pushed = await got;
    assert.equal(pushed.body, 'Hello from the socket'); assert.equal(pushed.role, 'customer');
    const threads = await rpc(adminSocket, 'GET', '/admin/chat/threads', undefined, admin);
    assert.ok(threads.b.threads.some((t: any) => t.lastBody?.includes('Hello from the socket') || t.subject?.includes('Hello from the socket')));
    adminSocket.close();
  });

  it('socket-only mode: ordinary HTTP is refused, the socket and the allowed exceptions keep working', async () => {
    config.socketOnly = true;
    try {
      const refused = await fetch(`${base}/config`);
      assert.equal(refused.status, 426); assert.equal(((await refused.json()) as any).error.code, 'socket_only');
      assert.equal((await fetch(`${base}/me`, { headers: { authorization: `Bearer ${cust}` } })).status, 426);
      assert.equal((await fetch(`${base}/health`)).status, 200, 'health checks stay on HTTP');
      assert.notEqual((await fetch(`${base}/webhooks/razorpay`, { method: 'POST' })).status, 426, 'provider webhooks stay on HTTP');
      assert.equal((await fetch(`${base}/export/orders.csv?t=bad`)).status, 401, 'download links stay on HTTP (and still check their token)');
      assert.equal((await fetch(`${base}/config`, { headers: { 'x-kmh-rpc': 'guess' } })).status, 426, 'the internal header cannot be forged');
      assert.equal((await rpc(anon, 'GET', '/config')).s, 200, 'the socket still works');
      assert.equal((await rpc(anon, 'GET', '/me', undefined, cust)).s, 200);
    } finally { config.socketOnly = false; }
    assert.equal((await fetch(`${base}/config`)).status, 200, 'and HTTP is back when the mode is off');
  });
});
