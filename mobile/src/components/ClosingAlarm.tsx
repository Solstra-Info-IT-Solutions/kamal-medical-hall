import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Vibration } from 'react-native';
import { showDialog } from '../dialog';
import { openFromNotification } from '../navigation/ref';
import { onRealtime } from '../realtime';
import { useSession } from '../store/session';

/**
 * One hour before closing the server sends the admin the day's revenue and who still owes cash. While the app is open it
 * rings (vibration pattern) and shows a popup that does not go away on its own; when the app is closed the same message
 * arrives as a push notification.
 */
export function ClosingAlarm() {
  const { t } = useTranslation();
  const admin = useSession((s) => s.status === 'in' && s.user?.role === 'admin');
  useEffect(() => {
    if (!admin) return;
    return onRealtime('closing:alert', async (a: { message: string }) => {
      Vibration.vibrate([0, 600, 300, 600, 300, 600]);
      const view = await showDialog({ title: t('cash.alarmTitle'), message: a.message, icon: 'alarm', confirmLabel: t('cash.alarmView'), cancelLabel: t('cash.alarmClose') });
      Vibration.cancel();
      if (view) openFromNotification({ type: 'closing_alert' });
    });
  }, [admin, t]);
  return null;
}
