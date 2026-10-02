import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription, type UploadedFile } from '../../api/upload';
import { Button, Card, ErrorView, Icon, Loading, Screen } from '../../components/ui';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDayChip } from '../../utils';

export function DeliveryTimeScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'DeliveryTime'>) {
  const { t } = useTranslation();
  const { date, slotId } = useCart((s) => s.checkout);
  const setSlot = useCart((s) => s.setSlot);
  const { data, error, loading, reload } = useLoad(() => endpoints.config());
  const days = data?.deliveryDays ?? [];
  const [day, setDay] = useState<string | null>(date);

  useEffect(() => {
    if (!days.length) return;
    const first = days.find((d) => d.date === (day ?? date)) ?? days.find((d) => d.slots.some((x) => x.available)) ?? days[0];
    if (first.date !== day) setDay(first.date);
    // Drop a previously chosen slot that is no longer bookable.
    const chosen = first.slots.find((x) => x.id === slotId && first.date === date);
    if (date && slotId && !chosen?.available) useCart.setState((s) => ({ checkout: { ...s.checkout, date: null, slotId: null } }));
  }, [days, day, date, slotId]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const current = days.find((d) => d.date === day);
  const selectedHere = date === day ? slotId : null;
  return (
    <Screen footer={<Button title={t('time.review')} disabled={!date || !slotId} onPress={() => navigation.navigate('Review')} />}>
      {data && !data.store.isOpen ? <Text style={[type.small, { color: colors.red, marginBottom: spacing.md }]}>{t('time.storeClosed')}</Text> : null}
      <View style={s.days}>
        {days.map((d, i) => {
          const on = d.date === day; const label = formatDayChip(d.date, i);
          return (
            <Pressable key={d.date} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setDay(d.date)} style={[s.day, on && s.dayOn]}>
              <Text style={[type.smallMedium, { color: on ? colors.white : colors.secondary }]}>{label.top}</Text>
              <Text style={[type.smallMedium, { color: on ? colors.white : colors.text }]}>{label.bottom}</Text>
            </Pressable>
          );
        })}
      </View>
      {current?.slots.map((sl) => {
        const on = selectedHere === sl.id;
        return (
          <Pressable key={sl.id} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !sl.available }} disabled={!sl.available} onPress={() => setSlot(current.date, sl.id)} style={[s.slot, on && s.slotOn, !sl.available && { opacity: 0.4 }]}>
            <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={24} color={on ? colors.primary : colors.muted} />
            <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{sl.label}</Text>
            {!sl.available ? <Text style={[type.small, { color: colors.secondary }]}>{t('time.unavailable')}</Text> : null}
          </Pressable>
        );
      })}
      <Text style={[type.small, { color: colors.green, marginTop: spacing.md }]}>{t('cart.freeDelivery')}</Text>
    </Screen>
  );
}

// Uploaded prescription files are remembered per local file so a retry after a failed order submit does not re-upload.
const uploaded = new Map<string, UploadedFile>();

