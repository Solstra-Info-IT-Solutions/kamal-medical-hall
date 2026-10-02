import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { OrderSummary } from '../../api/types';
import { OrderCard } from '../../components/OrderCard';
import { CountUp, Enter, Skeleton, Tap } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading, Message, Pill, Screen, TextField, type IconName } from '../../components/ui';
import { confirmAsync } from '../../dialog';
import { useLoad } from '../../hooks';
import type { AdminStackParamList, AdminTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
const Header = ({ title }: { title: string }) => <Text style={[type.h2, s.heading]}>{title}</Text>;

function OrderRow({ o, onPress, index = 0 }: { o: OrderSummary; onPress: () => void; index?: number }) {
  return <OrderCard order={o} index={index} onPress={onPress} subtitle={`${o.customerName ?? o.customerPhone ?? ''}${o.summary ? ' · ' + o.summary : ''}`} />;
}

export function DashboardScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Dashboard'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.dashboard());
  let tileIndex = 0;
  const tile = (icon: IconName, label: string, value: number, money = false) => (
    <Enter index={tileIndex++} style={s.tile}><Card style={{ gap: 4 }}><Icon name={icon} size={26} /><CountUp value={value} prefix={money ? '₹' : ''} style={[type.h1, { color: colors.text }]} /><Text style={[type.small, { color: colors.secondary }]}>{label}</Text></Card></Enter>
  );
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.dashboard')} />
      {loading && !data ? <View style={{ padding: spacing.lg, gap: 12 }}><Skeleton h={96} r={16} /><Skeleton h={96} r={16} /><Skeleton h={96} r={16} /></View> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : (
        <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
          <View style={s.grid}>
            {tile('mail-unread', t('admin.newRequests'), data!.requested)}
            {tile('hourglass', t('admin.awaiting'), data!.awaitingPayment)}
            {tile('cube', t('admin.ready'), data!.readyToDispatch)}
            {tile('bicycle', t('admin.outForDelivery'), data!.outForDelivery)}
            {tile('checkmark-done', t('admin.deliveredToday'), data!.deliveredToday)}
            {tile('cash', t('admin.salesToday'), data!.salesToday, true)}
          </View>
          <Button title={t('admin.openRequests')} onPress={() => nav.navigate('Tabs', { screen: 'Requests' })} style={{ marginTop: spacing.lg }} />
        </ScrollView>)}
    </SafeAreaView>
  );
}

function OrderList({ status, title, search }: { status?: string; title: string; search?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(id); }, [q]);
  const [filter, setFilter] = useState<string | undefined>(status);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.orders(filter, term || undefined));
  useEffect(() => { void reload(); }, [filter, term, reload]);
  const filters = [undefined, 'requested', 'quoted,awaiting_payment', 'ready_to_dispatch', 'out_for_delivery', 'delivered', 'cancelled,rejected'];
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={title} />
      {search ? <>
        <View style={s.search}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('admin.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.search')} style={[type.body, { flex: 1, color: colors.text }]} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
          {filters.map((f) => <Pressable key={f ?? 'all'} accessibilityRole="button" onPress={() => setFilter(f)} style={[s.chip, filter === f && s.chipOn]}><Text style={[type.smallMedium, { color: filter === f ? colors.white : colors.navy }]}>{f ? t(`status.${f.split(',')[0]}`) : t('admin.all')}</Text></Pressable>)}
        </ScrollView></> : null}
      {loading && !data ? <Loading /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? <Message icon="file-tray-outline" title={t('admin.noOrders')} /> : (
        <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
          {data.orders.map((o, i) => <OrderRow key={o.id} o={o} index={i} onPress={() => nav.navigate('OrderReview', { orderId: o.id })} />)}
        </ScrollView>)}
    </SafeAreaView>
  );
}
export const RequestsScreen = () => { const { t } = useTranslation(); return <OrderList status="requested" title={t('admin.newRequests')} />; };
export const AllOrdersScreen = () => { const { t } = useTranslation(); return <OrderList title={t('admin.allOrders')} search />; };

