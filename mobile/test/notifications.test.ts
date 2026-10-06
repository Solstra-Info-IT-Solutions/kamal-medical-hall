import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { notificationDtoSchema, notificationsResponseSchema } from '../src/features/notifications/data/notificationDto';
import { toNotification } from '../src/features/notifications/data/notificationMapper';
import { NotificationRemoteDataSource, NotificationRepositoryImpl, type ApiCall } from '../src/features/notifications/data/NotificationRepositoryImpl';
import { destinationOf, kindOf, type Notification } from '../src/features/notifications/domain/Notification';
import type { NotificationRepository } from '../src/features/notifications/domain/NotificationRepository';
import { createNotificationUseCases } from '../src/features/notifications/domain/useCases';
import { createNotificationsViewModel } from '../src/features/notifications/presentation/NotificationsViewModel';

const dto = (over: Record<string, unknown> = {}) => ({ id: 'n1', type: 'order_update', title: 'T', body: 'B', read: false, createdAt: '2026-10-07T10:00:00Z', orderId: 'o1', orderNumber: 'KMH1', ...over });
const note = (over: Partial<Notification> = {}): Notification => toNotification(dto(over as Record<string, unknown>) as never) && { id: 'n1', kind: 'order', type: 'order_update', title: 'T', body: 'B', read: false, createdAt: '2026-10-07T10:00:00Z', orderId: 'o1', orderNumber: 'KMH1', ...over };

/** In-memory repository that records what the use cases asked for. */
function fakeRepo(items: Notification[], fail: Partial<Record<keyof NotificationRepository, Error>> = {}) {
  const calls: string[] = [];
  const repo: NotificationRepository = {
    async list() { calls.push('list'); if (fail.list) throw fail.list; return items; },
    async markRead(id) { calls.push(`markRead:${id}`); if (fail.markRead) throw fail.markRead; },
    async markAllRead() { calls.push('markAllRead'); if (fail.markAllRead) throw fail.markAllRead; },
    async remove(id) { calls.push(`remove:${id}`); if (fail.remove) throw fail.remove; },
    async clear() { calls.push('clear'); if (fail.clear) throw fail.clear; },
  };
  return { repo, calls };
}

describe('notifications: data layer', () => {
  it('accepts the API shape and rejects anything else', () => {
    assert.ok(notificationDtoSchema.safeParse(dto()).success);
    assert.ok(!notificationDtoSchema.safeParse(dto({ id: '' })).success);
    assert.ok(!notificationDtoSchema.safeParse(dto({ read: 'no' })).success);
    assert.ok(!notificationsResponseSchema.safeParse({ notifications: [dto({ title: undefined })] }).success);
  });

  it('maps DTOs to entities and classifies the type', () => {
    assert.equal(kindOf('chat_reply'), 'chat'); assert.equal(kindOf('review_approved'), 'review'); assert.equal(kindOf('announcement'), 'announcement');
    assert.equal(kindOf('order_update'), 'order'); assert.equal(kindOf('quote_ready'), 'order'); assert.equal(kindOf('store_closed'), 'other');
    assert.equal(toNotification(dto({ type: 'chat_new' }) as never).kind, 'chat');
  });

  it('calls the right URLs, encodes ids, and validates the list response', async () => {
    const seen: string[] = [];
    const api: ApiCall = async <T,>(method: string, path: string, _b?: unknown, opts?: { schema?: { safeParse(x: unknown): { success: boolean; data?: unknown } } }) => {
      seen.push(`${method} ${path}`);
      if (method === 'GET') { const parsed = opts?.schema?.safeParse({ notifications: [dto({ id: 'b' }), dto({ id: 'a' })] }); assert.ok(parsed?.success); return parsed.data as T; }
      return undefined as T;
    };
    const repo = new NotificationRepositoryImpl(new NotificationRemoteDataSource(api));
    assert.deepEqual((await repo.list()).map((n) => n.id), ['b', 'a']);
    await repo.markRead('x/../y'); await repo.markAllRead(); await repo.remove('n1'); await repo.clear();
    assert.deepEqual(seen, ['GET /notifications', 'POST /notifications/x%2F..%2Fy/read', 'POST /notifications/read-all', 'DELETE /notifications/n1', 'DELETE /notifications']);
  });
});

