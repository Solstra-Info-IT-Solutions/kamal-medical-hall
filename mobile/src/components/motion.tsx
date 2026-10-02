import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type TextStyle, Text, type ViewStyle } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, interpolate, LinearTransition, useAnimatedStyle, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '../theme';

export { Animated, FadeIn, FadeInDown, FadeOut, LinearTransition };

/** Small haptic tick; silently ignored where unsupported (web, some emulators). */
export const tick = (kind: 'light' | 'success' | 'error' = 'light') => {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  } catch { /* haptics unavailable */ }
};

/** Staggered fade/slide-up entrance. `index` offsets the delay so lists cascade in. */
export function Enter({ index = 0, children, style, from = 18 }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle>; from?: number }) {
  // The web renderer implements entering animations with CSS and can leave wrappers stuck mid-animation with
  // spring/initial-value variants, so web uses a plain timed fade/slide and native gets the full spring.
  const entering = Platform.OS === 'web'
    ? FadeInDown.delay(Math.min(index, 10) * 70).duration(420)
    : FadeInDown.delay(Math.min(index, 10) * 70).duration(480).springify().damping(18).mass(0.9).withInitialValues({ transform: [{ translateY: from }], opacity: 0 });
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}

/** Pressable that squishes on press with a spring and a light haptic. */
export function Tap({ children, style, scaleTo = 0.965, haptic = true, onPress, ...rest }: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      onPressIn={() => { s.value = withSpring(scaleTo, { damping: 14, stiffness: 320 }); }}
      onPressOut={() => { s.value = withSpring(1, { damping: 11, stiffness: 240 }); }}
      onPress={(e) => { if (haptic) tick(); onPress?.(e); }}
    >
      <Animated.View style={[style, a]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Shimmering placeholder block used instead of spinners while content loads. */
export function Skeleton({ w = '100%', h = 16, r = 8, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, true); }, [p]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.55, 1]) }));
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: colors.card }, a, style]} />;
}

/** Expanding ripple rings behind a hero icon. */
export function Ripples({ size = 160, color = colors.primary, count = 3 }: { size?: number; color?: string; count?: number }) {
  return <>{Array.from({ length: count }, (_, i) => <Ripple key={i} size={size} color={color} delay={i * 700} />)}</>;
}
function Ripple({ size, color, delay }: { size: number; color: string; delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false)); }, [p, delay]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.35, 0]), transform: [{ scale: interpolate(p.value, [0, 1], [0.55, 1.35]) }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, a]} />;
}

/** Gentle endless float used on decorative icons. */
export function Float({ children, amplitude = 8, duration = 2600, delay = 0, rotate = 0, style }: { children: ReactNode; amplitude?: number; duration?: number; delay?: number; rotate?: number; style?: StyleProp<ViewStyle> }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true)); }, [p, duration, delay]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(p.value, [0, 1], [-amplitude, amplitude]) }, { rotate: `${interpolate(p.value, [0, 1], [-rotate, rotate])}deg` }] }));
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}

/** Horizontal shake, triggered whenever `trigger` changes to a new truthy number. */
export function useShake(trigger: number) {
  const x = useSharedValue(0);
  useEffect(() => {
    if (!trigger) return;
    tick('error');
    x.value = withSequence(withTiming(-9, { duration: 55 }), withTiming(9, { duration: 90 }), withTiming(-6, { duration: 80 }), withTiming(6, { duration: 80 }), withTiming(0, { duration: 60 }));
  }, [trigger, x]);
  return useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
}

/** Number that counts up to `value` when it appears. */
export function CountUp({ value, prefix = '', style, duration = 900 }: { value: number; prefix?: string; style?: StyleProp<TextStyle>; duration?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = Date.now();
    let raf: ReturnType<typeof requestAnimationFrame>;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <Text style={style}>{prefix}{shown.toLocaleString('en-IN')}</Text>;
}

/** Soft brand gradient card background (stays inside the existing palette). */
export const SoftGradient = ({ children, style, tone = 'blue' }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'blue' | 'green' | 'amber' }) => {
  const pairs = { blue: [colors.white, colors.card], green: [colors.white, colors.greenBg], amber: [colors.white, colors.amberBg] } as const;
  return <LinearGradient colors={pairs[tone]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ borderRadius: radius.lg }, style]}>{children}</LinearGradient>;
};