export function ReviewScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'Review'>) {
  const { t } = useTranslation();
  const cart = useCart();
  const { checkout, medicines, prescriptions, note } = cart;
  const addresses = useLoad(() => endpoints.addresses());
  const config = useLoad(() => endpoints.config());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const address = addresses.data?.addresses.find((a) => a.id === checkout.id);
  const slotLabel = config.data?.deliveryDays.find((d) => d.date === checkout.date)?.slots.find((x) => x.id === checkout.slotId)?.label;

  if ((addresses.loading || config.loading) && !addresses.data) return <Loading />;
  if (addresses.error || config.error) return <ErrorView message={(addresses.error ?? config.error)!} onRetry={() => { void addresses.reload(); void config.reload(); }} retryLabel={t('common.retry')} />;

  const submit = async () => {
    if (!address || !checkout.date || !checkout.slotId) return;
    setBusy(true); setError('');
    try {
      const kind = prescriptions.length ? 'prescription' : 'medicines';
      const files: UploadedFile[] = [];
      if (kind === 'prescription') {
        const sig = await endpoints.signUpload();
        for (const f of prescriptions) {
          let u = uploaded.get(f.id);
          if (!u) { u = await uploadPrescription(f, sig); uploaded.set(f.id, u); }
          files.push(u);
        }
      }
      const { order } = await endpoints.createOrder({
        kind, items: kind === 'medicines' ? medicines.map((m) => ({ name: m.name, quantity: m.quantity })) : [],
        prescriptions: files, note: note || undefined, addressId: address.id, deliveryDate: checkout.date, deliverySlot: checkout.slotId, idempotencyKey: cart.ensureKey(),
      });
      cart.clear(); uploaded.clear();
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }, { name: 'Success', params: { orderId: order.id, orderNumber: order.orderNumber } }] });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const row = (label: string, to: () => void, children: React.ReactNode) => (
    <Card style={{ marginBottom: spacing.md, backgroundColor: colors.white }}>
      <View style={s.rowHead}><Text style={[type.h3, { color: colors.text }]}>{label}</Text><Pressable accessibilityRole="button" onPress={to}><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('common.change')}</Text></Pressable></View>
      {children}
    </Card>
  );
  const count = prescriptions.length || medicines.length;
  return (
    <Screen footer={<Button title={t('review.send')} onPress={submit} loading={busy} />}>
      {row(t('review.items', { count }), () => navigation.navigate('Tabs', { screen: 'Cart' }), <>
        {prescriptions.map((f, i) => <Text key={f.id} style={[type.body, { color: colors.text }]}>• {t('cart.prescription')} {i + 1} <Text style={{ color: colors.secondary }}>({f.name})</Text></Text>)}
        {medicines.map((m) => <Text key={m.id} style={[type.body, { color: colors.text }]}>• {m.name} × {m.quantity}</Text>)}
        {note ? <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('review.note')}: {note}</Text> : null}
      </>)}
      {row(t('review.address'), () => navigation.navigate('Addresses', { select: true }), address ? <>
        <Text style={[type.bodyMedium, { color: colors.text }]}>{address.recipientName} · {address.phone}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>{[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>{address.city} - {address.pincode}</Text></> : <Text style={[type.body, { color: colors.red }]}>{t('review.noAddress')}</Text>)}
      {row(t('review.time'), () => navigation.navigate('DeliveryTime'), <Text style={[type.body, { color: colors.text }]}>{checkout.date ? formatDate(checkout.date) : ''}{slotLabel ? `\n${slotLabel}` : ''}</Text>)}
      <View style={s.info}><Icon name="information-circle" size={22} /><Text style={[type.small, { flex: 1, color: colors.text }]}>{t('review.info')}</Text></View>
      {error ? <Text style={[type.small, { color: colors.red, marginTop: spacing.md }]}>{error}</Text> : null}
    </Screen>
  );
}

export function SuccessScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Success'>) {
  const { t } = useTranslation();
  const { orderId, orderNumber } = route.params;
  const [copied, setCopied] = useState(false);
  return (
    <SafeAreaView style={s.successFill}>
      <View style={s.tick}><Icon name="checkmark-circle" size={110} color={colors.green} /></View>
      <Text style={[type.h1, { color: colors.text, textAlign: 'center' }]}>{t('success.title')}</Text>
      <Text style={[type.body, { color: colors.secondary, textAlign: 'center', marginTop: spacing.sm }]}>{t('success.sub')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('success.copy')} onPress={async () => { await Clipboard.setStringAsync(orderNumber); setCopied(true); }} style={s.orderBox}>
        <Icon name="receipt-outline" size={24} color={colors.navy} />
        <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]}>{t('success.orderNo')} #{orderNumber}</Text>
        <Icon name={copied ? 'checkmark' : 'copy-outline'} size={22} color={colors.primary} />
      </Pressable>
      <Button title={t('success.track')} onPress={() => navigation.replace('OrderDetail', { orderId })} style={{ alignSelf: 'stretch' }} />
      <Button title={t('success.home')} variant="outline" onPress={() => navigation.navigate('Tabs', { screen: 'Home' })} style={{ alignSelf: 'stretch', marginTop: spacing.md }} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  days: { flexDirection: 'row', gap: 8, marginBottom: spacing.lg },
  day: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  slotOn: { backgroundColor: colors.card, borderRadius: radius.md },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  info: { flexDirection: 'row', gap: 10, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#E7F5EC', alignItems: 'center' },
  successFill: { flex: 1, backgroundColor: colors.white, padding: spacing.xl, justifyContent: 'center', alignItems: 'center' },
  tick: { marginBottom: spacing.lg },
  orderBox: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginVertical: spacing.xl },
});
