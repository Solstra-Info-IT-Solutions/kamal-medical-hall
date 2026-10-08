import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { Icon } from './ui';

type IconName = 'camera' | 'images' | 'document-text';
export interface SourceOption { icon: IconName; label: string; onPress: () => void }

/** "Take a photo / Choose from gallery / Choose a file" as large, easy-to-read rows (same look on every screen that attaches files). */
export function SourceOptions({ options, disabled }: { options: SourceOption[]; disabled?: boolean }) {
  return (
    <View style={s.wrap}>
      {options.map((o) => (
        <Pressable key={o.label} accessibilityRole="button" accessibilityLabel={o.label} disabled={disabled} onPress={o.onPress}
          style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }, disabled && { opacity: 0.5 }]}>
          <View style={s.puck}><Icon name={o.icon} size={24} color={colors.primary} /></View>
          <Text style={[type.bodyMedium, s.label]} numberOfLines={2}>{o.label}</Text>
          <Icon name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  puck: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 16, color: colors.text },
});
