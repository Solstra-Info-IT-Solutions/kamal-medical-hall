import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Platform, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOutLeft, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { Order, OrderSummary, Partner } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { OrderCard } from '../../components/OrderCard';
import { CountUp, Enter, Skeleton, Tap, tick } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Message, Pill, Screen, TextField, type IconName } from '../../components/ui';
import { notice, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import type { AdminStackParamList, AdminTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
const LIVE = ['order:update', 'notification'];
const Header = ({ title, right }: { title: string; right?: React.ReactNode }) => <View style={s.headRow}><Text style={[type.h2, s.heading]}>{title}</Text>{right ? <View style={s.headRight}>{right}</View> : null}</View>;
const ListSkeleton = () => <View style={{ padding: spacing.lg, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={110} r={16} />)}</View>;

function OrderRow({ o, onPress, index = 0 }: { o: OrderSummary; onPress: () => void; index?: number }) {
  return <OrderCard order={o} index={index} onPress={onPress} subtitle={`${o.customerName ?? o.customerPhone ?? ''}${o.summary ? ' · ' + o.summary : ''}`} />;
}

// ---------------------------------------------------------------- Dashboard
export function DashboardScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Dashboard'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const stats = useLoad(() => endpoints.admin.dashboard(), LIVE);
  const team = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const recent = useLoad(() => endpoints.admin.orders('requested'), LIVE);
  const data = stats.data;
  let tileIndex = 1;
  const tile = (icon: IconName, label: string, value: number, money = false, tone: 'blue' | 'green' | 'amber' = 'blue', onPress?: () => void) => (
    <Enter index={tileIndex++} style={s.tile}>
      <Card onPress={onPress} style={s.tileCard}>
        <View style={[s.tileIcon, tone === 'green' && { backgroundColor: colors.greenBg }, tone === 'amber' && { backgroundColor: colors.amberBg }]}><Icon name={icon} size={22} color={tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.primary} /></View>
        <CountUp value={value} prefix={money ? '₹' : ''} style={[type.h1, { color: colors.text }]} />
        <Text style={[type.small, { color: colors.secondary }]}>{label}</Text>
      </Card>
    </Enter>
  );
  const available = team.data?.partners.filter((p) => p.isAvailable && p.active).length ?? 0;
  const totalPartners = team.data?.partners.filter((p) => p.active).length ?? 0;
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.dashboard')} />
      {stats.loading && !data ? <ListSkeleton /> : stats.error && !data ? <ErrorView message={stats.error} onRetry={stats.reload} retryLabel={t('common.retry')} /> : (
        <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={false} onRefresh={() => { void stats.reload(); void team.reload(); void recent.reload(); }} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          <View style={s.grid}>
            {tile('mail-unread', t('admin.newRequests'), data!.requested, false, 'amber', () => nav.navigate('Tabs', { screen: 'Requests' }))}
            {tile('hourglass', t('admin.awaiting'), data!.awaitingPayment)}
            {tile('cube', t('admin.ready'), data!.readyToDispatch, false, 'blue', () => nav.navigate('Tabs', { screen: 'Orders' }))}
            {tile('bicycle', t('admin.outForDelivery'), data!.outForDelivery)}
            {tile('checkmark-done', t('admin.deliveredToday'), data!.deliveredToday, false, 'green')}
            {tile('cash', t('admin.salesToday'), data!.salesToday, true, 'green')}
          </View>

          <Enter index={8}>
            <Card onPress={() => nav.navigate('Tabs', { screen: 'Team' })} style={s.teamCard}>
              <View style={[s.tileIcon, { backgroundColor: available ? colors.greenBg : colors.amberBg, marginBottom: 0 }]}><Icon name="people" size={22} color={available ? colors.green : colors.amber} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.liveTeam')}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{totalPartners ? t('admin.availableNow', { available, total: totalPartners }) : t('admin.noPartners')}</Text>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.muted} />
            </Card>
          </Enter>

          <Enter index={9}><Text style={[type.h3, s.sec]}>{t('admin.recentRequests')}</Text></Enter>
          {recent.data && !recent.data.orders.length ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noRequests')}</Text> : null}
          {recent.data?.orders.slice(0, 3).map((o, i) => <OrderRow key={o.id} o={o} index={i + 10} onPress={() => nav.navigate('OrderReview', { orderId: o.id })} />)}
        </ScrollView>)}
    </SafeAreaView>
  );
}

function OrderList({ status, title, search }: { status?: string; title: string; search?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<string | undefined>(status);
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(id); }, [q]);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.orders(filter, term || undefined), LIVE);
  useEffect(() => { void reload(); }, [filter, term, reload]);
  const filters = [undefined, 'requested', 'quoted,awaiting_payment', 'ready_to_dispatch', 'out_for_delivery', 'delivered', 'cancelled,rejected'];
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={title} />
      {search ? <>
        <Enter><View style={s.search}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('admin.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.search')} style={[type.body, s.searchInput]} /></View></Enter>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters} style={{ flexGrow: 0 }}>
          {filters.map((f) => <Tap key={f ?? 'all'} accessibilityRole="button" onPress={() => setFilter(f)} scaleTo={0.93} style={[s.chip, filter === f && s.chipOn]}><Text style={[type.smallMedium, { color: filter === f ? colors.white : colors.navy }]}>{f ? t(`status.${f.split(',')[0]}`) : t('admin.all')}</Text></Tap>)}
        </ScrollView></> : null}
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? <Message icon="file-tray-outline" title={t('admin.noOrders')} /> : (
        <ScrollView contentContainerStyle={s.pad} refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          {data.orders.map((o, i) => <OrderRow key={o.id} o={o} index={i} onPress={() => nav.navigate('OrderReview', { orderId: o.id })} />)}
        </ScrollView>)}
    </SafeAreaView>
  );
}
export const RequestsScreen = () => { const { t } = useTranslation(); return <OrderList status="requested" title={t('admin.newRequests')} />; };
export const AllOrdersScreen = () => { const { t } = useTranslation(); return <OrderList title={t('admin.allOrders')} search />; };

