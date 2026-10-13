import { StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../api/endpoints';
import { useLoad } from '../hooks';
import { colors } from '../theme';
import { Tap } from './motion';
import { Icon } from './ui';

/** Bell with the number of unread notifications; the count refreshes live when a new notification arrives. */
export function NotificationBell({ onPress, label }: { onPress: () => void; label: string }) {
  const unread = useLoad(async () => (await endpoints.notifications()).notifications.filter((n) => !n.read).length, ['notification']);
  const n = unread.data ?? 0;
  return (
    <Tap accessibilityRole="button" accessibilityLabel={n ? `${label} (${n})` : label} onPress={onPress} hitSlop={10} style={s.bell}>
      <Icon name={n ? 'notifications' : 'notifications-outline'} size={26} color={colors.navy} />
      {n > 0 ? <View style={s.badge}><Text style={s.badgeText}>{n > 9 ? '9+' : n}</Text></View> : null}
    </Tap>
  );
}

const s = StyleSheet.create({
  bell: { padding: 4 },
  badge: { position: 'absolute', right: -2, top: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 10, lineHeight: 14, fontFamily: 'NotoSansDevanagari_700Bold' },
});
