import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { pool } from '../src/db.js';
import { closeRealtime } from '../src/realtime.js';
import { bootstrap, createServer } from '../src/server.js';

const A = '9555000081';
const B = '9555000082';
let base = '';
let server: ReturnType<typeof createServer>;
const created: string[] = [];

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
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

describe('announcements', () => {
  let admin = '', a = '', b = '', adminId = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); a = await login(A); b = await login(B);
    adminId = (await call('GET', '/me', admin)).body.user.id;
  });
  after(async () => {
    for (const id of created) await pool.query('delete from announcements where id = $1', [id]);
    await pool.query('delete from users where phone = any($1)', [[A, B]]);
    closeRealtime(); server.close();
    await pool.end();
  });

  const send = async (items: object[]) => { const r = await call('POST', '/admin/announcements', admin, { items }); created.push(...(r.body?.ids ?? [])); return r; };
  const mine = async (t: string) => ((await call('GET', '/notifications', t)).body.notifications as any[]).filter((n) => n.type === 'announcement');

  it('lets only the admin manage them, and customers read only what is live', async () => {
    assert.equal((await call('POST', '/admin/announcements', a, { items: [] })).status, 403);
    assert.equal((await call('GET', '/admin/announcements', a)).status, 403);
    assert.equal((await call('GET', '/announcements')).status, 401);
    assert.equal((await call('GET', '/announcements', a)).status, 200);
  });

  it('sends several at once: text becomes a notification, pictures become a slider entry', async () => {
    const r = await send([
      { title: 'Sunday timings', body: 'We are open 10 AM to 2 PM this Sunday.', expiresAt: inDays(3) },
      { title: 'Monsoon offer', body: '', images: [{ publicId: `announcements/${adminId}/offer-1`, mimeType: 'image/jpeg' }], expiresAt: inDays(5) },
    ]);
    assert.equal(r.status, 201); assert.equal(r.body.ids.length, 2);
    const [textId, imageId] = r.body.ids as string[];

    const notes = await mine(a);
    assert.equal(notes.length, 1, 'only the text one is a notification');
    assert.equal(notes[0].announcementId, textId);
    const live = (await call('GET', '/announcements', a)).body.announcements as any[];
    const text = live.find((x) => x.id === textId), image = live.find((x) => x.id === imageId);
    assert.equal(text.hasImages, false); assert.equal(image.hasImages, true); assert.equal(image.images.length, 1);
    assert.equal((await call('GET', `/announcements/${imageId}`, b)).body.announcement.title, 'Monsoon offer', 'detail page');
  });

  it('sending again replaces the customer\'s copy instead of adding another', async () => {
    const [id] = (await send([{ title: 'Flu shots', body: 'Available today.', expiresAt: inDays(2) }])).body.ids as string[];
    const first = (await mine(a)).find((n) => n.announcementId === id)!;
    await call('POST', '/notifications/read-all', a); // customer already read it
    assert.equal((await call('POST', `/admin/announcements/${id}/send`, admin)).status, 200);
    const again = (await mine(a)).filter((n) => n.announcementId === id);
    assert.equal(again.length, 1, 'still one copy');
    assert.equal(again[0].id, first.id, 'the same row, overridden');
    assert.equal(again[0].read, false, 'and it is unread again');
    assert.equal((await call('GET', '/admin/announcements', admin)).body.announcements.find((x: any) => x.id === id).sendCount, 2);
  });

  it('expires: hidden from customers, cannot be sent until the date is extended', async () => {
    const [id] = (await send([{ title: 'Diwali sale', body: 'Up to 20% off.', expiresAt: inDays(1) }])).body.ids as string[];
    await pool.query("update announcements set expires_at = now() - interval '1 minute' where id = $1", [id]);
    assert.ok(!((await call('GET', '/announcements', a)).body.announcements as any[]).some((x) => x.id === id), 'inactive');
    const row = (await call('GET', '/admin/announcements', admin)).body.announcements.find((x: any) => x.id === id);
    assert.equal(row.expired, true); assert.equal(row.active, false);
    const refused = await call('POST', `/admin/announcements/${id}/send`, admin);
    assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'expired');
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 422, 'new date must be in the future');
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { expiresAt: inDays(4) })).status, 200);
    assert.equal((await call('POST', `/admin/announcements/${id}/send`, admin)).status, 200);
    assert.ok(((await call('GET', '/announcements', a)).body.announcements as any[]).some((x) => x.id === id), 'live again');
  });

  it('validates input and only accepts pictures from the admin\'s own folder', async () => {
    assert.equal((await call('POST', '/admin/announcements', admin, { items: [{ title: 'x', body: 'hello there', expiresAt: inDays(1) }] })).status, 422, 'title too short');
    assert.equal((await call('POST', '/admin/announcements', admin, { items: [{ title: 'Past one', body: 'text here', expiresAt: inDays(-1) }] })).status, 422, 'expiry in the past');
    assert.equal((await call('POST', '/admin/announcements', admin, { items: [{ title: 'Missing title', body: 'text here' }, { title: '', body: 'x' }] })).status, 422, 'the title is required');
    assert.equal((await call('POST', '/admin/announcements', admin, { items: [{ title: 'Bad file', body: '', images: [{ publicId: 'announcements/someone-else/x', mimeType: 'image/jpeg' }], expiresAt: inDays(1) }] })).status, 400);
    assert.equal((await call('POST', '/admin/announcements', admin, { items: Array.from({ length: 11 }, () => ({ title: 'Many', body: 'text here', expiresAt: inDays(1) })) })).status, 422, 'at most 10 at once');
  });

  it('only the title is required; without an expiry date it stays live until the admin switches it off', async () => {
    const r = await send([{ title: 'Just a title' }]);
    assert.equal(r.status, 201);
    const [id] = r.body.ids as string[];
    const row = (await call('GET', '/admin/announcements', admin)).body.announcements.find((x: any) => x.id === id);
    assert.equal(row.expiresAt, null); assert.equal(row.status, 'active'); assert.equal(row.expired, false);
    assert.ok(((await call('GET', '/announcements', a)).body.announcements as any[]).some((x) => x.id === id));
    assert.equal((await mine(a)).filter((n) => n.announcementId === id).length, 1);

    // switched off: gone for customers, no reminder possible
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { isActive: false })).body.announcement.status, 'inactive');
    assert.ok(!((await call('GET', '/announcements', a)).body.announcements as any[]).some((x) => x.id === id));
    assert.equal((await call('GET', `/announcements/${id}`, a)).status, 404);
    const refused = await call('POST', `/admin/announcements/${id}/send`, admin);
    assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'inactive');
    // switched on again: back, and a reminder works
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { isActive: true })).status, 200);
    assert.equal((await call('POST', `/admin/announcements/${id}/send`, admin)).status, 200);
    // an expiry can be added later and removed again
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { expiresAt: inDays(2) })).body.announcement.expiresAt !== null, true);
    assert.equal((await call('PATCH', `/admin/announcements/${id}`, admin, { expiresAt: null })).body.announcement.expiresAt, null);
  });

  it('deleting removes it everywhere', async () => {
    const [id] = (await send([{ title: 'Temporary notice', body: 'Gone soon.', expiresAt: inDays(2) }])).body.ids as string[];
    assert.ok((await mine(a)).some((n) => n.announcementId === id));
    assert.equal((await call('DELETE', `/admin/announcements/${id}`, admin)).status, 204);
    assert.ok(!(await mine(a)).some((n) => n.announcementId === id), 'notification removed with it');
    assert.equal((await call('GET', `/announcements/${id}`, a)).status, 404);
    assert.equal((await call('DELETE', `/admin/announcements/${id}`, admin)).status, 404);
  });
});
