import { Linking, StyleSheet, Text } from 'react-native';
import { colors, radius, type } from '../theme';
import { Tap } from './motion';
import { Icon } from './ui';

/** Opens the phone dialer. `compact` renders a round icon-only button for dense rows. */
export function CallButton({ phone, label, compact, tone = 'green' }: { phone: string | null | undefined; label?: string; compact?: boolean; tone?: 'green' | 'blue' }) {
  if (!phone) return null;
  const fg = tone === 'green' ? colors.green : colors.primary;
  const bg = tone === 'green' ? colors.greenBg : colors.card;
  const open = () => { void Linking.openURL(`tel:${phone}`); };
  if (compact) {
    return <Tap accessibilityRole="button" accessibilityLabel={label ?? `Call ${phone}`} onPress={open} hitSlop={8} style={[s.round, { backgroundColor: bg }]}><Icon name="call" size={20} color={fg} /></Tap>;
  }
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label ?? `Call ${phone}`} onPress={open} style={[s.pill, { backgroundColor: fg }]}>
      <Icon name="call" size={18} color={colors.white} />
      <Text numberOfLines={1} style={[type.smallMedium, { color: colors.white, fontSize: 14 }]}>{label ?? phone}</Text>
    </Tap>
  );
}

export const Avatar = ({ name, size = 44 }: { name: string | null | undefined; size?: number }) => {
  const initials = (name ?? '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  return <Tap disabled haptic={false} style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}><Text style={[type.bodyMedium, { color: colors.primary }]}>{initials}</Text></Tap>;
};

const s = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, minHeight: 44, borderRadius: radius.md },
  avatar: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
});
