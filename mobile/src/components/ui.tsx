import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, type } from '../theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export const Icon = ({ name, size = 24, color = colors.primary }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

export function Screen({ children, scroll = true, footer, padded = true, style }: { children: ReactNode; scroll?: boolean; footer?: ReactNode; padded?: boolean; style?: StyleProp<ViewStyle> }) {
  const body = scroll
    ? <ScrollView style={s.flex} contentContainerStyle={[padded && s.pad, style]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
    : <View style={[s.flex, padded && s.pad, style]}>{children}</View>;
  return <SafeAreaView style={s.screen} edges={['bottom', 'left', 'right']}>{body}{footer ? <View style={s.footer}>{footer}</View> : null}</SafeAreaView>;
}

export function BackButton({ onPress }: { onPress?: () => void }) {
  const nav = useNavigation();
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={onPress ?? (() => nav.goBack())} style={s.back}><Icon name="chevron-back" size={28} color={colors.text} /></Pressable>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: { title: string; onPress: () => void; variant?: 'primary' | 'outline' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const off = disabled || loading;
  const fg = variant === 'primary' ? colors.white : variant === 'danger' ? colors.red : colors.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [s.btn, variant === 'primary' && s.btnPrimary, variant === 'outline' && s.btnOutline, variant === 'danger' && s.btnDanger, variant === 'ghost' && s.btnGhost, off && s.btnOff, pressed && { opacity: 0.85 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>
        <Text style={[type.button, { color: fg }]}>{title}</Text>
        {icon ? <Icon name={icon} size={20} color={fg} /> : null}
      </>}
    </Pressable>
  );
}

export function TextField({ label, error, style, ...rest }: TextInputProps & { label?: string; error?: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} {...rest} style={[s.input, !!error && { borderColor: colors.red }, rest.multiline && { minHeight: 84, textAlignVertical: 'top' }, style]} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export const Card = ({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) =>
  onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.8 }]}>{children}</Pressable> : <View style={[s.card, style]}>{children}</View>;

const PILL = {
  green: { bg: colors.greenBg, fg: colors.green }, red: { bg: colors.redBg, fg: colors.red },
  amber: { bg: colors.amberBg, fg: colors.amber }, blue: { bg: colors.card, fg: colors.primary },
} as const;
export const Pill = ({ text, tone = 'blue' }: { text: string; tone?: keyof typeof PILL }) =>
  <View style={{ backgroundColor: PILL[tone].bg, paddingHorizontal: 12, paddingVertical: 3, borderRadius: radius.md }}><Text style={[type.smallMedium, { color: PILL[tone].fg }]}>{text}</Text></View>;

export const Loading = () => <View style={s.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

export function Message({ icon = 'information-circle-outline', title, text, actionLabel, onAction }: { icon?: IconName; title: string; text?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={s.center}>
      <View style={s.msgIcon}><Icon name={icon} size={36} /></View>
      <Text style={[type.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[type.body, { color: colors.secondary, textAlign: 'center', marginTop: 4 }]}>{text}</Text> : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} variant="outline" style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xxl }} /> : null}
    </View>
  );
}

export const ErrorView = ({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) =>
  <Message icon="cloud-offline-outline" title={message} actionLabel={retryLabel} onAction={onRetry} />;

export const SectionTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) =>
  <View style={s.sectionRow}><Text style={[type.h3, { color: colors.text }]}>{children}</Text>{right}</View>;

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.white },
  back: { padding: 4, marginLeft: 4 },
  btn: { minHeight: 54, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: spacing.lg },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.white },
  btnDanger: { borderWidth: 1.5, borderColor: colors.red, backgroundColor: colors.white },
  btnGhost: { backgroundColor: 'transparent' },
  btnOff: { opacity: 0.5 },
  label: { ...type.smallMedium, color: colors.secondary, marginBottom: 6 },
  input: { ...type.body, minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.lg, color: colors.text, backgroundColor: colors.white },
  error: { ...type.small, color: colors.red, marginTop: 4 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.lg, padding: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  msgIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
});
