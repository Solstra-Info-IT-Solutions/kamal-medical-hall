import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type TextStyle, Text, View, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

// The app no longer animates anything. These components keep their old names so screens did not need rewriting, but
// they render plain views: no entrance effects, no springs, no looping motion. (`react-native-reanimated` itself is
// replaced by an inert stand-in, see src/noMotion.tsx and metro.config.js.)
export { default as Animated, FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

/** Small haptic tick; silently ignored where unsupported (web, some emulators). */
export const tick = (kind: 'light' | 'success' | 'error' = 'light') => {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  } catch { /* haptics unavailable */ }
};

/** Used to be a staggered entrance; now just a wrapper. */
export function Enter({ children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle>; from?: number }) {
  return <View style={style}>{children}</View>;
}

/** Pressable with a light haptic and a simple pressed state (slightly dimmed). The whole child area is tappable. */
export function Tap({ children, style, haptic = true, onPress, scaleTo: _scaleTo, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean }) {
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
      onPress={(e) => { if (haptic) tick(); onPress?.(e); }}
    >
      {children}
    </Pressable>
  );
}

/** Plain grey placeholder block shown while content loads. */
export function Skeleton({ w = '100%', h = 16, r = 8, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.card }, style]} />;
}

/** Decorative rings were removed with the animations. */
export function Ripples(_p: { size?: number; color?: string; count?: number }) {
  return null;
}

/** Used to float endlessly; now a plain wrapper. */
export function Float({ children, style }: { children: ReactNode; amplitude?: number; duration?: number; delay?: number; rotate?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{children}</View>;
}

/** Used to shake an input on error; now only the error haptic fires. Returns an empty style. */
export function useShake(trigger: number) {
  useEffect(() => { if (trigger) tick('error'); }, [trigger]);
  return {};
}

/** Shows the number straight away (no count-up). */
export function CountUp({ value, prefix = '', style }: { value: number; prefix?: string; style?: StyleProp<TextStyle>; duration?: number }) {
  return <Text style={style}>{prefix}{Math.round(value).toLocaleString('en-IN')}</Text>;
}

/** Soft brand gradient card background (stays inside the existing palette). */
export const SoftGradient = ({ children, style, tone = 'blue' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'blue' | 'green' | 'amber' }) => {
  const pairs = { blue: [colors.white, colors.card], green: [colors.white, colors.greenBg], amber: [colors.white, colors.amberBg] } as const;
  return <LinearGradient colors={pairs[tone]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius.lg }, style]}>{children}</LinearGradient>;
};
