import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../src/core/errors/ApiError';
import { createHttpClient } from '../src/core/network/httpClient';
import { createSocketFetch, type SocketLike } from '../src/core/network/socketTransport';

const BASE = 'https://api.example.com';

/** A fake socket: records what was sent, answers from a function, and lets a test connect/disconnect it. */
function fakeSocket(answer: (msg: any, n: number) => unknown | undefined, connected = true) {
  const listeners = { connect: new Set<() => void>(), disconnect: new Set<() => void>() };
  const sent: any[] = [];
  const socket: SocketLike & { up(): void; down(): void; sent: any[]; listenerCount(): number } = {
    connected, sent,
    emit(_e, msg, ack) { sent.push(msg); const r = answer(msg, sent.length); if (r !== undefined) queueMicrotask(() => ack(r)); },
    on(e, fn) { listeners[e].add(fn); }, off(e, fn) { listeners[e].delete(fn); },
    up() { socket.connected = true; [...listeners.connect].forEach((f) => f()); },
    down() { socket.connected = false; [...listeners.disconnect].forEach((f) => f()); },
    listenerCount: () => listeners.connect.size + listeners.disconnect.size,
  };
  return socket;
}
const ok = (b: unknown, s = 200, h: Record<string, string> = {}) => ({ s, b, h });

describe('socket transport', () => {
  it('sends the request as an rpc message and turns the acknowledgement into a Response', async () => {
    const sock = fakeSocket(() => ok({ hello: 'world' }, 200, { 'x-request-id': 'abc' }));
    const f = createSocketFetch({ baseUrl: BASE, getSocket: () => sock });
    const res = await f(`${BASE}/me?x=1`, { method: 'PATCH', headers: { Authorization: 'Bearer t0k', 'X-Request-Id': 'req-0001-abcd', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Asha' }) });
    assert.deepEqual(sock.sent[0], { m: 'PATCH', p: '/me?x=1', b: { name: 'Asha' }, a: 'Bearer t0k', id: 'req-0001-abcd' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hello: 'world' });
    assert.equal(res.headers.get('x-request-id'), 'abc');
    assert.equal(sock.listenerCount(), 0, 'no listeners are left behind');
  });

  it('handles bodiless replies (204) and error statuses', async () => {
    const sock = fakeSocket((m) => (m.m === 'DELETE' ? ok(null, 204) : ok({ error: { code: 'nope', message: 'Not allowed' } }, 403)));
    const f = createSocketFetch({ baseUrl: BASE, getSocket: () => sock });
    assert.equal((await f(`${BASE}/x`, { method: 'DELETE' })).status, 204);
    const denied = await f(`${BASE}/y`);
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as any).error.code, 'nope');
  });

  it('waits for a connection that is not up yet, then sends once', async () => {
    const sock = fakeSocket(() => ok({ ok: true }), false);
    const f = createSocketFetch({ baseUrl: BASE, getSocket: () => sock });
    const pending = f(`${BASE}/config`);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sock.sent.length, 0);
    sock.up();
    assert.equal((await pending).status, 200);
    assert.equal(sock.sent.length, 1);
    assert.equal(sock.listenerCount(), 0);
  });

  it('fails when the connection never comes up, or drops mid-request', async () => {
    const never = createSocketFetch({ baseUrl: BASE, connectWaitMs: 20, getSocket: () => fakeSocket(() => ok({}), false) });
    await assert.rejects(never(`${BASE}/config`));
    const sock = fakeSocket(() => undefined); // never answers
    const f = createSocketFetch({ baseUrl: BASE, getSocket: () => sock });
    const pending = f(`${BASE}/config`);
    setTimeout(() => sock.down(), 10);
    await assert.rejects(pending);
    assert.equal(sock.listenerCount(), 0);
  });

  it('honours cancellation and rejects replies it cannot understand', async () => {
    const sock = fakeSocket(() => undefined);
    const f = createSocketFetch({ baseUrl: BASE, getSocket: () => sock });
    const c = new AbortController();
    const pending = f(`${BASE}/config`, { signal: c.signal });
    setTimeout(() => c.abort(), 5);
    await assert.rejects(pending, (e: Error) => e.name === 'AbortError');
    await assert.rejects(createSocketFetch({ baseUrl: BASE, getSocket: () => fakeSocket(() => 'garbage') })(`${BASE}/x`));
    await assert.rejects(createSocketFetch({ baseUrl: BASE, getSocket: () => sock })('https://evil.example/x'));
  });

  it('plugs into the HTTP client: same errors, retries and token refresh as over HTTP', async () => {
    let n = 0;
    const sock = fakeSocket((m) => {
      n += 1;
      if (m.p === '/me' && m.a === 'Bearer old') return ok({ error: { code: 'unauthenticated', message: 'Sign in again' } }, 401);
      if (m.p === '/me') return ok({ user: { id: 1 } });
      if (m.p === '/flaky') return n < 3 ? ok({}, 503) : ok({ done: true });
      if (m.p === '/bad') return ok({ error: { code: 'validation_failed', message: 'Check your details' } }, 422);
      return ok({}, 404);
    });
    let refreshes = 0;
    const client = createHttpClient({
      baseUrl: BASE, fetchImpl: createSocketFetch({ baseUrl: BASE, connectWaitMs: 30, getSocket: () => sock }),
      getToken: async () => 'old', refreshToken: async () => { refreshes += 1; return 'new'; }, onUnauthorized: () => assert.fail('should not sign out'),
      sleep: async () => undefined, random: () => 0.5, makeId: () => 'req-test-0001',
    });
    assert.deepEqual(await client.request('GET', '/me'), { user: { id: 1 } });
    assert.equal(refreshes, 1);
    assert.equal(sock.sent.find((m) => m.p === '/me' && m.a === 'Bearer new')?.id, 'req-test-0001');
    n = 0;
    assert.deepEqual(await client.request('GET', '/flaky'), { done: true });
    await assert.rejects(client.request('POST', '/bad', { x: 1 }), (e: unknown) => e instanceof ApiError && e.status === 422 && e.message === 'Check your details');
    sock.down();
    await assert.rejects(client.request('POST', '/bad'), (e: unknown) => e instanceof ApiError && e.code === 'network' && e.isNetwork);
  });
});
