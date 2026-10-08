import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { enableNotifications, notificationsEnabled, openNotificationSettings } from '../push';
import { colors, type } from '../theme';
import { Tap } from './motion';
import { Icon } from './ui';

/** Profile row: shows whether phone notifications are on, and turns them on (or opens the phone's settings) when tapped. */
export function NotificationsRow() {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const check = useCallback(() => { void notificationsEnabled().then(setOn); }, []);
  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); }); // back from the phone's settings
    return () => sub.remove();
  }, [check]);
  const press = async () => { if (on) await openNotificationSettings(); else { await enableNotifications(); check(); } };
  return (
    <Tap accessibilityRole="button" accessibilityLabel={t('notif.row')} onPress={press} scaleTo={0.98} style={s.row}>
      <Icon name={on === false ? 'notifications-off-outline' : 'notifications-circle-outline'} size={24} color={on === false ? colors.red : colors.navy} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{t('notif.row')}</Text>
        <Text style={[type.small, { color: on === false ? colors.red : colors.secondary }]}>{on === null ? ' ' : on ? t('notif.on') : t('notif.offTap')}</Text>
      </View>
      <Icon name="chevron-forward" size={20} color={colors.muted} />
    </Tap>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
