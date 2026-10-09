import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInUp, SlideOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onRealtime } from '../realtime';
import { useSession } from '../store/session';
import { colors, radius, spacing, type } from '../theme';
import { openFromNotification } from '../navigation/ref';
import { Tap, tick } from './motion';
import { Icon } from './ui';

interface Toast { id: string; type?: string; title: string; body: string; orderId: string | null; announcementId?: string | null }

/** Slide-down banner for notifications that arrive over the live socket while the app is open. */
export function NotificationToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const status = useSession((s) => s.status);
  const insets = useSafeAreaInsets();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status !== 'in') return;
    const off = onRealtime('notification', (n: Toast) => {
      tick('success');
      setToast(n);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 5000);
    });
    return () => { off(); clearTimeout(timer.current); };
  }, [status]);

  if (!toast) return null;
  return (
    <Animated.View key={toast.id} entering={SlideInUp.duration(380).springify().damping(15)} exiting={SlideOutUp.duration(250)} style={[s.wrap, { top: insets.top + spacing.sm }]}>
      <Tap accessibilityRole="alert" onPress={() => { setToast(null); openFromNotification(toast); }} scaleTo={0.98} style={s.card}>
        <View style={s.icon}><Icon name="notifications" size={20} color={colors.white} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>{toast.title}</Text>
          <Text style={[type.small, { color: colors.secondary }]} numberOfLines={2}>{toast.body}</Text>
        </View>
        <Tap onPress={() => setToast(null)} hitSlop={10} haptic={false} accessibilityRole="button" accessibilityLabel="Dismiss"><Icon name="close" size={18} color={colors.muted} /></Tap>
      </Tap>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 200 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.cardBorder, boxShadow: '0px 10px 28px rgba(15,33,71,0.22)' },
  icon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
