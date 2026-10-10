import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useNavigation } from '@react-navigation/native';
import { Children, forwardRef, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useContentStyle, useLayout } from '../layout';
import { colors, radius, spacing, type } from '../theme';
import { Float, Ripples, Skeleton, Tap, useShake } from './motion';

export type IconName = keyof typeof Ionicons.glyphMap;
export const Icon = ({ name, size = 24, color = colors.primary }: { name: IconName; size?: number; color?: string }) => <Ionicons name={name} size={size} color={color} />;

/**
 * Standard screen: scrolls, avoids the keyboard (so inputs and the sticky footer button are never hidden)
 * and animates its footer in.
 */
export function Screen({ children, scroll = true, footer, padded = true, style, wide = false }: { children: ReactNode; scroll?: boolean; footer?: ReactNode; padded?: boolean; style?: StyleProp<ViewStyle>; wide?: boolean }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const { gutter } = useLayout();
  const column = useContentStyle(wide);
  const pad = padded ? { paddingHorizontal: gutter, paddingTop: spacing.md, paddingBottom: spacing.xxl } : null;
  const body = scroll
    ? <ScrollView style={s.flex} contentContainerStyle={[pad, column, style]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>{children}</ScrollView>
    : <View style={[s.flex, pad, column, style]}>{children}</View>;
  return (
    <SafeAreaView style={s.screen} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={s.flex} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {body}
        {footer ? <Animated.View entering={FadeInDown.delay(150).duration(420)} style={s.footer}><View style={[column, { paddingHorizontal: gutter }]}>{footer}</View></Animated.View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Lays children out in 1 / 2 / 3 columns depending on the screen width (cards stay readable on tablets and desktops). */
export function ResponsiveGrid({ children, columns, gap = 12 }: { children: ReactNode; columns?: number; gap?: number }) {
  const { columns: auto } = useLayout();
  const cols = columns ?? auto;
  const items = Children.toArray(children);
  if (cols <= 1) return <>{items}</>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -gap / 2 }}>
      {items.map((child, i) => <View key={i} style={{ width: `${100 / cols}%`, paddingHorizontal: gap / 2 }}>{child}</View>)}
    </View>
  );
}

export function BackButton({ onPress }: { onPress?: () => void }) {
  const nav = useNavigation();
  return <Tap accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={onPress ?? (() => nav.goBack())} style={s.back}><Icon name="chevron-back" size={28} color={colors.text} /></Tap>;
}

/**
 * Buttons side by side when there is room, otherwise wrapped onto further lines (one per line on a narrow phone), so labels
 * are never squeezed, broken in the middle of a word or drawn over each other. Every cell has a minimum width of `minItem`;
 * the layout engine moves a cell to the next line when two would not fit, and a lone cell on the last line stretches.
 */
export function ButtonRow({ children, minItem = 136, gap = 10, style }: { children: React.ReactNode; minItem?: number; gap?: number; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean) as React.ReactElement<{ style?: StyleProp<ViewStyle> }>[];
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap }, style]}>
      {items.map((child, i) => {
        // the row decides the size: drop any `flex` the child brought, so nothing fights over the width
        const { flex: _f, flexGrow: _g, flexShrink: _s, flexBasis: _b, ...own } = (StyleSheet.flatten(child.props.style) ?? {}) as ViewStyle;
        return <View key={child.key ?? i} style={{ flexGrow: 1, flexShrink: 1, flexBasis: minItem, minWidth: minItem, maxWidth: '100%' }}>{React.cloneElement(child, { style: own })}</View>;
      })}
    </View>
  );
}

