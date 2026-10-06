import type { Notification } from './Notification';
import type { NotificationRepository } from './NotificationRepository';

/** Business operations on notifications. Each one is a small function over the repository interface. */
export function createNotificationUseCases(repo: NotificationRepository) {
  return {
    /** Newest first, whatever order the data source returns. */
    async list(): Promise<Notification[]> {
      const items = await repo.list();
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    /** Reading one notification marks only that one. Already-read ones cost no request. */
    async markRead(n: Pick<Notification, 'id' | 'read'>): Promise<void> {
      if (n.read) return;
      await repo.markRead(n.id);
    },
    async markAllRead(items: readonly Notification[]): Promise<void> {
      if (items.every((n) => n.read)) return;
      await repo.markAllRead();
    },
    async remove(id: string): Promise<void> { await repo.remove(id); },
    async clearAll(items: readonly Notification[]): Promise<void> {
      if (items.length === 0) return;
      await repo.clear();
    },
  };
}
export type NotificationUseCases = ReturnType<typeof createNotificationUseCases>;
