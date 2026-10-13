import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Skeleton } from '../../../components/motion';
import { Button, ErrorView, Icon, Message, Screen } from '../../../components/ui';
import { showDialog, showErrorPopup } from '../../../dialog';
import { openFromNotification } from '../../../navigation/ref';
import type { CustomerStackParamList } from '../../../navigation/types';
import { useSession } from '../../../store/session';
import { colors, radius, spacing, type } from '../../../theme';
import { formatDateTime } from '../../../utils';
import type { Destination } from '../domain/Notification';
import { useNotificationsViewModel } from './useNotificationsViewModel';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/** The View: draws the state it is given and forwards taps to the view model. No data access in here. */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { vm, state } = useNotificationsViewModel();

  // Failed actions are shown as a popup, once.
  useEffect(() => {
    if (!state.actionError) return;
    void showErrorPopup(state.actionError, t('common.error'), t('common.ok')).then(() => vm.dismissError());
  }, [state.actionError, vm, t]);

  const role = useSession((st) => st.user?.role);
  const go = (d: Destination, n?: { orderId: string | null; type: string; announcementId?: string | null }) => {
    // Staff (admin, delivery partner) open their own screens for the same notification.
    if (role && role !== 'customer') { if (n) openFromNotification(n); return; }
    if (!d) return;
    if (d.screen === 'OrderDetail') nav.navigate('OrderDetail', { orderId: d.orderId });
    else if (d.screen === 'Announcement') nav.navigate('Announcement', { id: d.id });
    else if (d.screen === 'Chat') nav.navigate('Chat', undefined);
    else nav.navigate('MyReviews');
  };
  const clearAll = async () => {
    const ok = await showDialog({ title: t('notifications.clearTitle'), message: t('notifications.clearMsg'), icon: 'trash', tone: 'danger', confirmLabel: t('notifications.clearAll'), cancelLabel: t('common.cancel') });
    if (ok) void vm.clearAll();
  };

  if (state.status === 'loading') return <View style={{ gap: 14, padding: spacing.lg }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={96} r={16} />)}</View>;
  if (state.status === 'error') return <ErrorView message={state.loadError ?? t('common.error')} onRetry={() => { void vm.load(); }} retryLabel={t('common.retry')} />;
  if (state.items.length === 0) return <Message icon="notifications-off-outline" title={t('notifications.empty')} />;

  return (
    <Screen>
      <View style={s.actions}>
        <Button small variant="outline" icon="checkmark-done" title={t('notifications.markAll')} onPress={() => { void vm.markAllRead(); }} disabled={state.unread === 0} style={{ flex: 1 }} />
        <Button small variant="danger" icon="trash-outline" title={t('notifications.clearAll')} onPress={() => { void clearAll(); }} style={{ flex: 1 }} />
      </View>
      {state.items.map((n) => (
        <View key={n.id} style={[s.note, !n.read && { backgroundColor: colors.card }]}>
          <Pressable accessibilityRole="button" onPress={() => { void vm.open(n.id).then((d) => go(d, n)); }} style={s.main}>
            <View style={[s.dot, !n.read && { backgroundColor: colors.primary }]} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{n.title}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{n.body}</Text>
              <Text style={[type.small, { color: colors.muted, marginTop: 4 }]}>{formatDateTime(n.createdAt)}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={t('notifications.delete')} hitSlop={8} onPress={() => { void vm.remove(n.id); }} style={s.trash}>
            <Icon name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: spacing.md },
  note: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.lg },
  main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: spacing.md },
  trash: { padding: spacing.md },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border, marginTop: 6 },
});
