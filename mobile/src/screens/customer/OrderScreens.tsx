import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { Order, OrderStatus, PaymentMethod } from '../../api/types';
import { OrderCard } from '../../components/OrderCard';
import { CountUp, Enter, Ripples, Skeleton, Tap, tick, useShake } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Message, Pill, ResponsiveGrid, Screen } from '../../components/ui';
import { fileBadge, isImageMime } from '../../fileKinds';
import { notice } from '../../dialog';
import { useContentStyle } from '../../layout';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, istDate, maskDmy, parseDmy, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

const ListSkeleton = () => <View style={{ gap: 14, padding: spacing.lg }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={118} r={16} />)}</View>;

type OrdersTab = 'completed' | 'cancelled';
type Preset = 'all' | 'today' | '7d' | '30d' | 'custom';
const PRESETS: Preset[] = ['all', 'today', '7d', '30d', 'custom'];

export function OrdersScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Orders'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle(true);
  const [tab, setTab] = useState<OrdersTab>('completed');
  const [preset, setPreset] = useState<Preset>('all');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const from = fromText ? parseDmy(fromText) : null, to = toText ? parseDmy(toText) : null;
  const customBad = preset === 'custom' && ((fromText.length === 10 && !from) || (toText.length === 10 && !to) || (from && to && from > to));
  const range = preset === 'today' ? { from: istDate(), to: istDate() } : preset === '7d' ? { from: istDate(-6) } : preset === '30d' ? { from: istDate(-29) } : preset === 'custom' && !customBad ? { from: from ?? undefined, to: to ?? undefined } : undefined;
  const key = `${tab}|${range?.from ?? ''}|${range?.to ?? ''}`;
  const { data, error, loading, reload } = useLoad(() => endpoints.orders(tab, 0, range), ['order:update']);
  useEffect(() => { void reload(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const filtered = key !== 'completed||' && key !== 'cancelled||';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Enter><Text style={[type.h2, s.heading]}>{t('orders.title')}</Text></Enter>
      <View style={[s.segWrap, content]}>
        {(['completed', 'cancelled'] as const).map((k) => (
          <Tap key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => setTab(k)} scaleTo={0.97} style={[s.seg, tab === k && s.segOn]}>
            <Icon name={k === 'completed' ? 'checkmark-done' : 'close-circle'} size={18} color={tab === k ? colors.white : colors.navy} />
            <Text style={[type.smallMedium, { color: tab === k ? colors.white : colors.navy }]}>{t(`orders.tab_${k}`)}</Text>
          </Tap>
        ))}
      </View>
      <View style={content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <View style={s.calIcon}><Icon name="calendar" size={18} color={colors.primary} /></View>
          {PRESETS.map((p) => (
            <Tap key={p} accessibilityRole="button" accessibilityState={{ selected: preset === p }} onPress={() => setPreset(p)} scaleTo={0.94} style={[s.chip, preset === p && s.chipOn]}>
              <Text style={[type.smallMedium, { color: preset === p ? colors.white : colors.navy }]}>{t(`orders.filter_${p}`)}</Text>
            </Tap>
          ))}
        </ScrollView>
        {preset === 'custom' ? (
          <View style={s.dateRow}>
            <TextInput value={fromText} onChangeText={(v) => setFromText(maskDmy(v))} placeholder={t('orders.fromDate')} placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={10} accessibilityLabel={t('orders.fromDate')} style={[type.body, s.dateInput, (fromText.length === 10 && !from) && { borderColor: colors.red }]} />
            <Icon name="arrow-forward" size={16} color={colors.muted} />
            <TextInput value={toText} onChangeText={(v) => setToText(maskDmy(v))} placeholder={t('orders.toDate')} placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={10} accessibilityLabel={t('orders.toDate')} style={[type.body, s.dateInput, (toText.length === 10 && !to) && { borderColor: colors.red }]} />
          </View>
        ) : null}
        {customBad ? <Text style={[type.small, { color: colors.red, paddingHorizontal: spacing.lg }]}>{t('orders.dateInvalid')}</Text> : null}
      </View>
      {loading && !data?.orders.length ? <ListSkeleton /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? (
        <Message icon={tab === 'completed' ? 'receipt-outline' : 'close-circle-outline'} title={filtered ? t('orders.noMatchTitle') : t(`orders.empty_${tab}`)} text={filtered ? t('orders.noMatch') : t(`orders.emptyHelp_${tab}`)} />
      ) : (
        <ScrollView contentContainerStyle={[{ padding: spacing.lg, paddingBottom: spacing.xxxl }, content]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={reload} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
          <ResponsiveGrid>{data.orders.map((o, i) => <OrderCard key={o.id} order={o} index={i} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} />)}</ResponsiveGrid>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const STEPS: OrderStatus[] = ['requested', 'quoted', 'ready_to_dispatch', 'out_for_delivery', 'delivered'];
const STEP_ICON = ['paper-plane', 'pricetag', 'checkmark-circle', 'bicycle', 'home'] as const;
const stepIndex = (st: OrderStatus) => ({ requested: 0, quoted: 1, accepted: 2, awaiting_payment: 1, ready_to_dispatch: 2, out_for_delivery: 3, delivered: 4, rejected: -1, cancelled: -1 })[st];

function TimelineStep({ i, idx, label }: { i: number; idx: number; label: string }) {
  const done = i < idx, on = i === idx;
  const pop = useSharedValue(0);
  useEffect(() => { pop.value = withDelay(250 + i * 140, withSpring(1, { damping: 9, stiffness: 160 })); }, [i, pop]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(pop.value, [0, 1], [0.3, 1]) }], opacity: pop.value }));
  return (
    <View style={s.step}>
      <Animated.View style={[s.dotWrap, a]}>
        {on ? <Ripples size={34} count={2} /> : null}
        <View style={[s.dot, (done || on) && s.dotOn, idx === 4 && i === 4 && { backgroundColor: colors.green }]}>
          {done || (on && idx === 4) ? <Icon name="checkmark" size={15} color={colors.white} /> : <Icon name={STEP_ICON[i]} size={14} color={on ? colors.white : colors.muted} />}
        </View>
      </Animated.View>
      <Text style={[type.small, { color: i <= idx ? colors.text : colors.muted, textAlign: 'center' }]}>{label}</Text>
    </View>
  );
}

function Timeline({ idx }: { idx: number }) {
  const { t } = useTranslation();
  const fill = useSharedValue(0);
  useEffect(() => { fill.value = withDelay(300, withTiming(idx / 4, { duration: 900 })); }, [idx, fill]);
  const bar = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));
  return (
    <View style={s.timeline}>
      <View style={s.line}><Animated.View style={[s.lineFill, bar]} /></View>
      {STEPS.map((st, i) => <TimelineStep key={st} i={i} idx={idx} label={t(`track.${st}`)} />)}
    </View>
  );
}

