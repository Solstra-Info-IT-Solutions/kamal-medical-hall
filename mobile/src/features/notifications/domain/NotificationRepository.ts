import type { Notification } from './Notification';

/** The domain's view of where notifications come from. Implemented in the data layer. */
export interface NotificationRepository {
  list(): Promise<Notification[]>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