export function OrderReviewScreen({ route }: NativeStackScreenProps<AdminStackParamList, 'OrderReview'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId));
  const partners = useLoad(() => endpoints.admin.partners());
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o = data!.order;
  const run = async (fn: () => Promise<{ order: typeof o }>) => {
    setBusy(true); setErr('');
    try { const r = await fn(); setData({ order: r.order }); setReason(''); void partners.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const available = partners.data?.partners.filter((p) => p.isAvailable && p.active) ?? [];
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);
  const quoteValue = Number(amount);

  return (
    <Screen>
      <View style={s.rowBetween}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} /></View>
      <Text style={[type.body, { color: colors.text }]}>{o.customer?.name} · {o.customer?.phone}</Text>
      <Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.createdAt)} · {formatDate(o.deliveryDate)} {o.deliverySlot}</Text>
      <Text style={[type.small, { color: colors.secondary }]}>{[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, {o.address.city} - {o.address.pincode}</Text>

      <Text style={[type.h3, s.sec]}>{o.kind === 'prescription' ? t('admin.prescriptions') : t('order.items')}</Text>
      {o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>)}
      <View style={s.rxRow}>{o.prescriptions.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" onPress={() => p.url && Linking.openURL(p.url)} style={s.rx}>
          {p.mimeType === 'application/pdf' || !p.url ? <Icon name="document-text" size={30} /> : <Image source={{ uri: p.url }} style={{ flex: 1, borderRadius: radius.sm }} />}
        </Pressable>))}</View>
      {o.note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {o.note}</Text> : null}
      {o.quotedAmount !== null ? <Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{t('order.amount')}: {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)} (${o.paymentStatus})` : ''}</Text> : null}
      {o.rejectionReason || o.cancelReason ? <Text style={[type.body, { color: colors.red, marginTop: spacing.sm }]}>{o.rejectionReason ?? o.cancelReason}</Text> : null}
      {o.partner ? <Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]}>{t('admin.partner')}: {o.partner.name} {o.partner.phone ? `· ${o.partner.phone}` : ''}</Text> : null}

      {o.status === 'requested' || o.status === 'quoted' ? <>
        <Text style={[type.h3, s.sec]}>{o.status === 'quoted' ? t('admin.requote') : t('admin.setQuote')}</Text>
        <TextField label={t('admin.amountLabel')} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
        <Button title={t('admin.sendQuote')} disabled={!(quoteValue > 0)} loading={busy} onPress={() => run(() => endpoints.admin.quote(o.id, quoteValue))} />
      </> : null}
      {o.status === 'requested' ? <>
        <TextField label={t('admin.rejectReason')} value={reason} onChangeText={setReason} style={{ marginTop: spacing.lg }} />
        <Button title={t('admin.reject')} variant="danger" disabled={reason.trim().length < 3} loading={busy} onPress={() => run(() => endpoints.admin.reject(o.id, reason.trim()))} />
      </> : null}
      {o.status === 'awaiting_payment' ? <Card style={{ marginTop: spacing.lg }}><Text style={[type.body, { color: colors.text }]}>{t('admin.awaitingRazorpay')}</Text></Card> : null}
      {o.status === 'ready_to_dispatch' && !o.partner ? <>
        <Text style={[type.h3, s.sec]}>{t('admin.assign')}</Text>
        {!available.length ? <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noPartners')}</Text> : null}
        {available.map((p) => <Button key={p.id} title={`${p.name} · ${p.phone}`} variant="outline" loading={busy} onPress={() => run(() => endpoints.admin.assign(o.id, p.id))} style={{ marginBottom: spacing.sm }} />)}
      </> : null}
      {canCancel && o.status !== 'requested' ? <>
        <TextField label={t('admin.cancelReason')} value={reason} onChangeText={setReason} style={{ marginTop: spacing.lg }} />
        <Button title={t('admin.cancelOrder')} variant="danger" disabled={reason.trim().length < 3} loading={busy} onPress={async () => { if (await confirmAsync(t('admin.cancelOrder'), t('admin.cancelConfirm'), t('admin.cancelOrder'), t('common.cancel'), true)) await run(() => endpoints.admin.cancel(o.id, reason.trim())); }} />
      </> : null}
      {err ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Text> : null}
    </Screen>
  );
}

export function TeamScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Team'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.partners());
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.addPartner(name.trim(), phone); setName(''); setPhone(''); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.team')} />
      {loading && !data ? <Loading /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : (
        <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />} keyboardShouldPersistTaps="handled">
          {data!.partners.map((p) => (
            <Card key={p.id} style={s.orderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{p.name}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{p.phone} · {t('admin.codToday')}: {formatMoney(p.codCollectedToday)}</Text>
                <Pill text={!p.active ? t('admin.inactive') : p.isAvailable ? t('partner.available') : t('partner.busy')} tone={!p.active ? 'red' : p.isAvailable ? 'green' : 'amber'} />
              </View>
              <Switch accessibilityLabel={t('admin.active')} value={p.active} onValueChange={async (v) => { try { await endpoints.admin.setPartnerActive(p.id, v); await reload(); } catch (e) { setErr((e as Error).message); } }} />
            </Card>
          ))}
          <Text style={[type.h3, s.sec]}>{t('admin.addPartner')}</Text>
          <TextField label={t('signup.name')} value={name} onChangeText={setName} autoCapitalize="words" />
          <TextField label={t('address.phone')} value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
          {err ? <Text style={[type.small, { color: colors.red, marginBottom: 8 }]}>{err}</Text> : null}
          <Button title={t('admin.addPartner')} onPress={add} loading={busy} disabled={name.trim().length < 2 || phone.length !== 10} />
        </ScrollView>)}
    </SafeAreaView>
  );
}

export function MoreScreen(_p: BottomTabScreenProps<AdminTabParamList, 'More'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.moreRow}><Icon name={icon} size={24} color={danger ? colors.red : colors.navy} /><Text style={[type.bodyMedium, { flex: 1, color: danger ? colors.red : colors.text }]}>{label}</Text></Pressable>
  );
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.more')} />
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.md }]}>{user?.name} · +91 {user?.phone}</Text>
        {row('people-outline', t('admin.customers'), () => nav.navigate('Customers'))}
        {row('bar-chart-outline', t('admin.reports'), () => nav.navigate('Reports'))}
        {row('settings-outline', t('admin.settings'), () => nav.navigate('StoreSettings'))}
        {row('language-outline', t('profile.language'), () => nav.navigate('Language'))}
        {row('log-out-outline', t('profile.logout'), () => void logout(), true)}
      </ScrollView>
    </SafeAreaView>
  );
}

export function CustomersScreen() {
  const { t } = useTranslation();
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(id); }, [q]);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.customers(term || undefined));
  useEffect(() => { void reload(); }, [term, reload]);
  return (
    <Screen>
      <View style={s.search}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('admin.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.search')} style={[type.body, { flex: 1, color: colors.text }]} /></View>
      {loading && !data ? <Loading /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : data!.customers.map((c) => (
        <Card key={c.id} style={s.orderRow}><View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{c.name ?? '—'}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {c.phone}</Text></View><Text style={[type.smallMedium, { color: colors.secondary }]}>{t('admin.orderCount', { count: c.orderCount })}</Text></Card>))}
    </Screen>
  );
}

export function ReportsScreen() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.reports(days));
  useEffect(() => { void reload(); }, [days, reload]);
  return (
    <Screen>
      <View style={s.filters}>{[7, 30, 90].map((d) => <Pressable key={d} accessibilityRole="button" onPress={() => setDays(d)} style={[s.chip, days === d && s.chipOn]}><Text style={[type.smallMedium, { color: days === d ? colors.white : colors.navy }]}>{t('admin.lastDays', { count: d })}</Text></Pressable>)}</View>
      {loading && !data ? <Loading /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : <>
        <Text style={[type.h3, s.sec]}>{t('admin.paymentSplit')}</Text>
        {data!.paymentSplit.length ? data!.paymentSplit.map((p) => <Text key={p.method ?? 'x'} style={[type.body, { color: colors.text }]}>{p.method ? t(`pay.${p.method}`) : '—'}: {p.orders} · {formatMoney(p.sales)}</Text>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        <Text style={[type.h3, s.sec]}>{t('admin.perPartner')}</Text>
        {data!.perPartner.length ? data!.perPartner.map((p) => <Text key={p.name} style={[type.body, { color: colors.text }]}>{p.name}: {p.orders}</Text>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        <Text style={[type.h3, s.sec]}>{t('admin.dailySales')}</Text>
        {data!.daily.length ? data!.daily.map((d) => <View key={d.day} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{formatDate(d.day)}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{d.orders} · {formatMoney(d.sales)}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
      </>}
    </Screen>
  );
}

export function StoreSettingsScreen({ navigation }: NativeStackScreenProps<AdminStackParamList, 'StoreSettings'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.settings());
  const [f, setF] = useState<{ isOpen: boolean; openingTime: string; closingTime: string; address: string; phone: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (data && !f) setF({ isOpen: data.isOpen, openingTime: data.openingTime, closingTime: data.closingTime, address: data.address ?? '', phone: data.phone ?? '', email: data.email ?? '' }); }, [data, f]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f) return <Loading />;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.saveSettings({ ...f, address: f.address || null, phone: f.phone || null, email: f.email || null }); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} onPress={save} loading={busy} />}>
      <View style={[s.rowBetween, { marginBottom: spacing.lg }]}><Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.storeOpen')}</Text><Switch accessibilityLabel={t('admin.storeOpen')} value={f.isOpen} onValueChange={(v) => setF({ ...f, isOpen: v })} /></View>
      <TextField label={t('admin.opening')} value={f.openingTime} onChangeText={set('openingTime')} placeholder="09:00" />
      <TextField label={t('admin.closing')} value={f.closingTime} onChangeText={set('closingTime')} placeholder="21:00" />
      <TextField label={t('admin.storeAddress')} value={f.address} onChangeText={set('address')} multiline />
      <TextField label={t('address.phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <TextField label={t('signup.email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
      {err ? <Text style={[type.small, { color: colors.red }]}>{err}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  pad: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md, backgroundColor: colors.white },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  filters: { gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rxRow: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  rx: { width: 72, height: 90, borderRadius: radius.sm, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.border },
});