// ---------------------------------------------------------------- Order review
function PartnerRow({ p, pincode, busy, canAssign, onAssign }: { p: Partner; pincode: string; busy: boolean; canAssign: boolean; onAssign: () => void }) {
  const { t } = useTranslation();
  const covers = p.pincodes.length === 0 || p.pincodes.includes(pincode);
  const ready = p.active && p.isAvailable && covers;
  const reason = !p.active ? t('admin.inactive') : !p.isAvailable ? t('admin.partnerBusyReason') : !covers ? t('admin.notCoveredReason', { pincode }) : null;
  return (
    <View style={[s.partnerRow, ready && s.partnerReady]}>
      <Avatar name={p.name} />
      <View style={{ flex: 1 }}>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{p.name}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{p.phone}{p.activeOrders ? ` · ${t('admin.activeOrders', { count: p.activeOrders })}` : ''}</Text>
        <View style={s.pillRow}>
          <Pill text={!p.active ? t('admin.inactive') : p.isAvailable ? t('partner.available') : t('partner.busy')} tone={!p.active ? 'red' : p.isAvailable ? 'green' : 'amber'} />
          <Pill text={p.pincodes.length === 0 ? t('admin.coversAll') : covers ? t('admin.covers', { pincode }) : t('admin.notCovered')} tone={covers ? 'blue' : 'red'} />
        </View>
      </View>
      <View style={{ gap: 8, alignItems: 'flex-end' }}>
        <CallButton phone={p.phone} compact label={t('admin.callPartner')} />
        <Button small title={t('admin.assignBtn')} onPress={onAssign} disabled={!ready || !canAssign} loading={busy} style={s.assignBtn} />
      </View>
      {!ready && reason ? <Text style={[type.small, s.reasonText]}>{reason}</Text> : null}
    </View>
  );
}