/** Every button in the app has the same fixed height (52, or 40 when `small`) so screens look uniform. */
export const BUTTON_HEIGHT = 52;
export const BUTTON_HEIGHT_SMALL = 40;

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style, small }: { title: string; onPress: () => void; variant?: 'primary' | 'outline' | 'danger' | 'ghost'; loading?: boolean; disabled?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; small?: boolean }) {
  const off = disabled || loading;
  const fg = variant === 'primary' ? colors.white : variant === 'danger' ? colors.red : colors.primary;
  return (
    <Tap accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress} haptic={!off}
      style={[s.btn, small && s.btnSmall, variant === 'primary' && s.btnPrimary, variant === 'outline' && s.btnOutline, variant === 'danger' && s.btnDanger, variant === 'ghost' && s.btnGhost, off && { opacity: 0.5 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[type.button, small && { fontSize: 15, lineHeight: 22 }, { color: fg, flexShrink: 1, textAlign: 'center' }]}>{title}</Text>
        {icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
      </>}
    </Tap>
  );
}

type FieldProps = TextInputProps & { label?: string; error?: string; valid?: boolean; hint?: string };
/** Text field with an animated focus ring, error shake and inline status icon. */
export const TextField = forwardRef<TextInput, FieldProps>(function TextField({ label, error, valid, hint, style, onFocus, onBlur, ...rest }, ref) {
  const f = useSharedValue(0);
  const [errCount, setErrCount] = useState(0);
  useEffect(() => { if (error) setErrCount((c) => c + 1); }, [error]);
  const shake = useShake(errCount);
  const ring = useAnimatedStyle(() => ({
    borderColor: error ? colors.red : interpolateColor(f.value, [0, 1], [valid ? colors.green : colors.border, colors.primary]),
    backgroundColor: interpolateColor(f.value, [0, 1], [colors.white, colors.tint]),
    transform: [{ scale: interpolate(f.value, [0, 1], [1, 1.008]) }],
  }));
  return (
    <Animated.View style={[{ marginBottom: spacing.md }, shake]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Animated.View style={[s.inputWrap, ring]}>
        <TextInput
          ref={ref} placeholderTextColor={colors.muted} {...rest}
          onFocus={(e) => { f.value = withTiming(1, { duration: 180 }); onFocus?.(e); }}
          onBlur={(e) => { f.value = withTiming(0, { duration: 220 }); onBlur?.(e); }}
          style={[s.input, rest.multiline && { minHeight: 84, textAlignVertical: 'top' }, style]}
        />
        {valid && !error ? <Animated.View entering={FadeIn.duration(220)}><Icon name="checkmark-circle" size={22} color={colors.green} /></Animated.View> : null}
        {error ? <Animated.View entering={FadeIn.duration(220)}><Icon name="alert-circle" size={22} color={colors.red} /></Animated.View> : null}
      </Animated.View>
      {error ? <Animated.Text entering={FadeInDown.duration(220)} style={s.error}>{error}</Animated.Text> : hint ? <Text style={s.hint}>{hint}</Text> : null}
    </Animated.View>
  );
});

export const Card = ({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) =>
  onPress ? <Tap accessibilityRole="button" onPress={onPress} scaleTo={0.975} style={[s.card, style]}>{children}</Tap> : <View style={[s.card, style]}>{children}</View>;

const PILL = {
  green: { bg: colors.greenBg, fg: colors.green }, red: { bg: colors.redBg, fg: colors.red },
  amber: { bg: colors.amberBg, fg: colors.amber }, blue: { bg: colors.card, fg: colors.primary },
} as const;
export const Pill = ({ text, tone = 'blue' }: { text: string; tone?: keyof typeof PILL }) =>
  <Animated.View entering={FadeIn.duration(300)} style={{ backgroundColor: PILL[tone].bg, paddingHorizontal: 12, paddingVertical: 3, borderRadius: radius.md, alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%' }}><Text style={[type.smallMedium, { color: PILL[tone].fg, flexShrink: 1 }]}>{text}</Text></Animated.View>;

/** Shown while a page loads: shimmering placeholder blocks instead of a spinner. */
export const Loading = () => <View style={{ flex: 1, padding: spacing.lg, gap: 12 }}><Skeleton h={28} w="55%" r={10} />{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={84} r={16} />)}</View>;

export function Message({ icon = 'information-circle-outline', title, text, actionLabel, onAction }: { icon?: IconName; title: string; text?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <View style={s.center}>
      <Animated.View entering={FadeIn.duration(500)} style={s.msgIconWrap}>
        <Ripples size={96} count={2} />
        <Float amplitude={5} duration={2200}><View style={s.msgIcon}><Icon name={icon} size={36} /></View></Float>
      </Animated.View>
      <Animated.Text entering={FadeInDown.delay(150).duration(420)} style={[type.h3, { color: colors.text, textAlign: 'center' }]}>{title}</Animated.Text>
      {text ? <Animated.Text entering={FadeInDown.delay(250).duration(420)} style={[type.body, { color: colors.secondary, textAlign: 'center', marginTop: 4 }]}>{text}</Animated.Text> : null}
      {actionLabel && onAction ? <Animated.View entering={FadeInDown.delay(350).duration(420)}><Button title={actionLabel} onPress={onAction} variant="outline" style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xxl }} /></Animated.View> : null}
    </View>
  );
}

export const ErrorView = ({ message, onRetry, retryLabel }: { message: string; onRetry: () => void; retryLabel: string }) =>
  <Message icon="cloud-offline-outline" title={message} actionLabel={retryLabel} onAction={onRetry} />;

export const SectionTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) =>
  <View style={s.sectionRow}><Text style={[type.h3, { color: colors.text }]}>{children}</Text>{right}</View>;

/** Animated step indicator shown on the checkout screens: address → time → review. */
export function CheckoutSteps({ step, labels }: { step: 0 | 1 | 2; labels: [string, string, string] }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withSpring(step, { damping: 16, stiffness: 120 }); }, [step, p]);
  const bar = useAnimatedStyle(() => ({ width: `${(p.value / 2) * 100}%` }));
  return (
    <View style={s.stepsWrap}>
      <View style={s.stepsTrack}><Animated.View style={[s.stepsFill, bar]} /></View>
      <View style={s.stepsRow}>
        {labels.map((l, i) => <StepDot key={l} index={i} step={step} label={l} />)}
      </View>
    </View>
  );
}
function StepDot({ index, step, label }: { index: number; step: number; label: string }) {
  const done = index < step, on = index === step;
  const sc = useSharedValue(1);
  useEffect(() => { if (on) { sc.value = withSpring(1.18, { damping: 6, stiffness: 200 }, () => { sc.value = withSpring(1); }); } }, [on, sc]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <View style={s.stepItem}>
      <Animated.View style={[s.stepDot, (done || on) && s.stepDotOn, a]}>{done ? <Icon name="checkmark" size={14} color={colors.white} /> : <Text style={[type.smallMedium, { color: on ? colors.white : colors.muted }]}>{index + 1}</Text>}</Animated.View>
      <Text style={[type.small, { color: on || done ? colors.text : colors.muted }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  footer: { paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  back: { padding: 4, marginLeft: 4 },
  btn: { height: BUTTON_HEIGHT, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: spacing.lg },
  btnSmall: { height: BUTTON_HEIGHT_SMALL, borderRadius: radius.sm, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: colors.primary, boxShadow: '0px 6px 16px rgba(11,95,219,0.28)' },
  btnOutline: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.white },
  btnDanger: { borderWidth: 1.5, borderColor: colors.red, backgroundColor: colors.white },
  btnGhost: { backgroundColor: 'transparent' },
  label: { ...type.smallMedium, color: colors.secondary, marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.lg, gap: 8 },
  input: { ...type.body, flex: 1, color: colors.text, paddingVertical: 10, outlineStyle: 'none' } as object,
  error: { ...type.small, color: colors.red, marginTop: 4 },
  hint: { ...type.small, color: colors.secondary, marginTop: 4 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.lg, padding: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  loadWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  msgIconWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  msgIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  stepsWrap: { marginBottom: spacing.xl },
  stepsTrack: { position: 'absolute', top: 13, left: '8%', right: '8%', height: 3, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  stepsFill: { height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  stepsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stepItem: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
