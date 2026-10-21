import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors } from '../theme';
import { tick } from './motion';

const W = 52, H = 30, PAD = 3, KNOB = H - PAD * 2;

/**
 * The app's on/off switch in KMH colours (blue when on, soft grey-blue when off, white knob), the same on Android,
 * iOS and the web. Drop-in for React Native's Switch: `value` + `onValueChange`.
 */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; accessibilityLabel?: string }) {
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => { on.value = withSpring(value ? 1 : 0, { damping: 16, stiffness: 240 }); }, [value, on]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], ['#C3D3E8', colors.primary]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: on.value * (W - KNOB - PAD * 2) }] }));
  return (
    <Pressable
      accessibilityRole="switch" accessibilityState={{ checked: value, disabled: !!disabled }} accessibilityLabel={accessibilityLabel}
      disabled={disabled} hitSlop={8} onPress={() => { tick('light'); onValueChange(!value); }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }]}
    >
      <Animated.View style={[s.track, track]}>
        <Animated.View style={[s.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: PAD, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.white, boxShadow: '0px 2px 4px rgba(15,33,71,0.25)' },
});