export function OrderReviewScreen({ route }: NativeStackScreenProps<AdminStackParamList, 'OrderReview'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload, setData } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const partners = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o: Order = data!.order;
  const run = async (key: string, fn: () => Promise<{ order: Order }>) => {
    setBusy(key); setErr('');
    try { const r = await fn(); setData({ order: r.order }); setReason(''); void partners.reload(); tick('success'); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };
  const list = [...(partners.data?.partners ?? [])].sort((a, b) => Number(b.isAvailable && b.active) - Number(a.isAvailable && a.active));
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);
  const quoteValue = Number(amount);
  const mapsQuery = encodeURIComponent([o.address.line1, o.address.line2, o.address.landmark, o.address.city, o.address.pincode].filter(Boolean).join(', '));
  const openMaps = () => { void Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${mapsQuery}` : `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`); };

  const assign = async (p: Partner) => {
    const ok = await showDialog({ title: t('admin.assignConfirmTitle', { name: p.name }), message: t('admin.assignConfirmMsg', { order: o.orderNumber }), icon: 'bicycle', confirmLabel: t('admin.assignBtn'), cancelLabel: t('common.cancel') });
    if (ok) await run(`assign-${p.id}`, () => endpoints.admin.assign(o.id, p.id));
  };

  return (
    <Screen>
      <Enter index={0}>
        <View style={s.rowBetween}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} /></View>
        <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{formatDateTime(o.createdAt)}</Text>
      </Enter>

      <Enter index={1}>
        <Card style={s.block}>
          <View style={s.personRow}>
            <Avatar name={o.customer?.name} size={48} />
            <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('admin.customer')}</Text><Text style={[type.h3, { color: colors.text }]}>{o.customer?.name ?? '—'}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {o.customer?.phone}</Text></View>
          </View>
          <View style={s.btnRow}>
            <View style={{ flex: 1 }}><CallButton phone={o.customer?.phone} label={t('admin.callCustomer')} /></View>
            <Button title={t('admin.directions')} variant="outline" icon="navigate" onPress={openMaps} style={{ flex: 1 }} />
          </View>
          <Text style={[type.body, { color: colors.text, marginTop: spacing.md }]}>{[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, {o.address.city} - {o.address.pincode}</Text>
          <Text style={[type.smallMedium, { color: colors.secondary, marginTop: 2 }]}>{formatDate(o.deliveryDate)} · {o.deliverySlot}</Text>
        </Card>
      </Enter>

      <Enter index={2}>
        <Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{o.kind === 'prescription' ? t('admin.prescriptions') : t('order.items')}</Text>
          {o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>)}
          <View style={s.rxRow}>{o.prescriptions.map((p) => (
            <Tap key={p.id} accessibilityRole="button" onPress={() => p.url && Linking.openURL(p.url)} style={s.rx}>
              {p.mimeType === 'application/pdf' || !p.url ? <Icon name="document-text" size={30} /> : <Image source={{ uri: p.url }} style={{ flex: 1, width: '100%', borderRadius: radius.sm }} />}
            </Tap>))}</View>
          {o.note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {o.note}</Text> : null}
          {o.quotedAmount !== null ? <Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{t('order.amount')}: {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)} (${o.paymentStatus})` : ''}</Text> : null}
          {o.rejectionReason || o.cancelReason ? <Text style={[type.body, { color: colors.red, marginTop: spacing.sm }]}>{o.rejectionReason ?? o.cancelReason}</Text> : null}
        </Card>
      </Enter>

      {o.partner ? (
        <Enter index={3}>
          <Card style={s.block}>
            <View style={s.personRow}>
              <Avatar name={o.partner.name} size={48} />
              <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{t('admin.partner')}</Text><Text style={[type.h3, { color: colors.text }]}>{o.partner.name}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {o.partner.phone}</Text></View>
              <CallButton phone={o.partner.phone} compact label={t('admin.callPartner')} />
            </View>
          </Card>
        </Enter>
      ) : null}

      {o.status === 'requested' || o.status === 'quoted' ? (
        <Enter index={4}>
          <Card style={s.block}>
            <Text style={[type.h3, { color: colors.text, marginBottom: spacing.sm }]}>{o.status === 'quoted' ? t('admin.requote') : t('admin.setQuote')}</Text>
            <TextField label={t('admin.amountLabel')} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder="0" valid={quoteValue > 0} />
            <Button title={t('admin.sendQuote')} icon="send" disabled={!(quoteValue > 0)} loading={busy === 'quote'} onPress={() => run('quote', () => endpoints.admin.quote(o.id, quoteValue))} />
          </Card>
        </Enter>
      ) : null}
      {o.status === 'requested' ? (
        <Enter index={5}>
          <Card style={s.block}>
            <TextField label={t('admin.rejectReason')} value={reason} onChangeText={setReason} />
            <Button title={t('admin.reject')} variant="danger" disabled={reason.trim().length < 3} loading={busy === 'reject'} onPress={() => run('reject', () => endpoints.admin.reject(o.id, reason.trim()))} />
          </Card>
        </Enter>
      ) : null}
      {o.status === 'awaiting_payment' ? <Enter index={4}><Card style={s.block}><Text style={[type.body, { color: colors.text }]}>{t('admin.awaitingRazorpay')}</Text></Card></Enter> : null}

      {o.status === 'ready_to_dispatch' && !o.partner ? (
        <Enter index={4}>
          <Text style={[type.h3, s.sec]}>{t('admin.assignTitle')}</Text>
          <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.assignHelp')}</Text>
          {partners.loading && !partners.data ? <Skeleton h={90} r={16} /> : null}
          {!list.length && !partners.loading ? <Card><Text style={[type.body, { color: colors.text, marginBottom: spacing.md }]}>{t('admin.noPartners')}</Text><Button title={t('admin.addFirstPartner')} icon="person-add" onPress={() => nav.navigate('Tabs', { screen: 'Team' })} /></Card> : null}
          {list.map((p) => (
            <Animated.View key={p.id} layout={LinearTransition.springify().damping(18)} entering={FadeInDown.duration(300)}>
              <PartnerRow p={p} pincode={o.address.pincode} busy={busy === `assign-${p.id}`} canAssign={!busy} onAssign={() => assign(p)} />
            </Animated.View>
          ))}
        </Enter>
      ) : null}

      {canCancel && o.status !== 'requested' ? (
        <Enter index={6}>
          <Card style={s.block}>
            <TextField label={t('admin.cancelReason')} value={reason} onChangeText={setReason} />
            <Button title={t('admin.cancelOrder')} variant="danger" disabled={reason.trim().length < 3} loading={busy === 'cancel'}
              onPress={async () => { const ok = await showDialog({ title: t('admin.cancelOrder'), message: t('admin.cancelConfirm'), icon: 'warning', tone: 'danger', confirmLabel: t('admin.cancelOrder'), cancelLabel: t('common.back') }); if (ok) await run('cancel', () => endpoints.admin.cancel(o.id, reason.trim())); }} />
          </Card>
        </Enter>
      ) : null}
      {err ? <Animated.Text entering={FadeInDown.duration(220)} style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Animated.Text> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- Team
export function TeamScreen(_p: BottomTabScreenProps<AdminTabParamList, 'Team'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.partners(), ['partner:update', 'order:update']);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.addPartner(name.trim(), phone); setName(''); setPhone(''); setOpen(false); tick('success'); await reload(); await notice(t('admin.partnerAdded'), t('admin.partnerAddedMsg'), t('common.ok')); }
    catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };
  const toggleActive = async (p: Partner, v: boolean) => {
    if (!v) {
      const ok = await showDialog({ title: t('admin.deactivateTitle', { name: p.name }), message: t('admin.deactivateMsg'), icon: 'person-remove', tone: 'danger', confirmLabel: t('admin.deactivate'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    try { await endpoints.admin.setPartnerActive(p.id, v); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.team')} right={<Tap accessibilityRole="button" accessibilityLabel={t('admin.addPartner')} onPress={() => setOpen((v) => !v)} style={s.addBtn}><Icon name={open ? 'close' : 'person-add'} size={20} color={colors.white} /></Tap>} />
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : (
        <Screen>
          {open ? (
            <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutLeft.duration(200)}>
              <Card style={s.block}>
                <Text style={[type.h3, { color: colors.text, marginBottom: spacing.md }]}>{t('admin.addPartner')}</Text>
                <TextField label={t('signup.name')} value={name} onChangeText={setName} valid={name.trim().length >= 2} autoCapitalize="words" returnKeyType="next" />
                <TextField label={t('address.phone')} value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} valid={/^[6-9]\d{9}$/.test(phone)} keyboardType="number-pad" hint={t('admin.partnerPhoneHint')} />
                {err ? <Text style={[type.small, { color: colors.red, marginBottom: 8 }]}>{err}</Text> : null}
                <Button title={t('admin.addPartner')} icon="person-add" onPress={add} loading={busy} disabled={name.trim().length < 2 || !/^[6-9]\d{9}$/.test(phone)} />
              </Card>
            </Animated.View>
          ) : null}
          {!data!.partners.length && !open ? <View style={{ height: 320 }}><Message icon="people-outline" title={t('admin.noPartners')} text={t('admin.noPartnersHelp')} actionLabel={t('admin.addPartner')} onAction={() => setOpen(true)} /></View> : null}
          {data!.partners.map((p, i) => (
            <Enter key={p.id} index={i}>
              <Card style={s.block}>
                <View style={s.personRow}>
                  <Avatar name={p.name} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.h3, { color: colors.text }]}>{p.name}</Text>
                    <Text style={[type.small, { color: colors.secondary }]}>+91 {p.phone}</Text>
                    <View style={s.pillRow}><Pill text={!p.active ? t('admin.inactive') : p.isAvailable ? t('partner.available') : t('partner.busy')} tone={!p.active ? 'red' : p.isAvailable ? 'green' : 'amber'} /></View>
                  </View>
                  <CallButton phone={p.phone} compact label={t('admin.callPartner')} />
                </View>
                <View style={s.stats}>
                  <View style={s.stat}><Text style={[type.h3, { color: colors.text }]}>{p.activeOrders}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('admin.activeLabel')}</Text></View>
                  <View style={s.stat}><Text style={[type.h3, { color: colors.text }]}>{formatMoney(p.codCollectedToday)}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('admin.codToday')}</Text></View>
                </View>
                <Tap accessibilityRole="button" onPress={() => nav.navigate('PartnerAreas', { partnerId: p.id, name: p.name })} scaleTo={0.98} style={s.areaRow}>
                  <Icon name="map" size={20} />
                  <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{p.pincodes.length ? t('admin.areasCount', { count: p.pincodes.length }) : t('admin.areasAll')}</Text>
                  <Text style={[type.smallMedium, { color: colors.primary }]}>{t('common.edit')}</Text>
                </Tap>
                <View style={s.activeRow}><Text style={[type.small, { color: colors.secondary }]}>{t('admin.active')}</Text><Switch accessibilityLabel={t('admin.active')} value={p.active} onValueChange={(v) => toggleActive(p, v)} /></View>
              </Card>
            </Enter>
          ))}
        </Screen>)}
    </SafeAreaView>
  );
}

