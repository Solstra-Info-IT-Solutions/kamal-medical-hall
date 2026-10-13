import { createNavigationContainerRef } from '@react-navigation/native';
import { useSession } from '../store/session';

export const navigationRef = createNavigationContainerRef<Record<string, object | undefined>>();

/** Opens the order screen that matches the signed-in role (used when a live notification is tapped). */
export function openOrderFromNotification(orderId: string | null) {
  if (!orderId || !navigationRef.isReady()) return;
  const role = useSession.getState().user?.role;
  if (role === 'admin') navigationRef.navigate('OrderReview', { orderId });
  else if (role === 'delivery_partner') navigationRef.navigate('Job', { orderId });
  else navigationRef.navigate('OrderDetail', { orderId });
}

/** Where a tapped notification leads: cash notifications open the admin's cash screen, everything else the order. */
export function openFromNotification(n: { orderId?: string | null; type?: string | null; announcementId?: string | null }) {
  if (!navigationRef.isReady()) return;
  if (useSession.getState().user?.role === 'admin') {
    const type = n.type ?? '';
    if (type === 'closing_alert' || type === 'cash_to_collect') { navigationRef.navigate('Cash'); return; }
    if (!n.orderId && type.startsWith('chat')) { navigationRef.navigate('AdminChats'); return; }
    if (!n.orderId && type.startsWith('review')) { navigationRef.navigate('AdminReviews'); return; }
    if (!n.orderId && type === 'announcement') { navigationRef.navigate('Announcements'); return; }
  }
  if (n.type === 'announcement' && n.announcementId) { navigationRef.navigate('Announcement', { id: n.announcementId }); return; }
  openOrderFromNotification(n.orderId ?? null);
}
