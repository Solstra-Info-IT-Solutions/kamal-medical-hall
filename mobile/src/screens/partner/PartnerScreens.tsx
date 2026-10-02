import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { OrderCard } from '../../components/OrderCard';
import { Avatar } from '../../components/CallButton';
import { CountUp, Enter, Tap, tick } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading, Screen } from '../../components/ui';
import { confirmAsync, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import type { PartnerStackParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatMoney } from '../../utils';

type Nav = NativeStackNavigationProp<PartnerStackParamList>;

export function PartnerHomeScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  const me = useLoad(() => endpoints.partner.me(), ['partner:update', 'order:update', 'notification']);
  const jobs = useLoad(() => endpoints.partner.orders('active'), ['order:update', 'notification']);
  const history = useLoad(() => endpoints.partner.orders('history'), ['order:update']);
  const [err, setErr] = useState('');
  const toggle = async (v: boolean) => {
    setErr('');
    try { await endpoints.partner.setAvailable(v); tick(); await me.reload(); } catch (e) { setErr((e as Error).message); tick('error'); await me.reload(); }
  };
  const signOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) await logout();
  };
  if (me.loading && !me.data) return <Loading />;
  if (me.error && !me.data) return <ErrorView message={me.error} onRetry={me.reload} retryLabel={t('common.retry')} />;
  const refresh = () => { void me.reload(); void jobs.reload(); void history.reload(); };
  const available = me.data!.isAvailable;
  const active = jobs.data?.orders ?? [];
  const cashToCollect = active.filter((o) => o.paymentMethod === 'cod').reduce((sum, o) => sum + (o.quotedAmount ?? 0), 0);
  const hasJob = active.length > 0;
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
        <Enter index={0}>
          <View style={s.greet}>
            <Avatar name={user?.name} size={48} />
            <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('partner.title')}</Text><Text style={[type.h2, { color: colors.text }]}>{t('home.greetingName', { name: (user?.name ?? '').split(' ')[0] })}</Text></View>
          </View>
        </Enter>

        <Enter index={1}>
          <LinearGradient colors={available ? [colors.white, colors.greenBg] : [colors.white, colors.amberBg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avail}>
            <View style={[s.availIcon, { backgroundColor: available ? colors.green : colors.amber }]}><Icon name={available ? 'bicycle' : 'pause'} size={26} color={colors.white} /></View>
            <View style={{ flex: 1 }}>
              <Text style={[type.h3, { color: colors.text }]}>{available ? t('partner.available') : t('partner.busy')}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{hasJob ? t('partner.finishFirst') : t('partner.availableHelp')}</Text>
            </View>
            <Switch accessibilityLabel={t('partner.available')} value={available} onValueChange={toggle} disabled={hasJob && !available} />
          </LinearGradient>
          {err ? <Text style={[type.small, { color: colors.red, marginTop: 6 }]}>{err}</Text> : null}
        </Enter>

        <Enter index={2}>
          <View style={s.stats}>
            <View style={s.stat}><CountUp value={active.length} style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.assigned')}</Text></View>
            <View style={s.stat}><CountUp value={history.data?.orders.length ?? 0} style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.delivered')}</Text></View>
            <View style={s.stat}><CountUp value={cashToCollect} prefix="₹" style={[type.h2, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{t('partner.cashToCollect')}</Text></View>
          </View>
        </Enter>

        <Enter index={3}><Text style={[type.h3, s.sec]}>{t('partner.assigned')}</Text></Enter>
        {jobs.data && !active.length ? <Enter index={4}><Card style={s.empty}><Icon name="cube-outline" size={30} color={colors.muted} /><Text style={[type.body, { color: colors.secondary, flex: 1 }]}>{t('partner.noJobs')}</Text></Card></Enter> : null}
        {active.map((o, i) => <OrderCard key={o.id} order={o} index={i + 4} onPress={() => nav.navigate('Job', { orderId: o.id })} subtitle={`${o.customerName ?? ''} · ${o.deliverySlot ?? ''}`} />)}

        {history.data?.orders.length ? <>
          <Enter index={6}><Text style={[type.h3, s.sec]}>{t('partner.history')}</Text></Enter>
          {history.data.orders.slice(0, 8).map((o, i) => (
            <Enter key={o.id} index={7 + i}>
              <View style={s.histRow}>
                <View style={s.histIcon}><Icon name="checkmark" size={16} color={colors.green} /></View>
                <Text style={[type.body, { color: colors.text, flex: 1 }]}>#{o.orderNumber} · {o.customerName}</Text>
                {o.paymentMethod === 'cod' && o.quotedAmount !== null ? <Text style={[type.smallMedium, { color: colors.secondary }]}>{formatMoney(o.quotedAmount)}</Text> : null}
              </View>
            </Enter>
          ))}
        </> : null}

        <Enter index={9}>
          <Tap accessibilityRole="button" onPress={() => nav.navigate('Language')} scaleTo={0.98} style={s.menuRow}><View style={s.menuIcon}><Icon name="language-outline" size={22} color={colors.navy} /></View><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{t('profile.language')}</Text><Icon name="chevron-forward" size={20} color={colors.muted} /></Tap>
          <Tap accessibilityRole="button" onPress={signOut} scaleTo={0.98} style={s.menuRow}><View style={[s.menuIcon, { backgroundColor: colors.redBg }]}><Icon name="log-out-outline" size={22} color={colors.red} /></View><Text style={[type.bodyMedium, { color: colors.red, flex: 1 }]}>{t('profile.logout')}</Text></Tap>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}

export function JobScreen({ navigation, route }: NativeStackScreenProps<PartnerStackParamList, 'Job'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o = data!.order;
  const cod = o.paymentMethod === 'cod';
  const a = o.address;
  const query = encodeURIComponent([a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', '));
  const mapUrl = a.latitude != null && a.longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}` : `https://www.google.com/maps/search/?api=1&query=${query}`;

  const run = async (fn: () => Promise<{ order: typeof o }>) => {
    setBusy(true); setErr('');
    try { const r = await fn(); setData({ order: r.order }); if (r.order.status === 'delivered') navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const delivered = async () => {
    if (cod && !(await confirmAsync(t('partner.collectTitle'), t('partner.collectMsg', { amount: formatMoney(o.quotedAmount ?? 0) }), t('partner.collected'), t('common.cancel')))) return;
    await run(() => endpoints.partner.delivered(o.id, cod));
  };
  return (
    <Screen footer={o.status === 'ready_to_dispatch' ? <Button title={t('partner.outForDelivery')} loading={busy} onPress={() => run(() => endpoints.partner.outForDelivery(o.id))} /> : o.status === 'out_for_delivery' ? <Button title={t('partner.markDelivered')} loading={busy} onPress={delivered} /> : undefined}>
      <Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text>
      <Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{o.customer?.name}</Text>
      <Text style={[type.body, { color: colors.secondary }]}>{[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}, {a.city} - {a.pincode}</Text>
      <Text style={[type.small, { color: colors.secondary }]}>{formatDate(o.deliveryDate)} · {o.deliverySlot}</Text>
      <View style={s.actions}>
        <Button title={t('partner.call')} icon="call" onPress={() => Linking.openURL(`tel:${a.phone || o.customer?.phone}`)} style={{ flex: 1 }} />
        <Button title={t('partner.map')} icon="navigate" variant="outline" onPress={() => Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${query}` : mapUrl)} style={{ flex: 1 }} />
      </View>
      <Card style={{ marginTop: spacing.xl }}>
        <Text style={[type.h3, { color: colors.text }]}>{cod ? t('partner.collectCash') : t('partner.prepaid')}</Text>
        {cod ? <Text style={[type.h1, { color: colors.text }]}>{formatMoney(o.quotedAmount ?? 0)}</Text> : <Text style={[type.body, { color: colors.secondary }]}>{t('partner.noCash')}</Text>}
      </Card>
      <Text style={[type.h3, s.sec]}>{t('order.items')}</Text>
      {o.items.length ? o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>) : <Text style={[type.body, { color: colors.secondary }]}>{t('partner.packed')}</Text>}
      {err ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  pad: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  avail: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder },
  stats: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: 6 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md, backgroundColor: colors.white },
  actions: { flexDirection: 'row', gap: 12, marginTop: spacing.lg },
  greet: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg },
  availIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  histIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.greenBg, alignItems: 'center', justifyContent: 'center' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  menuIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
void Icon;