function DetailSkeleton() {
  return <View style={{ padding: spacing.lg, gap: 14 }}><Skeleton h={28} w="50%" /><Skeleton h={70} r={16} /><Skeleton h={120} r={16} /><Skeleton h={90} r={16} /></View>;
}

export function OrderDetailScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'OrderDetail'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId), ['order:update']);
  const config = useLoad(() => endpoints.config());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [errCount, setErrCount] = useState(0);
  const shake = useShake(errCount);
  if (loading && !data) return <DetailSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o = data!.order;
  const idx = stepIndex(o.status);
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);

  const cancel = async () => {
    if (reason.trim().length < 5) { setErr(t('order.reasonShort')); setErrCount((c) => c + 1); return; }
    setBusy(true); setErr('');
    try { await endpoints.cancelOrder(o.id, reason.trim()); setCancelOpen(false); setReason(''); await reload(); } catch (e) { setErr((e as Error).message); setErrCount((c) => c + 1); } finally { setBusy(false); }
  };
  const storePhone = config.data?.store.phone;

  return (
    <>
      <Screen footer={o.status === 'quoted' ? <Button title={t('order.acceptPay')} icon="arrow-forward" onPress={() => navigation.navigate('Payment', { orderId: o.id })} /> : o.status === 'awaiting_payment' ? <Button title={t('order.completePayment')} icon="card" onPress={() => navigation.navigate('Payment', { orderId: o.id })} /> : (o.status === 'ready_to_dispatch' || o.status === 'out_for_delivery') ? <Button title={t('live.trackBtn')} icon="navigate" onPress={() => navigation.navigate('Track', { orderId: o.id })} /> : undefined}>
        <Enter index={0}>
          <View style={s.head}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} /></View>
          <Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.createdAt)}</Text>
        </Enter>

        {o.status === 'rejected' ? <Enter index={1}><Card style={[s.alert, { backgroundColor: colors.redBg, borderColor: colors.redBg }]}><Text style={[type.bodyMedium, { color: colors.red }]}>{t('order.rejected')}</Text><Text style={[type.body, { color: colors.text }]}>{o.rejectionReason}</Text></Card></Enter> : null}
        {o.status === 'cancelled' ? <Enter index={1}><Card style={[s.alert, { backgroundColor: colors.redBg, borderColor: colors.redBg }]}><Text style={[type.bodyMedium, { color: colors.red }]}>{t('order.cancelled')}</Text><Text style={[type.body, { color: colors.text }]}>{o.cancelReason}</Text></Card></Enter> : null}

        {idx >= 0 ? <Enter index={1}><Timeline idx={idx} /></Enter> : null}

        {o.status === 'requested' ? <Enter index={2}><Card style={s.alert}><View style={s.row}><Icon name="hourglass" size={22} /><Text style={[type.body, { color: colors.text, flex: 1 }]}>{t('order.waitingReview')}</Text></View></Card></Enter> : null}
        {o.status === 'quoted' ? (
          <Enter index={2}>
            <LinearGradient colors={[colors.white, colors.amberBg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.quote}>
              <Text style={[type.bodyMedium, { color: colors.amber }]}>{t('order.quoteReady')}</Text>
              <CountUp value={o.quotedAmount ?? 0} prefix="₹" style={[type.h1, { color: colors.text, fontSize: 38, lineHeight: 52 }]} />
              <Text style={[type.small, { color: colors.secondary }]}>{t('cart.freeDelivery')}</Text>
              {o.quoteExpiresAt ? <Text style={[type.small, { color: colors.secondary }]}>{t('order.validTill', { time: formatDateTime(o.quoteExpiresAt) })}</Text> : null}
            </LinearGradient>
          </Enter>
        ) : o.quotedAmount !== null ? <Enter index={2}><Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{t('order.amount')}: {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)}` : ''}</Text></Enter> : null}
        {o.status === 'out_for_delivery' && o.partner?.name ? <Enter index={2}><Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]}>{t('order.deliveredBy', { name: o.partner.name })}</Text></Enter> : null}

        <Enter index={3}>
          <Text style={[type.h3, s.sec]}>{t('order.items')}</Text>
          {o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>)}
          {o.prescriptions.length > 0 ? <View style={s.rxRow}>{o.prescriptions.map((p) => (
            <Tap key={p.id} accessibilityRole="button" onPress={() => p.url && Linking.openURL(p.url)} style={s.rx}>
              {!isImageMime(p.mimeType) || !p.url ? <Icon name="document-text" size={28} /> : <Image source={{ uri: p.url }} style={{ flex: 1, width: '100%', borderRadius: radius.sm }} />}
            </Tap>))}</View> : null}
          {o.note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {o.note}</Text> : null}
        </Enter>

        <Enter index={4}>
          <Text style={[type.h3, s.sec]}>{t('order.deliveryTo')}</Text>
          <Text style={[type.body, { color: colors.text }]}>{o.address.recipientName} · {o.address.phone}</Text>
          <Text style={[type.body, { color: colors.secondary }]}>{[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, {o.address.city} - {o.address.pincode}</Text>
          <Text style={[type.bodyMedium, { color: colors.text, marginTop: 4 }]}>{formatDate(o.deliveryDate)} · {o.deliverySlot}</Text>
        </Enter>

        <Enter index={5}>
          <Text style={[type.h3, s.sec]}>{t('order.store')}</Text>
          <View style={s.infoRow}><Icon name="storefront" size={22} /><View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{o.store.name}</Text>{o.store.address ? <Text style={[type.small, { color: colors.secondary }]}>{o.store.address}</Text> : null}</View></View>
          {o.partner?.name ? <>
            <Text style={[type.h3, s.sec]}>{t('order.deliveryPartner')}</Text>
            <View style={s.infoRow}><Icon name="bicycle" size={22} /><View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{o.partner.name}</Text></View></View>
          </> : null}
          {o.quotedAmount !== null ? <>
            <Text style={[type.h3, s.sec]}>{t('order.payment')}</Text>
            <View style={s.infoRow}><Icon name="card" size={22} /><View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)}` : ''}</Text>
              {o.paymentStatus ? <Text style={[type.small, { color: colors.secondary }]}>{t('order.paymentStatus', { status: o.paymentStatus.replace(/_/g, ' ') })}</Text> : null}
            </View></View>
          </> : null}
          {o.bill ? <>
            <Text style={[type.h3, s.sec]}>{t('order.bill')}</Text>
            <View style={s.billCard}>
              <Icon name="document-text" size={28} />
              <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={1}>{o.bill.name}</Text><Text style={[type.small, { color: colors.secondary }]}>{fileBadge(o.bill.name, o.bill.mimeType)}{o.bill.uploadedAt ? ` · ${formatDateTime(o.bill.uploadedAt)}` : ''}</Text></View>
            </View>
            <View style={s.billBtns}>
              <Button small variant="outline" title={t('order.viewBill')} icon="eye" onPress={() => { if (o.bill?.viewUrl) void Linking.openURL(o.bill.viewUrl); }} disabled={!o.bill.viewUrl} style={{ flex: 1 }} />
              <Button small title={t('order.downloadBill')} icon="download" onPress={() => { if (o.bill?.downloadUrl) void Linking.openURL(o.bill.downloadUrl); }} disabled={!o.bill.downloadUrl} style={{ flex: 1 }} />
            </View>
          </> : null}
          {['ready_to_dispatch', 'out_for_delivery', 'delivered'].includes(o.status) && o.quotedAmount !== null ? (
            <Button title={t('order.invoice')} variant="outline" icon="receipt" onPress={async () => { try { const l = await endpoints.invoiceLink(o.id); await Linking.openURL(l.url); } catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); } }} style={{ marginTop: spacing.lg }} />
          ) : null}
          {o.deliveredAt ? <Text style={[type.bodyMedium, { color: colors.green, marginTop: spacing.md }]}>{t('order.deliveredOn', { time: formatDateTime(o.deliveredAt) })}</Text> : null}
          {o.history.length > 0 ? <>
            <Text style={[type.h3, s.sec]}>{t('order.activity')}</Text>
            {o.history.map((h, i) => <View key={i} style={s.actRow}><View style={s.actDot} /><View style={{ flex: 1 }}><Text style={[type.body, { color: colors.text }]}>{t(`status.${h.status}`)}</Text><Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(h.created_at)}{h.reason ? ` · ${h.reason}` : ''}</Text></View></View>)}
          </> : null}
          {storePhone ? <Button title={t('order.callStore')} variant="outline" icon="call" onPress={() => Linking.openURL(`tel:${storePhone}`)} style={{ marginTop: spacing.xl }} /> : null}
          {canCancel ? <Button title={t('order.cancel')} variant="danger" onPress={() => { setErr(''); setCancelOpen(true); }} style={{ marginTop: spacing.md }} /> : null}
          {o.status === 'ready_to_dispatch' || o.status === 'awaiting_payment' ? <Text style={[type.small, { color: colors.secondary, marginTop: spacing.sm }]}>{t('order.cancelNote')}</Text> : null}
        </Enter>
      </Screen>

      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={s.backdrop}>
          <Animated.View entering={ZoomIn.duration(280).springify().damping(14)} style={s.dialog}>
            <Text style={[type.h3, { color: colors.text }]}>{t('order.cancelTitle')}</Text>
            <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>{t('order.cancelReasonHelp')}</Text>
            <Animated.View style={shake}>
              <TextInput value={reason} onChangeText={setReason} multiline maxLength={300} placeholder={t('order.reasonPlaceholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('order.reasonPlaceholder')} style={[type.body, s.reason]} />
            </Animated.View>
            {err ? <Text style={[type.small, { color: colors.red, marginTop: 6 }]}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: spacing.lg }}>
              <Button title={t('common.back')} variant="outline" onPress={() => setCancelOpen(false)} style={{ flex: 1 }} />
              <Button title={t('order.confirmCancel')} variant="danger" onPress={cancel} loading={busy} style={{ flex: 1 }} />
            </View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

function PayOption({ selected, icon, title, sub, onPress }: { selected: boolean; icon: 'card' | 'cash'; title: string; sub: string; onPress: () => void }) {
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => { sel.value = withTiming(selected ? 1 : 0, { duration: 220 }); }, [selected, sel]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(sel.value, [0, 1], [1, 1.02]) }], backgroundColor: sel.value > 0.5 ? colors.card : colors.white, borderColor: sel.value > 0.5 ? colors.primary : colors.border }));
  return (
    <Tap accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} scaleTo={0.98} style={{ marginBottom: spacing.md }}>
      <Animated.View style={[s.opt, a]}>
        <View style={s.optIcon}><Icon name={icon === 'card' ? 'card' : 'cash'} size={28} color={colors.navy} /></View>
        <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{title}</Text><Text style={[type.small, { color: colors.secondary }]}>{sub}</Text></View>
        <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} size={26} color={selected ? colors.primary : colors.muted} />
      </Animated.View>
    </Tap>
  );
}

