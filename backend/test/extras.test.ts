import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { bootstrap, createServer } from '../src/server.js';
import { closeRealtime } from '../src/realtime.js';
import { pool } from '../src/db.js';

const A = '9555000001';
const B = '9555000002';
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
  await call('POST', '/auth/session', r.body.token);
  return r.body.token as string;
}

describe('live chat queue, notifications, reviews, exports and profile picture', () => {
  let admin = '', a = '', b = '', aId = '';
  before(async () => {
    await bootstrap();
    server = createServer().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    admin = await login('9000000001'); a = await login(A); b = await login(B);
    await call('PATCH', '/me', a, { name: 'Chat Alpha' }); await call('PATCH', '/me', b, { name: 'Chat Beta' });
    aId = (await call('GET', '/me', a)).body.user.id;
    await pool.query("update chat_threads set status = 'closed', closed_at = now() where status = 'open'");
  });
  after(async () => {
    await pool.query('delete from orders where customer_id in (select id from users where phone = any($1))', [[A, B]]);
    await pool.query('delete from users where phone = any($1)', [[A, B]]);
    await pool.query("delete from notifications where type = 'announcement' and title = 'Test notice'");
    closeRealtime(); server.close();
    await pool.end();
  });

  it('queues customers behind a busy shopkeeper and shows the waiting time', async () => {
    const first = await call('POST', '/chat/messages', a, { body: 'My medicine is missing' });
    assert.equal(first.status, 201);
    assert.ok(first.body.messages.some((m: any) => m.role === 'bot' && /reply shortly/.test(m.body)), 'bot greets the first customer');
    let t = (await call('GET', '/chat/thread', a)).body;
    assert.equal(t.queue.state, 'waiting'); assert.equal(t.queue.position, 1);

    const list = (await call('GET', '/admin/chat/threads', admin)).body;
    const threadA = list.threads.find((x: any) => x.customerName === 'Chat Alpha');
    assert.ok(threadA && threadA.unread === 1);
    assert.equal((await call('GET', '/chat/threads', b)).status, 404);

    // The shopkeeper starts helping A, so B has to wait.
    assert.equal((await call('POST', `/admin/chat/threads/${threadA.id}/messages`, admin, { body: 'Sorry about that, checking now' })).status, 201);
    t = (await call('GET', '/chat/thread', a)).body;
    assert.equal(t.queue.state, 'active');

    const second = await call('POST', '/chat/messages', b, { body: 'Where is my order?' });
    const bot = second.body.messages.find((m: any) => m.role === 'bot');
    assert.match(bot.body, /number 1 in the queue/); assert.match(bot.body, /about \d+ minute/);
    const qb = (await call('GET', '/chat/thread', b)).body.queue;
    assert.equal(qb.state, 'waiting'); assert.equal(qb.adminBusy, true); assert.ok(qb.estimatedMinutes >= 3);
    assert.equal((await call('GET', '/admin/chat/summary', admin)).body.waiting, 1);

    // Closing A frees the shopkeeper: B now only waits for the reply.
    assert.equal((await call('POST', `/admin/chat/threads/${threadA.id}/close`, admin)).status, 204);
    const after = (await call('GET', '/chat/thread', b)).body.queue;
    assert.equal(after.position, 1); assert.equal(after.adminBusy, false);
    assert.equal((await call('POST', `/admin/chat/threads/${threadA.id}/messages`, admin, { body: 'late' })).status, 409);
    assert.equal((await call('POST', '/chat/close', b)).status, 204);
  });

  it('marks, deletes and clears notifications one at a time', async () => {
    const notice = await call('POST', '/admin/announcements', admin, { items: [{ title: 'Test notice', body: 'Open on Sunday', expiresAt: new Date(Date.now() + 86400000).toISOString() }] }); // one for A, one for B
    const list = (await call('GET', '/notifications', a)).body.notifications;
    assert.ok(list.length >= 2);
    assert.ok(list.every((n: any) => n.read === false));
    // Opening the list must not read anything.
    assert.ok((await call('GET', '/notifications', a)).body.notifications.every((n: any) => n.read === false));
    assert.equal((await call('POST', `/notifications/${list[0].id}/read`, a)).status, 204);
    const after = (await call('GET', '/notifications', a)).body.notifications;
    assert.equal(after.filter((n: any) => n.read).length, 1);
    assert.equal(after.find((n: any) => n.id === list[0].id).read, true);
    // Somebody else's notification cannot be touched.
    assert.equal((await call('DELETE', `/notifications/${list[1].id}`, b)).status, 204);
    assert.equal((await call('GET', '/notifications', a)).body.notifications.length, list.length);
    assert.equal((await call('DELETE', `/notifications/${list[1].id}`, a)).status, 204);
    assert.equal((await call('GET', '/notifications', a)).body.notifications.length, list.length - 1);
    assert.equal((await call('DELETE', '/notifications', a)).status, 204);
    assert.equal((await call('GET', '/notifications', a)).body.notifications.length, 0);
    assert.ok((await call('GET', '/notifications', b)).body.notifications.length >= 1, 'B keeps theirs');
    assert.equal((await call('DELETE', `/admin/announcements/${notice.body.ids[0]}`, admin)).status, 204); // removes everybody's copy
  });

  it('lets a customer review a delivered order and the admin approve it', async () => {
    const addr = await call('POST', '/addresses', a, { label: 'home', recipientName: 'Chat Alpha', phone: A, line1: 'B-12 Mansarovar', pincode: '302020' });
    const cfg = await call('GET', '/config');
    const day = cfg.body.deliveryDays.find((d: any) => d.slots.some((s: any) => s.available));
    const slot = day.slots.find((s: any) => s.available);
    const rx = [{ publicId: `prescriptions/${aId}/rx-1`, mimeType: 'image/jpeg', sizeBytes: 1000, url: 'https://example.com/rx.jpg' }];
    const created = await call('POST', '/orders', a, { kind: 'prescription', prescriptions: rx, items: [{ name: 'Cetirizine', quantity: 1 }], addressId: addr.body.address.id, deliveryDate: day.date, deliverySlot: slot.id, idempotencyKey: 'extras-key-01' });
    assert.equal(created.status, 201);
    const orderId = created.body.order.id as string;

    assert.equal((await call('POST', '/reviews', a, { orderId, rating: 5, comment: 'Great' })).status, 409, 'not delivered yet');
    await pool.query("update orders set status = 'delivered', quoted_amount = 250 where id = $1", [orderId]);
    await pool.query("insert into status_history (order_id, status) values ($1, 'delivered')", [orderId]);

    assert.equal((await call('POST', '/reviews', a, { orderId, rating: 5, images: [{ publicId: 'reviews/someone-else/x', mimeType: 'image/jpeg' }] })).status, 400);
    const made = await call('POST', '/reviews', a, { orderId, rating: 5, comment: 'Quick and polite delivery', images: [{ publicId: `reviews/${aId}/photo-1`, mimeType: 'image/jpeg', sizeBytes: 900 }] });
    assert.equal(made.status, 201); assert.equal(made.body.review.status, 'pending');
    assert.equal((await call('POST', '/reviews', a, { orderId, rating: 4 })).status, 409, 'one review per order');
    assert.equal((await call('GET', `/orders/${orderId}`, a)).body.order.review.status, 'pending');

    // Pending reviews are not public, the admin sees them.
    const pending = (await call('GET', '/admin/reviews?status=pending', admin)).body.reviews;
    const mine = pending.find((r: any) => r.id === made.body.review.id);
    assert.ok(mine); assert.equal(mine.images.length, 1);
    assert.equal((await call('POST', `/admin/reviews/${mine.id}/decision`, a, { status: 'approved' })).status, 403);
    assert.equal((await call('POST', `/admin/reviews/${mine.id}/decision`, admin, { status: 'approved' })).body.review.status, 'approved');
    assert.equal((await call('POST', `/admin/reviews/${mine.id}/decision`, admin, { status: 'rejected' })).status, 409);
    const profile = (await call('GET', '/reviews/mine', a)).body.reviews;
    assert.equal(profile[0].status, 'approved'); assert.equal(profile[0].rating, 5);

    // Admin analytics and exports
    const rev = (await call('GET', '/admin/revenue?days=30', admin)).body;
    assert.ok(rev.sales >= 250 && rev.daily.length >= 1);
    const ov = (await call('GET', '/admin/overview', admin)).body;
    assert.ok(ov.customers >= 2 && ov.ordersTotal >= 1);
    assert.equal((await call('GET', `/admin/customers/${aId}`, admin)).body.lifetimeValue, 250);
    for (const kind of ['orders', 'revenue', 'customers', 'payments', 'attendance', 'reviews']) {
      const link = (await call('GET', `/admin/export-link?kind=${kind}&days=30`, admin)).body.url as string;
      const res = await fetch(link.replace(/^https?:\/\/[^/]+/, base));
      assert.equal(res.status, 200, kind);
      assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
      assert.ok((await res.text()).length > 10);
    }
    const link = (await call('GET', '/admin/export-link?kind=orders', admin)).body.url as string;
    assert.equal((await fetch(link.replace(/^https?:\/\/[^/]+/, base).replace('orders.csv', 'customers.csv'))).status, 401, 'token is tied to its kind');
    assert.equal((await fetch(`${base}/export/orders.csv?t=bad`)).status, 401);
    assert.equal((await call('GET', '/admin/export-link?kind=orders', a)).status, 403);
    const csv = await (await fetch(link.replace(/^https?:\/\/[^/]+/, base))).text();
    assert.match(csv, /Order,Date,Customer/);
  });

  it('keeps the profile picture to the user\'s own folder', async () => {
    assert.equal((await call('PUT', '/me/avatar', a, { publicId: 'avatars/someone-else/p' })).status, 400);
    const ok = await call('PUT', '/me/avatar', a, { publicId: `avatars/${aId}/me` });
    assert.equal(ok.status, 200);
    assert.equal((await call('DELETE', '/me/avatar', a)).status, 200);
    assert.equal((await call('POST', '/uploads/sign', a, { purpose: 'bill' })).status, 403);
  });
});
