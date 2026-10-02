import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { OrderCard } from '../../components/OrderCard';
import { Enter } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading, Screen } from '../../components/ui';
import { confirmAsync } from '../../dialog';
import { useLoad } from '../../hooks';
import type { PartnerStackParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, spacing, type } from '../../theme';
import { formatDate, formatMoney } from '../../utils';

type Nav = NativeStackNavigationProp<PartnerStackParamList>;

export function PartnerHomeScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const logout = useSession((st) => st.logout);
  const me = useLoad(() => endpoints.partner.me());
  const jobs = useLoad(() => endpoints.partner.orders('active'));
  const history = useLoad(() => endpoints.partner.orders('history'));
  const [err, setErr] = useState('');
  const toggle = async (v: boolean) => {
    setErr('');
    try { await endpoints.partner.setAvailable(v); await me.reload(); } catch (e) { setErr((e as Error).message); await me.reload(); }
  };
  if (me.loading && !me.data) return <Loading />;
  if (me.error && !me.data) return <ErrorView message={me.error} onRetry={me.reload} retryLabel={t('common.retry')} />;
  const refresh = () => { void me.reload(); void jobs.reload(); void history.reload(); };
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Text style={[type.h2, s.heading]}>{t('partner.title')}</Text>
      <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={jobs.loading} onRefresh={refresh} />}>
        <Enter><Card style={s.avail}>
          <View style={{ flex: 1 }}><Text style={[type.h3, { color: colors.text }]}>{me.data!.isAvailable ? t('partner.available') : t('partner.busy')}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('partner.availableHelp')}</Text></View>
          <Switch accessibilityLabel={t('partner.available')} value={me.data!.isAvailable} onValueChange={toggle} />
        </Card></Enter>
        {err ? <Text style={[type.small, { color: colors.red, marginTop: 6 }]}>{err}</Text> : null}
        <Text style={[type.h3, s.sec]}>{t('partner.assigned')}</Text>
        {jobs.data && !jobs.data.orders.length ? <Text style={[type.body, { color: colors.secondary }]}>{t('partner.noJobs')}</Text> : null}
        {jobs.data?.orders.map((o, i) => <OrderCard key={o.id} order={o} index={i} onPress={() => nav.navigate('Job', { orderId: o.id })} subtitle={`${o.customerName ?? ''} · ${o.deliverySlot ?? ''}`} />)}
        {history.data?.orders.length ? <>
          <Text style={[type.h3, s.sec]}>{t('partner.history')}</Text>
          {history.data.orders.slice(0, 10).map((o) => <Text key={o.id} style={[type.body, { color: colors.secondary }]}>#{o.orderNumber} · {o.customerName}{o.paymentMethod === 'cod' && o.quotedAmount !== null ? ` · ${t('pay.cod')} ${formatMoney(o.quotedAmount)}` : ''}</Text>)}
        </> : null}
        <Button title={t('profile.language')} variant="outline" icon="language" onPress={() => nav.navigate('Language')} style={{ marginTop: spacing.xl }} />
        <Button title={t('profile.logout')} variant="ghost" onPress={() => void logout()} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function JobScreen({ navigation, route }: NativeStackScreenProps<PartnerStackParamList, 'Job'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId));
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
  avail: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: 6 },
  job: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md, backgroundColor: colors.white },
  actions: { flexDirection: 'row', gap: 12, marginTop: spacing.lg },
});
void Icon;
