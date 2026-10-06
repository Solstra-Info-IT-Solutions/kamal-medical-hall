import type { ZodType } from 'zod';
import type { Notification } from '../domain/Notification';
import type { NotificationRepository } from '../domain/NotificationRepository';
import { notificationsResponseSchema } from './notificationDto';
import { toNotification } from './notificationMapper';

/** The network call the data source needs, as a function type, so tests (and other transports) can supply their own. */
export type ApiCall = <T>(method: string, path: string, body?: unknown, opts?: { schema?: ZodType<T> }) => Promise<T>;

/** Remote data source: knows URLs and DTOs, nothing about screens or business rules. */
export class NotificationRemoteDataSource {
  constructor(private readonly api: ApiCall) {}
  fetchAll() { return this.api('GET', '/notifications', undefined, { schema: notificationsResponseSchema }); }
  markRead(id: string) { return this.api<void>('POST', `/notifications/${encodeURIComponent(id)}/read`); }
  markAllRead() { return this.api<void>('POST', '/notifications/read-all'); }
  remove(id: string) { return this.api<void>('DELETE', `/notifications/${encodeURIComponent(id)}`); }
  clear() { return this.api<void>('DELETE', '/notifications'); }
}

export class NotificationRepositoryImpl implements NotificationRepository {
  constructor(private readonly remote: NotificationRemoteDataSource) {}
  async list(): Promise<Notification[]> { return (await this.remote.fetchAll()).notifications.map(toNotification); }
  async markRead(id: string) { await this.remote.markRead(id); }
  async markAllRead() { await this.remote.markAllRead(); }
  async remove(id: string) { await this.remote.remove(id); }
  async clear() { await this.remote.clear(); }
}
