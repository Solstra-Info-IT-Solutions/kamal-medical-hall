import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { OrderStatus, OrderSummary } from '../api/types';
import { colors, radius, spacing, type } from '../theme';
import { formatDate, formatMoney, statusTone } from '../utils';
import { Enter, Ripples, Tap } from './motion';
import { Icon, Pill, type IconName } from './ui';

const STAGE: Record<OrderStatus, number> = { requested: 0, quoted: 1, awaiting_payment: 1, accepted: 2, ready_to_dispatch: 2, out_for_delivery: 3, delivered: 4, rejected: -1, cancelled: -1 };
const ICON: Record<OrderStatus, IconName> = { requested: 'time', quoted: 'pricetag', awaiting_payment: 'card', accepted: 'checkmark-circle', ready_to_dispatch: 'cube', out_for_delivery: 'bicycle', delivered: 'checkmark-done-circle', rejected: 'close-circle', cancelled: 'ban' };
const TONE = { green: [colors.green, colors.greenBg], red: [colors.red, colors.redBg], amber: [colors.amber, colors.amberBg], blue: [colors.primary, colors.card] } as const;
const TRACK_KEY: Record<number, string> = { 0: 'requested', 1: 'quoted', 2: 'ready_to_dispatch', 3: 'out_for_delivery', 4: 'delivered' };
/** Statuses where the customer should look at the order (shows a pulsing ring). */
const ATTENTION: OrderStatus[] = ['quoted', 'awaiting_payment', 'out_for_delivery'];

function Segment({ filled, index }: { filled: boolean; index: number }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(280 + index * 110, withTiming(filled ? 1 : 0, { duration: 500, easing: Easing.out(Easing.cubic) })); }, [filled, index, p]);
  const a = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return <View style={s.segTrack}><Animated.View style={[s.segFill, a]} /></View>;
}

export function OrderCard({ order, index = 0, onPress, subtitle }: { order: OrderSummary; index?: number; onPress: () => void; subtitle?: string }) {
  const { t } = useTranslation();
  const compact = useWindowDimensions().width < 360; // small phones: smaller icon, tighter padding, text may wrap
  const tone = statusTone(order.status);
  const [fg, bg] = TONE[tone];
  const stage = STAGE[order.status];
  const attention = ATTENTION.includes(order.status);
  const line = subtitle ?? (order.summary || (order.fileCount ? t('admin.rxFiles', { count: order.fileCount }) : ''));
  return (
    <Enter index={index}>
      <Tap accessibilityRole="button" accessibilityLabel={`#${order.orderNumber}`} onPress={onPress} scaleTo={0.97} style={s.shadow}>
        <LinearGradient colors={[colors.white, colors.tint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.card, compact && s.cardCompact]}>
          <View style={[s.accent, { backgroundColor: fg }]} />
          <View style={s.top}>
            <View style={[s.iconBox, compact && s.iconBoxCompact, { backgroundColor: bg }]}>
              {attention ? <Ripples size={48} color={fg} count={2} /> : null}
              <Icon name={ICON[order.status]} size={26} color={fg} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.titleRow}>
                <Text style={[type.h3, { color: colors.text, flexShrink: 1 }]}>#{order.orderNumber}</Text>
                <Pill text={t(`status.${order.status}`)} tone={tone} />
              </View>
              {line ? <Text style={[type.small, { color: colors.secondary }]} numberOfLines={2}>{line}</Text> : null}
              <View style={s.meta}>
                <Icon name={order.kind === 'prescription' ? 'document-text-outline' : 'medkit-outline'} size={14} color={colors.muted} />
                <Text style={[type.small, { color: colors.muted }]}>{formatDate(order.createdAt)}</Text>
                {order.quotedAmount !== null ? <Text style={[type.smallMedium, { color: colors.text, marginLeft: 'auto' }]}>{formatMoney(order.quotedAmount)}</Text> : null}
              </View>
            </View>
            {compact ? null : <Icon name="chevron-forward" size={20} color={colors.muted} />}
          </View>
          {stage >= 0 ? <>
            <View style={s.track}>{[0, 1, 2, 3, 4].map((i) => <Segment key={i} index={i} filled={stage >= i} />)}</View>
            <Text style={[type.small, { color: fg }]}>{t(`track.${TRACK_KEY[stage]}`)}</Text>
          </> : null}
        </LinearGradient>
      </Tap>
    </Enter>
  );
}

const s = StyleSheet.create({
  shadow: { marginBottom: spacing.md, borderRadius: radius.lg, boxShadow: '0px 6px 18px rgba(15,33,71,0.09)' },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, padding: spacing.md, paddingLeft: spacing.lg, overflow: 'hidden', gap: 10 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 5, rowGap: 2, marginTop: 2 },
  cardCompact: { padding: spacing.sm, paddingLeft: spacing.md },
  iconBoxCompact: { width: 40, height: 40 },
  track: { flexDirection: 'row', gap: 5 },
  segTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  segFill: { height: 5, borderRadius: 3, backgroundColor: colors.primary },
});
