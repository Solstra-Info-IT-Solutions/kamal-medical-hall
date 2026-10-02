import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import type { Address } from '../../api/types';
import { Button, Card, ErrorView, Icon, Loading, Message, Screen, TextField, type IconName } from '../../components/ui';
import { isSupportedPincode } from '../../constants/serviceArea';
import { confirmAsync } from '../../dialog';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { colors, radius, spacing, type } from '../../theme';

const LABEL_ICON: Record<Address['label'], IconName> = { home: 'home', office: 'briefcase', other: 'location' };
const line = (a: Address) => [a.line1, a.line2, a.landmark].filter(Boolean).join(', ');

export function AddressesScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'Addresses'>) {
  const { t } = useTranslation();
  const select = route.params?.select ?? false;
  const selected = useCart((s) => s.checkout.id);
  const setAddress = useCart((s) => s.setAddress);
  const { data, error, loading, reload } = useLoad(() => endpoints.addresses());
  const list = data?.addresses ?? [];

  useEffect(() => {
    if (select && list.length && !list.some((a) => a.id === selected)) setAddress(list[0].id);
  }, [select, list, selected, setAddress]);

  const remove = async (a: Address) => {
    if (!(await confirmAsync(t('address.deleteTitle'), t('address.deleteMsg'), t('common.delete'), t('common.cancel'), true))) return;
    try { await endpoints.deleteAddress(a.id); void reload(); } catch (e) { await confirmAsync(t('common.error'), (e as Error).message, t('common.ok'), t('common.cancel')); }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  return (
    <Screen footer={select ? <Button title={t('address.chooseTime')} disabled={!list.length} onPress={() => navigation.navigate('DeliveryTime')} /> : undefined}>
      {!list.length ? <View style={{ height: 260 }}><Message icon="location-outline" title={t('address.emptyTitle')} text={t('address.empty')} /></View> : null}
      {list.map((a) => {
        const on = select && selected === a.id;
        return (
          <Card key={a.id} onPress={select ? () => setAddress(a.id) : () => navigation.navigate('AddressForm', { addressId: a.id })} style={[s.card, on && s.cardOn]}>
            <Icon name={LABEL_ICON[a.label]} size={28} color={colors.navy} />
            <View style={{ flex: 1, marginHorizontal: spacing.md }}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>{t(`address.labels.${a.label}`)} · {a.recipientName}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{line(a)}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{a.city} - {a.pincode}</Text>
              <View style={s.actions}>
                <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AddressForm', { addressId: a.id })}><Text style={[type.smallMedium, { color: colors.primary }]}>{t('common.edit')}</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => remove(a)}><Text style={[type.smallMedium, { color: colors.red }]}>{t('common.delete')}</Text></Pressable>
              </View>
            </View>
            {select ? <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={26} color={on ? colors.primary : colors.muted} /> : null}
          </Card>
        );
      })}
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('AddressForm')} style={s.add}><Icon name="add" size={26} /><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('address.addNew')}</Text></Pressable>
      <Text style={[type.small, { color: colors.secondary, marginTop: spacing.md }]}>{t('address.areaNotice')}</Text>
    </Screen>
  );
}

