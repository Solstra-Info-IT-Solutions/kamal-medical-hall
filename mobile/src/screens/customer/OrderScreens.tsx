import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { Order, OrderStatus, PaymentMethod } from '../../api/types';
import { Button, Card, ErrorView, Icon, Loading, Message, Pill, Screen } from '../../components/ui';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

export function OrdersScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Orders'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(() => endpoints.orders('completed'));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Text style={[type.h2, s.heading]}>{t('orders.title')}</Text>
      {loading && !data ? <Loading /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.orders.length ? <Message icon="receipt-outline" title={t('orders.emptyTitle')} text={t('orders.empty')} /> :
        <Screen>
          {data.orders.map((o) => (
            <Card key={o.id} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} style={s.orderRow}>
              <View style={s.thumb}><Icon name={o.kind === 'prescription' ? 'document-text-outline' : 'medkit-outline'} size={26} color={colors.secondary} /></View>
              <View style={{ flex: 1, marginHorizontal: spacing.md }}>
                <Text style={[type.bodyMedium, { color: colors.text }]}>#{o.orderNumber}</Text>
                <Text style={[type.small, { color: colors.secondary }]}>{formatDate(o.createdAt)}{o.quotedAmount !== null ? ` · ${formatMoney(o.quotedAmount)}` : ''}</Text>
              </View>
              <Pill text={t(`status.${o.status}`)} tone="green" />
            </Card>
          ))}
        </Screen>}
    </SafeAreaView>
  );
}

const STEPS: OrderStatus[] = ['requested', 'quoted', 'ready_to_dispatch', 'out_for_delivery', 'delivered'];
const stepIndex = (s: OrderStatus) => ({ requested: 0, quoted: 1, accepted: 2, awaiting_payment: 1, ready_to_dispatch: 2, out_for_delivery: 3, delivered: 4, rejected: -1, cancelled: -1 })[s];