export function PaymentScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Payment'>) {
  const { t } = useTranslation();
  const phone = useSession((st) => st.user?.phone);
  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId));
  const [method, setMethod] = useState<PaymentMethod>('razorpay');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (loading && !data) return <DetailSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o: Order = data!.order;

  const pay = async () => {
    setBusy(true); setErr('');
    try {
      const res = await endpoints.acceptQuote(o.id, method);
      if (method === 'razorpay' && res.razorpay) {
        if (Platform.OS === 'web') throw new Error(t('pay.webUnsupported'));
        const Razorpay = (require('react-native-razorpay') as { default: { open(o: object): Promise<{ razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }> } }).default;
        let result;
        try {
          result = await Razorpay.open({ key: res.razorpay.keyId, amount: res.razorpay.amount, currency: res.razorpay.currency, order_id: res.razorpay.orderId, name: 'Kamal Medical Hall', description: `#${o.orderNumber}`, prefill: { contact: phone }, theme: { color: colors.primary } });
        } catch {
          throw new Error(t('pay.cancelledByUser')); // order stays "awaiting payment"; customer can retry from order details
        }
        await endpoints.verifyPayment(o.id, { razorpayOrderId: result.razorpay_order_id, razorpayPaymentId: result.razorpay_payment_id, razorpaySignature: result.razorpay_signature });
      }
      tick('success');
      navigation.replace('OrderDetail', { orderId: o.id });
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };

  return (
    <Screen footer={<Button title={method === 'cod' ? t('pay.confirmCod') : t('pay.payNow', { amount: formatMoney(o.quotedAmount ?? 0) })} icon={method === 'cod' ? 'checkmark' : 'lock-closed'} onPress={pay} loading={busy} />}>
      <Enter index={0}>
        <LinearGradient colors={[colors.card, '#D5E7FB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.amountCard}>
          <Text style={[type.small, { color: colors.secondary }]}>{t('order.amount')} · #{o.orderNumber}</Text>
          <CountUp value={o.quotedAmount ?? 0} prefix="₹" style={[type.h1, { color: colors.text, fontSize: 40, lineHeight: 54 }]} />
          <View style={s.row}><Icon name="bicycle" size={16} color={colors.green} /><Text style={[type.small, { color: colors.green }]}>{t('cart.freeDelivery')}</Text></View>
        </LinearGradient>
      </Enter>
      <Enter index={1}><PayOption selected={method === 'razorpay'} icon="card" title={t('pay.razorpay')} sub={t('pay.razorpaySub')} onPress={() => setMethod('razorpay')} /></Enter>
      <Enter index={2}><PayOption selected={method === 'cod'} icon="cash" title={t('pay.cod')} sub={t('pay.codSub')} onPress={() => setMethod('cod')} /></Enter>
      {err ? <Animated.Text entering={FadeIn.duration(250)} style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Animated.Text> : null}
    </Screen>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(async () => { const r = await endpoints.notifications(); void endpoints.markAllRead().catch(() => undefined); return r; }, ['notification']);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!data?.notifications.length) return <Message icon="notifications-off-outline" title={t('notifications.empty')} />;
  return (
    <Screen>
      {data.notifications.map((n, i) => (
        <Enter key={n.id} index={i}>
          <Card onPress={n.orderId ? () => nav.navigate('OrderDetail', { orderId: n.orderId! }) : undefined} style={[s.note, !n.read && { backgroundColor: colors.card }]}>
            <View style={s.row}>
              <View style={[s.noteDot, !n.read && { backgroundColor: colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>{n.title}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{n.body}</Text>
                <Text style={[type.small, { color: colors.muted, marginTop: 4 }]}>{formatDateTime(n.createdAt)}</Text>
              </View>
              {n.orderId ? <Icon name="chevron-forward" size={18} color={colors.muted} /> : null}
            </View>
          </Card>
        </Enter>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  segWrap: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chips: { gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center' },
  calIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  dateInput: { flex: 1, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, textAlign: 'center' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  billBtns: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  billCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  actRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 5 },
  actDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 7 },
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alert: { marginTop: spacing.md },
  quote: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.amberBg, gap: 2 },
  timeline: { flexDirection: 'row', marginTop: spacing.xl, marginBottom: spacing.sm },
  line: { position: 'absolute', top: 16, left: '10%', right: '10%', height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  lineFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  dotWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.primary },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: 4 },
  rxRow: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  rx: { width: 64, height: 80, borderRadius: radius.sm, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.xl },
  reason: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, textAlignVertical: 'top', color: colors.text },
  amountCard: { alignItems: 'center', padding: spacing.xl, borderRadius: radius.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.cardBorder },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg, borderWidth: 1.5, borderRadius: radius.lg },
  optIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  note: { marginBottom: spacing.sm, backgroundColor: colors.white, padding: spacing.md },
  noteDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
});
void withRepeat;
