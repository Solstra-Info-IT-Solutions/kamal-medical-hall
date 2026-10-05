/**
 * Inert stand-in for `react-native-reanimated`.
 *
 * The app's animations were removed (they made touch targets drift and caused other problems). Rather than rewrite
 * every screen at once, metro.config.js points all `react-native-reanimated` imports here. Everything renders as the
 * plain React Native component, `entering` / `exiting` / `layout` props are ignored, and "animated" values jump straight
 * to their final value, so nothing moves.
 */
import { forwardRef, useRef, useState, type ComponentType } from 'react';
import { FlatList, Image, ScrollView, Text, View } from 'react-native';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProps = Record<string, any>;

function plain(Component: ComponentType<any>) {
  return forwardRef<unknown, AnyProps>(function Plain({ entering, exiting, layout, animatedProps, ...rest }, ref) {
    void entering; void exiting; void layout;
    return <Component ref={ref} {...rest} {...(animatedProps ?? {})} />;
  });
}

// ---- layout animation presets: chainable no-ops, so `FadeInDown.delay(100).springify()` still evaluates
const chain = (): any => new Proxy(function noop() { /* preset */ }, { get: () => () => chain(), apply: () => chain() });
export const FadeIn = chain(), FadeInDown = chain(), FadeInUp = chain(), FadeInLeft = chain(), FadeInRight = chain();
export const FadeOut = chain(), FadeOutDown = chain(), FadeOutUp = chain(), FadeOutLeft = chain(), FadeOutRight = chain();
export const ZoomIn = chain(), ZoomOut = chain(), SlideInDown = chain(), SlideInUp = chain(), SlideInLeft = chain(), SlideInRight = chain();
export const SlideOutDown = chain(), SlideOutUp = chain(), SlideOutLeft = chain(), SlideOutRight = chain();
export const LinearTransition = chain(), Layout = chain(), FadingTransition = chain();

// ---- values
export function useSharedValue<T>(initial: T) {
  const [, rerender] = useState(0);
  const ref = useRef<{ value: T } | null>(null);
  if (!ref.current) {
    let current = initial;
    ref.current = {
      get value() { return current; },
      set value(next: T) { if (next !== current) { current = next; rerender((n) => n + 1); } },
    };
  }
  return ref.current;
}
export const useAnimatedStyle = (fn: () => AnyProps) => fn();
export const useAnimatedProps = (fn: () => AnyProps) => fn();
export const useDerivedValue = <T,>(fn: () => T) => ({ value: fn() });

const done = (cb?: (finished?: boolean) => void) => { try { cb?.(true); } catch { /* ignore */ } };
export const withTiming = <T,>(to: T, _cfg?: unknown, cb?: (f?: boolean) => void) => { done(cb); return to; };
export const withSpring = <T,>(to: T, _cfg?: unknown, cb?: (f?: boolean) => void) => { done(cb); return to; };
export const withDelay = <T,>(_ms: number, v: T) => v;
export const withRepeat = <T,>(v: T) => v;
export const withSequence = <T,>(...vs: T[]) => vs[vs.length - 1] as T;
export const withDecay = () => 0;
export const cancelAnimation = () => undefined;
export const runOnJS = <F extends (...a: any[]) => any>(fn: F) => fn;
export const runOnUI = <F extends (...a: any[]) => any>(fn: F) => fn;
export const useReducedMotion = () => true;

export const Easing: any = new Proxy({}, { get: () => (...a: any[]) => (typeof a[0] === 'function' ? a[0] : (t: number) => t) });
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' } as const;

export function interpolate(x: number, input: number[], output: number[]) {
  if (x <= input[0]) return output[0];
  const last = input.length - 1;
  if (x >= input[last]) return output[last];
  for (let i = 0; i < last; i++) {
    if (x >= input[i] && x <= input[i + 1]) {
      const t = (x - input[i]) / (input[i + 1] - input[i] || 1);
      return output[i] + t * (output[i + 1] - output[i]);
    }
  }
  return output[last];
}
export function interpolateColor(x: number, input: number[], output: string[]) {
  let best = 0;
  for (let i = 0; i < input.length; i++) if (Math.abs(x - input[i]) < Math.abs(x - input[best])) best = i;
  return output[best];
}

// ---- components
const AnimatedView = plain(View), AnimatedText = plain(Text), AnimatedImage = plain(Image);
const AnimatedScrollView = plain(ScrollView), AnimatedFlatList = plain(FlatList as ComponentType<any>);
const createAnimatedComponent = (Component: ComponentType<any>) => plain(Component);

const Animated = {
  View: AnimatedView, Text: AnimatedText, Image: AnimatedImage, ScrollView: AnimatedScrollView, FlatList: AnimatedFlatList,
  createAnimatedComponent,
};
export { AnimatedView as View, AnimatedText as Text, AnimatedImage as Image, AnimatedScrollView as ScrollView, AnimatedFlatList as FlatList, createAnimatedComponent };
export default Animated;
