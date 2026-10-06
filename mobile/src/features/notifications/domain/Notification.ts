/** What the business calls a notification. Independent of the backend's JSON and of any screen. */
export type NotificationKind = 'order' | 'chat' | 'review' | 'announcement' | 'other';

export interface Notification {
  id: string;
  kind: NotificationKind;
  /** Server type string, kept for display decisions that are not worth a new kind. */
  type: string;
  title: string;
  body: string;
  read: boolean;
  /** ISO timestamp. */
  createdAt: string;
  orderId: string | null;
  orderNumber: string | null;
}

export const kindOf = (type: string): NotificationKind =>
  type.startsWith('chat') ? 'chat' : type.startsWith('review') ? 'review' : type === 'announcement' ? 'announcement' : type.startsWith('order') || type.startsWith('quote') || type.startsWith('payment') || type.startsWith('partner') ? 'order' : 'other';

/** Where tapping a notification should lead, as an intent. The screen decides how to navigate there. */
export type Destination = { screen: 'OrderDetail'; orderId: string } | { screen: 'Chat' } | { screen: 'MyReviews' } | null;

export function destinationOf(n: Pick<Notification, 'kind' | 'orderId'>): Destination {
  if (n.kind === 'chat') return { screen: 'Chat' };
  if (n.kind === 'review') return { screen: 'MyReviews' };
  return n.orderId ? { screen: 'OrderDetail', orderId: n.orderId } : null;
}

export const unreadCount = (items: readonly Notification[]) => items.filter((n) => !n.read).length;
