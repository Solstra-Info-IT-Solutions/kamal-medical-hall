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
