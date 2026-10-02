import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { colors, fonts } from '../theme';
import { Ripples } from './motion';

const logo = require('../../assets/logo.png');

function Dot({ delay }: { delay: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0, { duration: 380 })), -1)); }, [p, delay]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.25, 1]), transform: [{ translateY: interpolate(p.value, [0, 1], [0, -6]) }] }));
  return <Animated.View style={[s.dot, a]} />;
}

/** Full-screen brand intro shown while fonts, language and the saved session load. */
export function AnimatedSplash({ tagline }: { tagline: string }) {
  const scale = useSharedValue(0.4);
  const rot = useSharedValue(-8);
  const glow = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 9, stiffness: 90, mass: 0.9 });
    rot.value = withSpring(0, { damping: 8, stiffness: 70 });
    glow.value = withDelay(500, withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [scale, rot, glow]);
  const logoStyle = useAnimatedStyle(() => ({ opacity: interpolate(scale.value, [0.4, 0.8], [0, 1], 'clamp'), transform: [{ scale: scale.value * interpolate(glow.value, [0, 1], [1, 1.035]) }, { rotate: `${rot.value}deg` }] }));
  return (
    <Animated.View exiting={FadeOut.duration(500)} style={s.root} pointerEvents="none">
      <View style={s.center}>
        <View style={s.rippleBox}><Ripples size={240} count={3} /></View>
        <Animated.View style={logoStyle}><Image source={logo} style={s.logo} resizeMode="contain" accessibilityLabel="Kamal Medical Hall" /></Animated.View>
        <Animated.View entering={FadeInDown.delay(750).duration(600).springify().damping(16)}><Text style={s.tagline}>{tagline}</Text></Animated.View>
      </View>
      <Animated.View entering={FadeIn.delay(1000).duration(400)} style={s.dots}><Dot delay={0} /><Dot delay={160} /><Dot delay={320} /></Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  center: { alignItems: 'center', justifyContent: 'center' },
  rippleBox: { position: 'absolute', width: 240, height: 240, alignItems: 'center', justifyContent: 'center', top: -10 },
  logo: { width: 250, height: 250 },
  tagline: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.primaryDark, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  dots: { position: 'absolute', bottom: 70, flexDirection: 'row', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
});
