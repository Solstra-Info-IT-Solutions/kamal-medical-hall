import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import type { ShopBranch, ShopDetails } from '../../api/types';
import { Tap, tick } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Loading as ListSkeleton, Screen, TextField } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import { colors, radius, spacing, type } from '../../theme';

const SERVICES = ['Home delivery', '24x7 emergency', 'Cold-chain medicines', 'Generic medicines', 'Ayurvedic & herbal', 'Surgical & health products', 'Lab test pickup', 'Senior citizen discount'];
const PAYMENTS = ['Cash', 'UPI', 'Debit / credit card', 'Net banking'];
type Form = {
  name: string; tagline: string; about: string; ownerName: string; establishedYear: string;
  line1: string; line2: string; area: string; landmark: string; city: string; state: string; pincode: string;
  latitude: string; longitude: string; mapsUrl: string;
  phones: { label: string; number: string }[]; whatsapp: string; email: string; website: string; hoursNote: string;
  drugLicense1: string; drugLicense2: string; drugLicenseValidTill: string; gstin: string; pan: string; fssai: string; pharmacistName: string; pharmacistRegNo: string;
  services: string[]; extraServices: string; paymentModes: string[];
  facebook: string; instagram: string;
  branches: { name: string; address: string; city: string; pincode: string; phone: string; hours: string; mapsUrl: string }[];
};

const fromServer = (d: ShopDetails | undefined, legacy?: { address?: string | null; phone?: string | null; email?: string | null; latitude?: number | null; longitude?: number | null }): Form => ({
  name: d?.name ?? '', tagline: d?.tagline ?? '', about: d?.about ?? '', ownerName: d?.ownerName ?? '', establishedYear: d?.establishedYear ? String(d.establishedYear) : '',
  line1: d?.address?.line1 ?? (d?.address ? '' : legacy?.address ?? ''), line2: d?.address?.line2 ?? '', area: d?.address?.area ?? '', landmark: d?.address?.landmark ?? '', city: d?.address?.city ?? '', state: d?.address?.state ?? '', pincode: d?.address?.pincode ?? '',
  latitude: String(d?.latitude ?? legacy?.latitude ?? ''), longitude: String(d?.longitude ?? legacy?.longitude ?? ''), mapsUrl: d?.mapsUrl ?? '',
  phones: d?.phones?.length ? d.phones.map((p) => ({ label: p.label ?? '', number: p.number ?? '' })) : [{ label: '', number: legacy?.phone ?? '' }],
  whatsapp: d?.whatsapp ?? '', email: d?.email ?? legacy?.email ?? '', website: d?.website ?? '', hoursNote: d?.hoursNote ?? '',
  drugLicense1: d?.licence?.drugLicense1 ?? '', drugLicense2: d?.licence?.drugLicense2 ?? '', drugLicenseValidTill: d?.licence?.drugLicenseValidTill ?? '', gstin: d?.licence?.gstin ?? '', pan: d?.licence?.pan ?? '', fssai: d?.licence?.fssai ?? '', pharmacistName: d?.licence?.pharmacistName ?? '', pharmacistRegNo: d?.licence?.pharmacistRegNo ?? '',
  services: (d?.services ?? []).filter((x) => SERVICES.includes(x)), extraServices: (d?.services ?? []).filter((x) => !SERVICES.includes(x)).join(', '), paymentModes: d?.paymentModes ?? [],
  facebook: d?.social?.facebook ?? '', instagram: d?.social?.instagram ?? '',
  branches: (d?.branches ?? []).map((b) => ({ name: b.name ?? '', address: b.address ?? '', city: b.city ?? '', pincode: b.pincode ?? '', phone: b.phone ?? '', hours: b.hours ?? '', mapsUrl: b.mapsUrl ?? '' })),
});

const toServer = (f: Form): ShopDetails => {
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return {
    name: f.name, tagline: f.tagline, about: f.about, ownerName: f.ownerName, establishedYear: f.establishedYear.trim() ? Number(f.establishedYear) : undefined,
    address: { line1: f.line1, line2: f.line2, area: f.area, landmark: f.landmark, city: f.city, state: f.state, pincode: f.pincode },
    latitude: num(f.latitude), longitude: num(f.longitude), mapsUrl: f.mapsUrl,
    phones: f.phones.filter((p) => p.number.trim()).map((p) => ({ label: p.label, number: p.number })), whatsapp: f.whatsapp, email: f.email, website: f.website, hoursNote: f.hoursNote,
    licence: { drugLicense1: f.drugLicense1, drugLicense2: f.drugLicense2, drugLicenseValidTill: f.drugLicenseValidTill, gstin: f.gstin, pan: f.pan, fssai: f.fssai, pharmacistName: f.pharmacistName, pharmacistRegNo: f.pharmacistRegNo },
    services: [...f.services, ...f.extraServices.split(',').map((x) => x.trim()).filter(Boolean)], paymentModes: f.paymentModes,
    social: { facebook: f.facebook, instagram: f.instagram },
    branches: f.branches.filter((b) => Object.values(b).some((v) => v.trim())) as ShopBranch[],
  };
};