export function OrderDetailScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'OrderDetail'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId));
  const config = useLoad(() => endpoints.config());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const o = data!.order;
  const idx = stepIndex(o.status);
  const canCancel = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'].includes(o.status);

  const cancel = async () => {
    if (reason.trim().length < 5) return setErr(t('order.reasonShort'));
    setBusy(true); setErr('');
    try { await endpoints.cancelOrder(o.id, reason.trim()); setCancelOpen(false); setReason(''); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const storePhone = config.data?.store.phone;

  return (
    <>
      <Screen footer={o.status === 'quoted' ? <Button title={t('order.acceptPay')} onPress={() => navigation.navigate('Payment', { orderId: o.id })} /> : o.status === 'awaiting_payment' ? <Button title={t('order.completePayment')} onPress={() => navigation.navigate('Payment', { orderId: o.id })} /> : undefined}>
        <View style={s.head}><Text style={[type.h2, { color: colors.text }]}>#{o.orderNumber}</Text><Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} /></View>
        <Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.createdAt)}</Text>

        {o.status === 'rejected' ? <Card style={[s.alert, { backgroundColor: colors.redBg }]}><Text style={[type.bodyMedium, { color: colors.red }]}>{t('order.rejected')}</Text><Text style={[type.body, { color: colors.text }]}>{o.rejectionReason}</Text></Card> : null}
        {o.status === 'cancelled' ? <Card style={[s.alert, { backgroundColor: colors.redBg }]}><Text style={[type.bodyMedium, { color: colors.red }]}>{t('order.cancelled')}</Text><Text style={[type.body, { color: colors.text }]}>{o.cancelReason}</Text></Card> : null}

        {idx >= 0 ? <View style={s.steps}>
          {STEPS.map((st, i) => (
            <View key={st} style={s.step}>
              <View style={[s.dot, i <= idx && s.dotOn]}>{i < idx || o.status === 'delivered' ? <Icon name="checkmark" size={14} color={colors.white} /> : null}</View>
              <Text style={[type.small, { color: i <= idx ? colors.text : colors.muted, textAlign: 'center' }]}>{t(`track.${st}`)}</Text>
            </View>
          ))}
        </View> : null}

        {o.status === 'requested' ? <Card style={s.alert}><Text style={[type.body, { color: colors.text }]}>{t('order.waitingReview')}</Text></Card> : null}
        {o.status === 'quoted' ? (
          <Card style={[s.alert, { backgroundColor: colors.amberBg, borderColor: colors.amberBg }]}>
            <Text style={[type.bodyMedium, { color: colors.amber }]}>{t('order.quoteReady')}</Text>
            <Text style={[type.h1, { color: colors.text }]}>{formatMoney(o.quotedAmount ?? 0)}</Text>
            <Text style={[type.small, { color: colors.secondary }]}>{t('cart.freeDelivery')}</Text>
            {o.quoteExpiresAt ? <Text style={[type.small, { color: colors.secondary }]}>{t('order.validTill', { time: formatDateTime(o.quoteExpiresAt) })}</Text> : null}
          </Card>
        ) : o.quotedAmount !== null ? <Text style={[type.bodyMedium, { color: colors.text, marginTop: spacing.md }]}>{t('order.amount')}: {formatMoney(o.quotedAmount)}{o.paymentMethod ? ` · ${t(`pay.${o.paymentMethod}`)}` : ''}</Text> : null}
        {o.status === 'out_for_delivery' && o.partner?.name ? <Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]}>{t('order.deliveredBy', { name: o.partner.name })}</Text> : null}

        <Text style={[type.h3, s.sec]}>{t('order.items')}</Text>
        {o.items.map((i) => <Text key={i.id} style={[type.body, { color: colors.text }]}>• {i.name} × {i.quantity}</Text>)}
        {o.prescriptions.length > 0 ? <View style={s.rxRow}>{o.prescriptions.map((p) => (
          <Pressable key={p.id} accessibilityRole="button" onPress={() => p.url && Linking.openURL(p.url)} style={s.rx}>
            {p.mimeType === 'application/pdf' || !p.url ? <Icon name="document-text" size={28} /> : <Image source={{ uri: p.url }} style={{ flex: 1, borderRadius: radius.sm }} />}
          </Pressable>))}</View> : null}
        {o.note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {o.note}</Text> : null}

        <Text style={[type.h3, s.sec]}>{t('order.deliveryTo')}</Text>
        <Text style={[type.body, { color: colors.text }]}>{o.address.recipientName} · {o.address.phone}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>{[o.address.line1, o.address.line2, o.address.landmark].filter(Boolean).join(', ')}, {o.address.city} - {o.address.pincode}</Text>
        <Text style={[type.bodyMedium, { color: colors.text, marginTop: 4 }]}>{formatDate(o.deliveryDate)} · {o.deliverySlot}</Text>

        {storePhone ? <Button title={t('order.callStore')} variant="outline" icon="call" onPress={() => Linking.openURL(`tel:${storePhone}`)} style={{ marginTop: spacing.xl }} /> : null}
        {canCancel ? <Button title={t('order.cancel')} variant="danger" onPress={() => { setErr(''); setCancelOpen(true); }} style={{ marginTop: spacing.md }} /> : null}
        {o.status === 'ready_to_dispatch' || o.status === 'awaiting_payment' ? <Text style={[type.small, { color: colors.secondary, marginTop: spacing.sm }]}>{t('order.cancelNote')}</Text> : null}
      </Screen>

      <Modal transparent visible={cancelOpen} animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.dialog}>
            <Text style={[type.h3, { color: colors.text }]}>{t('order.cancelTitle')}</Text>
            <Text style={[type.small, { color: colors.secondary, marginVertical: spacing.sm }]}>{t('order.cancelReasonHelp')}</Text>
            <TextInput value={reason} onChangeText={setReason} multiline maxLength={300} placeholder={t('order.reasonPlaceholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('order.reasonPlaceholder')} style={[type.body, s.reason]} />
            {err ? <Text style={[type.small, { color: colors.red, marginTop: 6 }]}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: spacing.lg }}>
              <Button title={t('common.back')} variant="outline" onPress={() => setCancelOpen(false)} style={{ flex: 1 }} />
              <Button title={t('order.confirmCancel')} variant="danger" onPress={cancel} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export function PaymentScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Payment'>) {
  const { t } = useTranslation();
  const phone = useSession((st) => st.user?.phone);
  const { data, error, loading, reload } = useLoad(() => endpoints.order(route.params.orderId));
  const [method, setMethod] = useState<PaymentMethod>('razorpay');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (loading && !data) return <Loading />;
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
      navigation.replace('OrderDetail', { orderId: o.id });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const opt = (m: PaymentMethod, icon: 'card' | 'cash', title: string, sub: string) => (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: method === m }} onPress={() => setMethod(m)} style={[s.opt, method === m && s.optOn]}>
      <Icon name={icon === 'card' ? 'card' : 'cash'} size={30} color={colors.navy} />
      <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{title}</Text><Text style={[type.small, { color: colors.secondary }]}>{sub}</Text></View>
      <Icon name={method === m ? 'radio-button-on' : 'radio-button-off'} size={26} color={method === m ? colors.primary : colors.muted} />
    </Pressable>
  );
  return (
    <Screen footer={<Button title={method === 'cod' ? t('pay.confirmCod') : t('pay.payNow', { amount: formatMoney(o.quotedAmount ?? 0) })} onPress={pay} loading={busy} />}>
      <Card style={{ alignItems: 'center', marginBottom: spacing.lg }}><Text style={[type.small, { color: colors.secondary }]}>{t('order.amount')} · #{o.orderNumber}</Text><Text style={[type.h1, { color: colors.text }]}>{formatMoney(o.quotedAmount ?? 0)}</Text></Card>
      {opt('razorpay', 'card', t('pay.razorpay'), t('pay.razorpaySub'))}
      {opt('cod', 'cash', t('pay.cod'), t('pay.codSub'))}
      {err ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{err}</Text> : null}
    </Screen>
  );
}

export function NotificationsScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(async () => { const r = await endpoints.notifications(); void endpoints.markAllRead().catch(() => undefined); return r; });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!data?.notifications.length) return <Message icon="notifications-off-outline" title={t('notifications.empty')} />;
  return (
    <Screen>
      {data.notifications.map((n) => (
        <Card key={n.id} onPress={n.orderId ? () => nav.navigate('OrderDetail', { orderId: n.orderId! }) : undefined} style={[s.note, !n.read && { backgroundColor: colors.card }]}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>{n.title}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{n.body}</Text>
          <Text style={[type.small, { color: colors.muted, marginTop: 4 }]}>{formatDateTime(n.createdAt)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  heading: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  orderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, backgroundColor: colors.white },
  thumb: { width: 52, height: 58, borderRadius: radius.sm, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  alert: { marginTop: spacing.md },
  steps: { flexDirection: 'row', marginTop: spacing.xl, marginBottom: spacing.sm },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.primary },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: 4 },
  rxRow: { flexDirection: 'row', gap: 10, marginTop: spacing.sm },
  rx: { width: 64, height: 80, borderRadius: radius.sm, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.xl },
  reason: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, textAlignVertical: 'top', color: colors.text },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.md },
  optOn: { borderColor: colors.primary, backgroundColor: colors.card },
  note: { marginBottom: spacing.sm, backgroundColor: colors.white, padding: spacing.md },
});
