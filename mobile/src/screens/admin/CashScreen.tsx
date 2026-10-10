import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import type { ClosingSummary } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { Skeleton, tick } from '../../components/motion';
import { ButtonRow, Button, Card, ErrorView, Icon, Message, Screen } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import { colors, spacing, type } from '../../theme';
import { formatDateTime, formatMoney } from '../../utils';

/** Today's revenue and the cash each delivery partner still has to hand in; the admin ticks it off as it is received. */
export function CashScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useLoad<ClosingSummary>(() => endpoints.admin.closingSummary(), ['order:update', 'cash:update', 'notification']);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  if (loading && !data) return <View style={{ padding: spacing.lg, gap: 12 }}><Skeleton h={130} r={24} /><Skeleton h={110} r={16} /><Skeleton h={110} r={16} /></View>;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const d = data!;

  const settle = async (partnerId: string, name: string, total: number, count: number, orderIds?: string[], orderNumber?: string) => {
    const ok = await showDialog({ title: t('cash.confirmTitle', { name }), message: orderIds ? t('cash.confirmOne', { amount: formatMoney(total), order: `#${orderNumber}` }) : t('cash.confirmAll', { amount: formatMoney(total), name, count }), icon: 'cash', confirmLabel: t('cash.markReceived'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    setBusy(`${partnerId}${orderIds?.[0] ?? ''}`); setErr('');
    try { const r = await endpoints.admin.settleCash(partnerId, orderIds); setData({ ...d, cash: { total: r.total, partners: r.partners } }); tick('success'); void reload(); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };

  return (
    <Screen wide>
      <LinearGradient colors={[colors.navy, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <Text style={[type.small, { color: 'rgba(255,255,255,0.8)' }]}>{t('cash.revenueToday')} · {t('cash.ordersCount', { count: d.revenue.orders })}</Text>
        <Text style={[type.h1, { color: colors.white, fontSize: 38, lineHeight: 48 }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(d.revenue.total)}</Text>
        <View style={s.heroRow}>
          <View style={s.heroStat}><Text style={s.heroNum}>{formatMoney(d.revenue.online)}</Text><Text style={s.heroLabel}>{t('cash.online')}</Text></View>
          <View style={s.heroDivider} />
          <View style={s.heroStat}><Text style={s.heroNum}>{formatMoney(d.revenue.cod)}</Text><Text style={s.heroLabel}>{t('cash.onDelivery')}</Text></View>
          <View style={s.heroDivider} />
          <View style={s.heroStat}><Text style={[s.heroNum, d.cash.total > 0 && { color: '#FFD27A' }]}>{formatMoney(d.cash.total)}</Text><Text style={s.heroLabel}>{t('cash.totalLabel')}</Text></View>
        </View>
      </LinearGradient>

      {d.cash.partners.length === 0 ? <View style={{ marginTop: spacing.lg }}><Message icon="checkmark-circle-outline" title={t('cash.title')} text={t('cash.nothing')} /></View> : d.cash.partners.map((p) => (
        <Card key={p.partnerId} style={s.card}>
          <View style={s.head}>
            <Avatar name={p.name} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={[type.small, { color: colors.secondary }]}>{t('cash.staffShort')}</Text>
              <Text style={[type.h3, { color: colors.text }]} numberOfLines={2}>{p.name}</Text>
            </View>
            <CallButton phone={p.phone} compact label={t('admin.callPartner')} />
            <Text style={[type.h2, { color: colors.amber }]}>{formatMoney(p.total)}</Text>
          </View>
          {p.orders.map((o) => (
            <View key={o.orderId} style={s.orderRow}>
              <Icon name="receipt-outline" size={18} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>#{o.orderNumber}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.collectedAt)}</Text>
              </View>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{formatMoney(o.amount)}</Text>
              <Button small variant="outline" title={t('cash.done')} icon="checkmark" loading={busy === `${p.partnerId}${o.orderId}`} disabled={!!busy} onPress={() => settle(p.partnerId, p.name, o.amount, 1, [o.orderId], o.orderNumber)} />
            </View>
          ))}
          <ButtonRow>
            <View style={{ flex: 2 }}><Button title={t('cash.markAll', { amount: formatMoney(p.total) })} icon="checkmark-done" loading={busy === p.partnerId} disabled={!!busy} onPress={() => settle(p.partnerId, p.name, p.total, p.orders.length)} /></View>
          </ButtonRow>
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { marginTop: spacing.md, borderRadius: 24, padding: spacing.lg, gap: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)' },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroNum: { ...type.bodyMedium, color: colors.white, fontSize: 16 },
  heroLabel: { ...type.small, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  heroDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.25)' },
  card: { marginTop: spacing.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: spacing.sm },
});