function Section({ icon, title, hint, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card style={s.section}>
      <View style={s.sectionHead}><View style={s.puck}><Icon name={icon} size={20} color={colors.primary} /></View><Text style={[type.h3, { color: colors.text, flex: 1 }]}>{title}</Text></View>
      {hint ? <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.sm }]}>{hint}</Text> : null}
      {children}
    </Card>
  );
}

function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <Tap key={o} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])} style={[s.chip, on && s.chipOn]}>
            {on ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
            <Text style={[type.smallMedium, { color: on ? colors.white : colors.navy, flexShrink: 1 }]}>{o}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** The admin's editor for the shop profile. Every field is optional. */
export function ShopDetailsScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.shop());
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [gps, setGps] = useState(false);
  useErrorPopup(err);
  useEffect(() => { if (data && !f) setF(fromServer(data.details, data.legacy)); }, [data, f]);
  if (loading && !data) return <ListSkeleton />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f) return <ListSkeleton />;
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF({ ...f, [k]: v });

  const useHere = async () => {
    setGps(true); setErr('');
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { setErr(t('admin.gpsDenied')); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setF({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) });
      tick('success');
    } catch { setErr(t('address.gpsFailed')); } finally { setGps(false); }
  };
  const save = async () => {
    setBusy(true); setErr('');
    try { await endpoints.admin.saveShop(toServer(f)); tick('success'); await showDialog({ title: t('shop.savedTitle'), message: t('shop.savedMsg'), icon: 'checkmark-circle', confirmLabel: t('common.ok') }); } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };
  const setPhone = (i: number, k: 'label' | 'number', v: string) => setF({ ...f, phones: f.phones.map((p, n) => (n === i ? { ...p, [k]: v } : p)) });
  const setBranch = (i: number, k: keyof Form['branches'][number], v: string) => setF({ ...f, branches: f.branches.map((b, n) => (n === i ? { ...b, [k]: v } : b)) });
  const inp = (label: string, key: Exclude<keyof Form, 'phones' | 'services' | 'paymentModes' | 'branches'>, extra: object = {}) => <TextField label={label} value={f[key] as string} onChangeText={(v) => setF({ ...f, [key]: v })} {...extra} />;

  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('shop.optionalNote')}</Text>

      <Section icon="storefront" title={t('shop.secBasic')}>
        {inp(t('shop.name'), 'name')}
        {inp(t('shop.tagline'), 'tagline')}
        {inp(t('shop.about'), 'about', { multiline: true })}
        {inp(t('shop.owner'), 'ownerName', { autoCapitalize: 'words' })}
        {inp(t('shop.since'), 'establishedYear', { keyboardType: 'number-pad', maxLength: 4 })}
      </Section>

      <Section icon="location" title={t('shop.secAddress')}>
        {inp(t('shop.line1'), 'line1')}
        {inp(t('shop.line2'), 'line2')}
        {inp(t('shop.area'), 'area')}
        {inp(t('shop.landmark'), 'landmark')}
        {inp(t('shop.city'), 'city')}
        {inp(t('shop.state'), 'state')}
        {inp(t('shop.pincode'), 'pincode', { keyboardType: 'number-pad', maxLength: 6 })}
        <Button title={gps ? t('address.gpsBusy') : t('admin.useHere')} variant="outline" icon="locate" onPress={useHere} loading={gps} style={{ marginBottom: spacing.sm }} />
        {inp(t('admin.latitude'), 'latitude', { keyboardType: 'numbers-and-punctuation' })}
        {inp(t('admin.longitude'), 'longitude', { keyboardType: 'numbers-and-punctuation' })}
        {inp(t('shop.mapsUrl'), 'mapsUrl', { autoCapitalize: 'none', keyboardType: 'url' })}
      </Section>

      <Section icon="call" title={t('shop.secContact')} hint={t('shop.phonesHint')}>
        {f.phones.map((p, i) => (
          <View key={i} style={s.phoneBlock}>
            <TextField label={t('shop.phoneLabel')} value={p.label} onChangeText={(v) => setPhone(i, 'label', v)} placeholder={i === 0 ? t('shop.phoneShop') : ''} />
            <TextField label={`${t('address.phone')} ${i + 1}`} value={p.number} onChangeText={(v) => setPhone(i, 'number', v)} keyboardType="phone-pad" />
            {f.phones.length > 1 ? <Button small variant="ghost" icon="trash-outline" title={t('shop.remove')} onPress={() => setF({ ...f, phones: f.phones.filter((_, n) => n !== i) })} /> : null}
          </View>
        ))}
        {f.phones.length < 5 ? <Button small variant="outline" icon="add" title={t('shop.addPhone')} onPress={() => setF({ ...f, phones: [...f.phones, { label: '', number: '' }] })} style={{ marginBottom: spacing.md }} /> : null}
        {inp(t('shop.whatsapp'), 'whatsapp', { keyboardType: 'phone-pad' })}
        {inp(t('shop.email'), 'email', { keyboardType: 'email-address', autoCapitalize: 'none' })}
        {inp(t('shop.website'), 'website', { autoCapitalize: 'none', keyboardType: 'url' })}
        {inp(t('shop.hoursNote'), 'hoursNote', { multiline: true })}
        {inp(t('shop.facebook'), 'facebook', { autoCapitalize: 'none', keyboardType: 'url' })}
        {inp(t('shop.instagram'), 'instagram', { autoCapitalize: 'none', keyboardType: 'url' })}
      </Section>

      <Section icon="document-text" title={t('shop.secLicence')} hint={t('shop.licenceHint')}>
        {inp(t('shop.dl1'), 'drugLicense1', { autoCapitalize: 'characters' })}
        {inp(t('shop.dl2'), 'drugLicense2', { autoCapitalize: 'characters' })}
        {inp(t('shop.dlValid'), 'drugLicenseValidTill', { placeholder: 'DD/MM/YYYY' })}
        {inp(t('shop.pharmacist'), 'pharmacistName', { autoCapitalize: 'words' })}
        {inp(t('shop.pharmacistReg'), 'pharmacistRegNo', { autoCapitalize: 'characters' })}
        {inp(t('shop.gstin'), 'gstin', { autoCapitalize: 'characters', maxLength: 15 })}
        {inp(t('shop.pan'), 'pan', { autoCapitalize: 'characters', maxLength: 10, hint: t('shop.panHint') })}
        {inp(t('shop.fssai'), 'fssai', { keyboardType: 'number-pad' })}
      </Section>

      <Section icon="medkit" title={t('shop.secServices')}>
        <Chips options={SERVICES} value={f.services} onChange={set('services')} />
        <View style={{ height: spacing.sm }} />
        {inp(t('shop.otherServices'), 'extraServices', { hint: t('shop.commaHint') })}
        <Text style={[type.smallMedium, { color: colors.text, marginBottom: 8 }]}>{t('shop.payments')}</Text>
        <Chips options={PAYMENTS} value={f.paymentModes} onChange={set('paymentModes')} />
      </Section>

      <Section icon="git-branch" title={t('shop.secBranches')} hint={t('shop.branchesHint')}>
        {f.branches.map((b, i) => (
          <View key={i} style={s.branch}>
            <View style={s.branchHead}><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>{b.name || t('shop.branchN', { n: i + 1 })}</Text>
              <Tap accessibilityRole="button" accessibilityLabel={t('shop.remove')} hitSlop={10} onPress={() => setF({ ...f, branches: f.branches.filter((_, n) => n !== i) })}><Icon name="trash-outline" size={22} color={colors.red} /></Tap></View>
            <TextField label={t('shop.branchName')} value={b.name} onChangeText={(v) => setBranch(i, 'name', v)} />
            <TextField label={t('shop.branchAddress')} value={b.address} onChangeText={(v) => setBranch(i, 'address', v)} multiline />
            <TextField label={t('shop.city')} value={b.city} onChangeText={(v) => setBranch(i, 'city', v)} />
            <TextField label={t('shop.pincode')} value={b.pincode} onChangeText={(v) => setBranch(i, 'pincode', v)} keyboardType="number-pad" maxLength={6} />
            <TextField label={t('address.phone')} value={b.phone} onChangeText={(v) => setBranch(i, 'phone', v)} keyboardType="phone-pad" />
            <TextField label={t('shop.branchHours')} value={b.hours} onChangeText={(v) => setBranch(i, 'hours', v)} />
            <TextField label={t('shop.mapsUrl')} value={b.mapsUrl} onChangeText={(v) => setBranch(i, 'mapsUrl', v)} autoCapitalize="none" keyboardType="url" />
          </View>
        ))}
        {f.branches.length < 20 ? <Button small variant="outline" icon="add" title={t('shop.addBranch')} onPress={() => setF({ ...f, branches: [...f.branches, { name: '', address: '', city: '', pincode: '', phone: '', hours: '', mapsUrl: '' }] })} /> : null}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
  puck: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white, maxWidth: '100%' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  phoneBlock: { marginBottom: spacing.sm },
  branch: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, marginBottom: spacing.md },
  branchHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
});
