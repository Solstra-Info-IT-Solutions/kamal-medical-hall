import { Image, Linking, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { Tap } from './motion';
import { Icon } from './ui';

/** Opens the phone dialer. `compact` renders a round icon-only button for dense rows. */
export function CallButton({ phone, label, compact, small, tone = 'green' }: { phone: string | null | undefined; label?: string; compact?: boolean; small?: boolean; tone?: 'green' | 'blue' }) {
  if (!phone) return null;
  const fg = tone === 'green' ? colors.green : colors.primary;
  const bg = tone === 'green' ? colors.greenBg : colors.card;
  const open = () => { void Linking.openURL(`tel:${phone}`); };
  if (compact) {
    return <Tap accessibilityRole="button" accessibilityLabel={label ?? `Call ${phone}`} onPress={open} hitSlop={8} style={[s.round, { backgroundColor: bg }]}><Icon name="call" size={20} color={fg} /></Tap>;
  }
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label ?? `Call ${phone}`} onPress={open} style={[s.pill, small && s.pillSmall, { backgroundColor: fg }]}>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} style={[type.button, small && { fontSize: 15, lineHeight: 22 }, { color: colors.white, flexShrink: 1, textAlign: 'center' }]}>{label ?? phone}</Text>
      <Icon name="call" size={small ? 18 : 20} color={colors.white} />
    </Tap>
  );
}

/** Round profile picture, or the person's initials when they have not set one. */
export const Avatar = ({ name, size = 44, uri }: { name: string | null | undefined; size?: number; uri?: string | null }) => {
  const initials = (name ?? '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <View style={[s.avatar, box, { overflow: 'hidden' }]}><Image source={{ uri }} style={{ width: size, height: size }} accessibilityLabel={name ?? 'Profile picture'} /></View>;
  return <View style={[s.avatar, box]}><Text style={[type.bodyMedium, { color: colors.primary, fontSize: Math.max(12, size * 0.34) }]}>{initials}</Text></View>;
};

const s = StyleSheet.create({
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  // Same size as <Button>, so a Call button and a Directions / Message button next to each other line up exactly.
  pill: { minWidth: 128, minHeight: 52, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  pillSmall: { minHeight: 40, paddingHorizontal: 14, borderRadius: radius.sm },
  avatar: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.cardBorder },
});
