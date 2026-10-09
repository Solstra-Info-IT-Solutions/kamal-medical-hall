import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Image, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Announcement } from '../api/types';
import { colors, radius, spacing, type } from '../theme';

/** Swipeable banners for announcements that carry pictures. Moves on by itself every few seconds; a tap opens the details. */
export function AnnouncementSlider({ items, onOpen }: { items: Announcement[]; onOpen: (a: Announcement) => void }) {
  const [w, setW] = useState(0);
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  const touching = useRef(false);

  useEffect(() => {
    if (items.length < 2 || !w) return;
    const id = setInterval(() => {
      if (touching.current) return;
      setPage((p) => { const n = (p + 1) % items.length; ref.current?.scrollTo({ x: n * w, animated: false }); return n; });
    }, 5000);
    return () => clearInterval(id);
  }, [items.length, w]);

  if (!items.length) return null;
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => { touching.current = false; if (w) setPage(Math.round(e.nativeEvent.contentOffset.x / w)); };
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={s.wrap}>
      {w > 0 ? (
        <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScrollBeginDrag={() => { touching.current = true; }} onMomentumScrollEnd={onEnd} onScrollEndDrag={onEnd} scrollEventThrottle={32} style={{ width: w }}>
          {items.map((a) => (
            <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.title} onPress={() => onOpen(a)} style={{ width: w }}>
              <View style={[s.slide, { width: w }]}>
                {a.images[0]?.url ? <Image source={{ uri: a.images[0].url }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={a.title} /> : null}
                <LinearGradient colors={['rgba(11,24,52,0)', 'rgba(11,24,52,0.78)']} style={s.shade} />
                <View style={s.caption}>
                  <Text style={[type.h3, { color: colors.white }]} numberOfLines={2}>{a.title}</Text>
                  {a.body ? <Text style={[type.small, { color: 'rgba(255,255,255,0.9)' }]} numberOfLines={2}>{a.body}</Text> : null}
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {items.length > 1 ? <View style={s.dots} pointerEvents="none">{items.map((a, i) => <View key={a.id} style={[s.dot, i === page && s.dotOn]} />)}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card, marginBottom: spacing.lg },
  slide: { aspectRatio: 16 / 9, backgroundColor: colors.card, justifyContent: 'flex-end' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '70%' },
  caption: { padding: spacing.md, paddingBottom: spacing.lg, gap: 2 },
  dots: { position: 'absolute', right: spacing.md, top: spacing.md, flexDirection: 'row', gap: 5, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotOn: { backgroundColor: colors.white },
});