export function AddressFormScreen({ navigation, route }: NativeStackScreenProps<CustomerStackParamList, 'AddressForm'>) {
  const { t } = useTranslation();
  const id = route.params?.addressId;
  const setAddress = useCart((s) => s.setAddress);
  const [loaded, setLoaded] = useState(!id);
  const [f, setF] = useState({ label: 'home' as Address['label'], recipientName: '', phone: '', line1: '', line2: '', landmark: '', pincode: '' });
  const [coords, setCoords] = useState<{ latitude?: number; longitude?: number }>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((c) => ({ ...c, [k]: v }));

  useEffect(() => {
    if (!id) return;
    void endpoints.addresses().then(({ addresses }) => {
      const a = addresses.find((x) => x.id === id);
      if (a) setF({ label: a.label, recipientName: a.recipientName, phone: a.phone, line1: a.line1, line2: a.line2 ?? '', landmark: a.landmark ?? '', pincode: a.pincode });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [id]);

  const useGps = async () => {
    setGpsBusy(true); setGpsError('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setGpsError(t('address.gpsDenied'));
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const [p] = await Location.reverseGeocodeAsync(pos.coords);
      if (!p) return setGpsError(t('address.gpsFailed'));
      setF((c) => ({ ...c, line1: c.line1 || [p.streetNumber, p.street].filter(Boolean).join(' ') || p.name || '', line2: c.line2 || p.district || p.subregion || '', pincode: p.postalCode ?? c.pincode }));
    } catch { setGpsError(t('address.gpsFailed')); } finally { setGpsBusy(false); }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    if (f.recipientName.trim().length < 2) e.recipientName = t('validation.name');
    if (!/^[6-9]\d{9}$/.test(f.phone)) e.phone = t('auth.invalidPhone');
    if (f.line1.trim().length < 3) e.line1 = t('validation.address');
    if (!/^\d{6}$/.test(f.pincode)) e.pincode = t('validation.pincode');
    else if (!isSupportedPincode(f.pincode)) e.pincode = t('validation.unsupportedPincode');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { label: f.label, recipientName: f.recipientName.trim(), phone: f.phone, line1: f.line1.trim(), line2: f.line2.trim() || undefined, landmark: f.landmark.trim() || undefined, pincode: f.pincode, ...coords };
    try {
      const { address } = id ? await endpoints.updateAddress(id, body) : await endpoints.addAddress(body);
      setAddress(address.id);
      navigation.goBack();
    } catch (err) { setErrors({ api: (err as Error).message }); } finally { setBusy(false); }
  };

  if (!loaded) return <Loading />;
  return (
    <Screen footer={<Button title={t('address.save')} onPress={save} loading={busy} />}>
      <View style={s.chips}>
        {(['home', 'office', 'other'] as const).map((l) => (
          <Pressable key={l} accessibilityRole="button" accessibilityState={{ selected: f.label === l }} onPress={() => setF((c) => ({ ...c, label: l }))} style={[s.chip, f.label === l && s.chipOn]}>
            <Icon name={LABEL_ICON[l]} size={18} color={f.label === l ? colors.white : colors.navy} /><Text style={[type.smallMedium, { color: f.label === l ? colors.white : colors.navy }]}>{t(`address.labels.${l}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={gpsBusy ? t('address.gpsBusy') : t('address.useGps')} variant="outline" icon="locate" onPress={useGps} loading={gpsBusy} style={{ marginBottom: spacing.sm }} />
      {gpsError ? <Text style={[type.small, { color: colors.red, marginBottom: spacing.sm }]}>{gpsError}</Text> : null}
      <TextField label={t('address.recipient')} value={f.recipientName} onChangeText={set('recipientName')} error={errors.recipientName} autoCapitalize="words" />
      <TextField label={t('address.phone')} value={f.phone} onChangeText={(v) => set('phone')(v.replace(/\D/g, '').slice(0, 10))} error={errors.phone} keyboardType="number-pad" />
      <TextField label={t('address.line1')} value={f.line1} onChangeText={set('line1')} error={errors.line1} />
      <TextField label={t('address.line2')} value={f.line2} onChangeText={set('line2')} />
      <TextField label={t('address.landmark')} value={f.landmark} onChangeText={set('landmark')} />
      <TextField label={t('address.pincode')} value={f.pincode} onChangeText={(v) => set('pincode')(v.replace(/\D/g, '').slice(0, 6))} error={errors.pincode} keyboardType="number-pad" />
      <Text style={[type.small, { color: colors.secondary }]}>{t('address.cityNote')}</Text>
      {errors.api ? <Text style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{errors.api}</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, backgroundColor: colors.white },
  cardOn: { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 1.5 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 6 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  chips: { flexDirection: 'row', gap: 10, marginBottom: spacing.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