// Choose the pincodes a delivery partner can cover (empty = no restriction).
export function PartnerAreasScreen({ navigation, route }: NativeStackScreenProps<AdminStackParamList, 'PartnerAreas'>) {
  const { t } = useTranslation();
  const { partnerId } = route.params;
  const pins = useLoad(() => endpoints.admin.pincodes());
  const partners = useLoad(() => endpoints.admin.partners());
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (selected || !partners.data) return;
    setSelected(new Set(partners.data.partners.find((p) => p.id === partnerId)?.pincodes ?? []));
  }, [partners.data, selected, partnerId]);
  const active = useMemo(() => (pins.data?.pincodes ?? []).filter((p) => p.active), [pins.data]);
  const shown = active.filter((p) => !q.trim() || p.pincode.includes(q.trim()) || (p.area ?? '').toLowerCase().includes(q.trim().toLowerCase()));
  if ((pins.loading || partners.loading) && !selected) return <ListSkeleton />;
  if (pins.error || partners.error) return <ErrorView message={(pins.error ?? partners.error)!} onRetry={() => { void pins.reload(); void partners.reload(); }} retryLabel={t('common.retry')} />;
  const sel = selected ?? new Set<string>();
  const toggle = (p: string) => { tick(); const n = new Set(sel); if (n.has(p)) n.delete(p); else n.add(p); setSelected(n); };
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.setPartnerPincodes(partnerId, [...sel]); tick('success'); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('admin.saveAreas')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.areasHelp', { name: route.params.name })}</Text></Enter>
      <Enter index={1}>
        <View style={[s.search, { marginHorizontal: 0 }]}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} keyboardType="number-pad" placeholder={t('admin.searchPincode')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.searchPincode')} style={[type.body, s.searchInput]} /></View>
        <View style={[s.btnRow, { marginBottom: spacing.md, marginTop: 0 }]}>
          <Button title={t('admin.selectAll')} variant="outline" onPress={() => setSelected(new Set(active.map((p) => p.pincode)))} style={{ flex: 1 }} />
          <Button title={t('admin.clear')} variant="outline" onPress={() => setSelected(new Set())} style={{ flex: 1 }} />
        </View>
        <Text style={[type.smallMedium, { color: sel.size ? colors.primary : colors.green, marginBottom: spacing.sm }]}>{sel.size ? t('admin.areasCount', { count: sel.size }) : t('admin.areasAll')}</Text>
      </Enter>
      <View style={s.chipWrap}>
        {shown.map((p) => {
          const on = sel.has(p.pincode);
          return <Tap key={p.pincode} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(p.pincode)} scaleTo={0.92} style={[s.pinChip, on && s.pinChipOn]}><Text style={[type.smallMedium, { color: on ? colors.white : colors.navy }]}>{p.pincode}</Text></Tap>;
        })}
      </View>
      {err ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Text> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------- Delivery pincodes
export function PincodesScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.pincodes());
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = useMemo(() => [...new Set(input.split(/[^0-9]+/).filter(Boolean))], [input]);
  const invalid = parsed.filter((p) => !/^\d{6}$/.test(p));
  const list = (data?.pincodes ?? []).filter((p) => !q.trim() || p.pincode.includes(q.trim()));
  const activeCount = data?.pincodes.filter((p) => p.active).length ?? 0;

  const add = async () => {
    if (!parsed.length || invalid.length) { setErr(t('admin.pincodeInvalid')); tick('error'); return; }
    setBusy(true); setErr('');
    try { await endpoints.admin.addPincodes(parsed); setInput(''); tick('success'); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const toggle = async (pin: string, active: boolean) => { try { await endpoints.admin.setPincodeActive(pin, active); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } };
  const remove = async (pin: string) => {
    const ok = await showDialog({ title: t('admin.deletePincodeTitle', { pincode: pin }), message: t('admin.deletePincodeMsg'), icon: 'trash', tone: 'danger', confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    try { await endpoints.admin.deletePincode(pin); await reload(); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
  };
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  return (
    <Screen>
      <Enter>
        <Card style={s.block}>
          <Text style={[type.h3, { color: colors.text }]}>{t('admin.addPincodes')}</Text>
          <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>{t('admin.pincodesHelp')}</Text>
          <TextField value={input} onChangeText={(v) => { setInput(v); setErr(''); }} keyboardType="numbers-and-punctuation" placeholder="302020, 302021" error={err || (invalid.length ? t('admin.pincodeInvalid') : undefined)} valid={parsed.length > 0 && !invalid.length} onSubmitEditing={add} />
          <Button title={parsed.length > 1 ? t('admin.addN', { count: parsed.length }) : t('admin.addPincode')} icon="add" onPress={add} loading={busy} disabled={!parsed.length || invalid.length > 0} />
        </Card>
      </Enter>
      <Enter index={1}>
        <View style={s.rowBetween}><Text style={[type.h3, { color: colors.text }]}>{t('admin.deliveryArea')}</Text><Text style={[type.smallMedium, { color: colors.green }]}>{t('admin.activeCount', { active: activeCount, total: data!.pincodes.length })}</Text></View>
        <View style={[s.search, { marginHorizontal: 0, marginTop: spacing.sm }]}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} keyboardType="number-pad" placeholder={t('admin.searchPincode')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.searchPincode')} style={[type.body, s.searchInput]} /></View>
      </Enter>
      {list.map((p) => (
        <Animated.View key={p.pincode} layout={LinearTransition.springify().damping(18)} exiting={FadeOutLeft.duration(200)}>
          <View style={s.pinRow}>
            <View style={[s.pinIcon, !p.active && { backgroundColor: colors.border }]}><Icon name="location" size={18} color={p.active ? colors.primary : colors.muted} /></View>
            <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: p.active ? colors.text : colors.muted }]}>{p.pincode}</Text>{p.area ? <Text style={[type.small, { color: colors.secondary }]}>{p.area}</Text> : null}</View>
            <Switch accessibilityLabel={`${p.pincode} ${t('admin.active')}`} value={p.active} onValueChange={(v) => toggle(p.pincode, v)} />
            <Tap accessibilityRole="button" accessibilityLabel={t('common.delete')} onPress={() => remove(p.pincode)} hitSlop={8} haptic={false} style={{ padding: 6 }}><Icon name="trash-outline" size={20} color={colors.red} /></Tap>
          </View>
        </Animated.View>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- More / Customers / Reports / Settings
export function MoreScreen(_p: BottomTabScreenProps<AdminTabParamList, 'More'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  let idx = 1;
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Enter index={idx++}><Tap accessibilityRole="button" onPress={onPress} scaleTo={0.98} style={s.moreRow}>
      <View style={[s.moreIcon, danger && { backgroundColor: colors.redBg }]}><Icon name={icon} size={22} color={danger ? colors.red : colors.navy} /></View>
      <Text style={[type.bodyMedium, { flex: 1, color: danger ? colors.red : colors.text }]}>{label}</Text>
      {!danger ? <Icon name="chevron-forward" size={20} color={colors.muted} /> : null}
    </Tap></Enter>
  );
  const signOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) await logout();
  };
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header title={t('admin.more')} />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <Enter index={0}><View style={s.me}><Avatar name={user?.name} size={56} /><View><Text style={[type.h3, { color: colors.text }]}>{user?.name}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {user?.phone}</Text></View></View></Enter>
        {row('location-outline', t('admin.pincodes'), () => nav.navigate('Pincodes'))}
        {row('people-outline', t('admin.customers'), () => nav.navigate('Customers'))}
        {row('bar-chart-outline', t('admin.reports'), () => nav.navigate('Reports'))}
        {row('settings-outline', t('admin.settings'), () => nav.navigate('StoreSettings'))}
        {row('language-outline', t('profile.language'), () => nav.navigate('Language'))}
        {row('log-out-outline', t('profile.logout'), signOut, true)}
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
      <View style={[s.search, { marginHorizontal: 0 }]}><Icon name="search" size={20} color={colors.secondary} /><TextInput value={q} onChangeText={setQ} placeholder={t('admin.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('admin.search')} style={[type.body, s.searchInput]} /></View>
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data!.customers.length ? <View style={{ height: 300 }}><Message icon="people-outline" title={t('admin.noCustomers')} /></View> : data!.customers.map((c, i) => (
        <Enter key={c.id} index={i}>
          <Card style={[s.block, s.personRow]}>
            <Avatar name={c.name} />
            <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{c.name ?? '—'}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {c.phone} · {t('admin.orderCount', { count: c.orderCount })}</Text></View>
            <CallButton phone={c.phone} compact label={t('admin.callCustomer')} />
          </Card>
        </Enter>))}
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
      <View style={s.filtersRow}>{[7, 30, 90].map((d) => <Tap key={d} accessibilityRole="button" onPress={() => setDays(d)} scaleTo={0.93} style={[s.chip, days === d && s.chipOn]}><Text style={[type.smallMedium, { color: days === d ? colors.white : colors.navy }]}>{t('admin.lastDays', { count: d })}</Text></Tap>)}</View>
      {loading && !data ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : <>
        <Enter index={0}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.paymentSplit')}</Text>
          {data!.paymentSplit.length ? data!.paymentSplit.map((p) => <View key={p.method ?? 'x'} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{p.method ? t(`pay.${p.method}`) : '—'}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{p.orders} · {formatMoney(p.sales)}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
        <Enter index={1}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.perPartner')}</Text>
          {data!.perPartner.length ? data!.perPartner.map((p) => <View key={p.name} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{p.name}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{p.orders}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
        <Enter index={2}><Card style={s.block}>
          <Text style={[type.h3, { color: colors.text, marginBottom: 6 }]}>{t('admin.dailySales')}</Text>
          {data!.daily.length ? data!.daily.map((d) => <View key={d.day} style={s.rowBetween}><Text style={[type.body, { color: colors.text }]}>{formatDate(d.day)}</Text><Text style={[type.bodyMedium, { color: colors.text }]}>{d.orders} · {formatMoney(d.sales)}</Text></View>) : <Text style={[type.body, { color: colors.secondary }]}>{t('admin.noData')}</Text>}
        </Card></Enter>
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
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f) return <ListSkeleton />;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.saveSettings({ ...f, address: f.address || null, phone: f.phone || null, email: f.email || null }); tick('success'); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Enter><Card style={[s.block, s.personRow]}><View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{t('admin.storeOpen')}</Text><Text style={[type.small, { color: f.isOpen ? colors.green : colors.red }]}>{f.isOpen ? t('admin.storeOpenOn') : t('admin.storeOpenOff')}</Text></View><Switch accessibilityLabel={t('admin.storeOpen')} value={f.isOpen} onValueChange={(v) => setF({ ...f, isOpen: v })} /></Card></Enter>
      <Enter index={1}><TextField label={t('admin.opening')} value={f.openingTime} onChangeText={set('openingTime')} placeholder="09:00" /></Enter>
      <Enter index={2}><TextField label={t('admin.closing')} value={f.closingTime} onChangeText={set('closingTime')} placeholder="21:00" /></Enter>
      <Enter index={3}><TextField label={t('admin.storeAddress')} value={f.address} onChangeText={set('address')} multiline /></Enter>
      <Enter index={4}><TextField label={t('address.phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" /></Enter>
      <Enter index={5}><TextField label={t('signup.email')} value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" /></Enter>
      {err ? <Text style={[type.small, { color: colors.red }]}>{err}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  headRight: { position: 'absolute', right: spacing.lg },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  pad: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { width: '47.5%' },
  tileCard: { gap: 4, backgroundColor: colors.white, boxShadow: '0px 6px 16px rgba(15,33,71,0.08)' },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  teamCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md, backgroundColor: colors.white },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  block: { marginBottom: spacing.md, backgroundColor: colors.white, boxShadow: '0px 4px 14px rgba(15,33,71,0.07)' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
  pillRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  rxRow: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  rx: { width: 72, height: 90, borderRadius: radius.sm, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  partnerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md, backgroundColor: colors.white },
  partnerReady: { borderColor: colors.green, backgroundColor: '#F5FCF7' },
  assignBtn: { minWidth: 92 },
  reasonText: { width: '100%', color: colors.secondary },
  stats: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
  stat: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  activeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, color: colors.text, outlineStyle: 'none' } as object,
  filters: { gap: 8, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, flexDirection: 'row' },
  filtersRow: { gap: 8, paddingBottom: spacing.md, flexDirection: 'row' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pinChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  pinChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pinIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  me: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: spacing.md, marginBottom: spacing.sm },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  moreIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