describe('notifications: use cases', () => {
  it('lists newest first and skips pointless requests', async () => {
    const { repo, calls } = fakeRepo([note({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }), note({ id: 'new', createdAt: '2026-10-07T00:00:00Z' })]);
    const uc = createNotificationUseCases(repo);
    assert.deepEqual((await uc.list()).map((n) => n.id), ['new', 'old']);
    await uc.markRead({ id: 'a', read: true });
    await uc.markAllRead([note({ read: true })]);
    await uc.clearAll([]);
    assert.deepEqual(calls, ['list'], 'nothing was sent for already-read or empty lists');
    await uc.markRead({ id: 'a', read: false }); await uc.clearAll([note()]);
    assert.deepEqual(calls, ['list', 'markRead:a', 'clear']);
  });
});

describe('notifications: view model', () => {
  const items = () => [note({ id: 'a', read: false, createdAt: '2026-10-07T03:00:00Z' }), note({ id: 'b', read: false, kind: 'chat', type: 'chat_reply', orderId: null, createdAt: '2026-10-07T02:00:00Z' }), note({ id: 'c', read: true, createdAt: '2026-10-07T01:00:00Z' })];
  const make = (fail: Partial<Record<keyof NotificationRepository, Error>> = {}, data = items()) => {
    const { repo, calls } = fakeRepo(data, fail);
    return { vm: createNotificationsViewModel(createNotificationUseCases(repo)), calls };
  };

  it('loads, shows the unread count and shares concurrent loads', async () => {
    const { vm, calls } = make();
    assert.equal(vm.getState().status, 'loading');
    await Promise.all([vm.load(), vm.load(), vm.load()]);
    assert.equal(calls.filter((c) => c === 'list').length, 1);
    assert.equal(vm.getState().status, 'ready'); assert.equal(vm.getState().unread, 2); assert.deepEqual(vm.getState().items.map((n) => n.id), ['a', 'b', 'c']);
  });

  it('shows a retryable error when the first load fails, and keeps the list when a later refresh fails', async () => {
    const first = make({ list: new Error('offline') });
    await first.vm.load();
    assert.equal(first.vm.getState().status, 'error'); assert.equal(first.vm.getState().loadError, 'offline');
    const { repo } = fakeRepo(items());
    let fail = false;
    const flaky = { ...repo, list: async () => { if (fail) throw new Error('timeout'); return repo.list(); } };
    const vm = createNotificationsViewModel(createNotificationUseCases(flaky));
    await vm.load(); fail = true; await vm.load();
    assert.equal(vm.getState().status, 'ready'); assert.equal(vm.getState().items.length, 3); assert.equal(vm.getState().actionError, 'timeout');
  });

  it('opening one notification marks only that one and returns where it leads', async () => {
    const { vm, calls } = make();
    await vm.load();
    assert.deepEqual(await vm.open('a'), { screen: 'OrderDetail', orderId: 'o1' });
    assert.deepEqual(vm.getState().items.map((n) => [n.id, n.read]), [['a', true], ['b', false], ['c', true]], 'b stays unread');
    assert.equal(vm.getState().unread, 1);
    assert.deepEqual(await vm.open('b'), { screen: 'Chat' });
    await vm.open('c'); // already read: no request
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls.filter((c) => c.startsWith('markRead')), ['markRead:a', 'markRead:b']);
    assert.equal(await vm.open('missing'), null);
  });

  it('undoes an optimistic change and reports the problem when the server refuses', async () => {
    const { vm } = make({ remove: new Error('Not allowed') });
    await vm.load();
    await vm.remove('a');
    assert.equal(vm.getState().items.length, 3, 'rolled back');
    assert.equal(vm.getState().actionError, 'Not allowed');
    vm.dismissError();
    assert.equal(vm.getState().actionError, null);
  });

  it('removes one, marks all as read, and clears all', async () => {
    const { vm, calls } = make();
    await vm.load();
    await vm.remove('b');
    assert.deepEqual(vm.getState().items.map((n) => n.id), ['a', 'c']);
    await vm.markAllRead();
    assert.equal(vm.getState().unread, 0);
    await vm.clearAll();
    assert.equal(vm.getState().items.length, 0);
    assert.deepEqual(calls.slice(1), ['remove:b', 'markAllRead', 'clear']);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const { vm } = make();
    let n = 0; const off = vm.subscribe(() => { n += 1; });
    await vm.load(); const seen = n; assert.ok(seen > 0);
    off(); await vm.remove('a'); assert.equal(n, seen);
  });

  it('maps each kind to a destination', () => {
    assert.deepEqual(destinationOf({ kind: 'review', orderId: null }), { screen: 'MyReviews' });
    assert.equal(destinationOf({ kind: 'announcement', orderId: null }), null);
  });
});
