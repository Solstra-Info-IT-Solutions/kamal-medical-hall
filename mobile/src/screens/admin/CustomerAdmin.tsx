import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import type { AccountRequest, CustomerSummary, Gender } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { DobField, GenderChips, dobError, dobToIso, isoToDob } from '../../components/forms';
import { ListRow, TitleBadge } from '../../components/layout';
import { Enter, Skeleton, Tap, tick } from '../../components/motion';
import { Button, ButtonRow, Card, ErrorView, Icon, Message, Pill, Screen, TextField, type IconName } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import type { AdminStackParamList } from '../../navigation/types';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
type Status = 'all' | 'active' | 'deactivated';
const Skel = () => <View style={{ gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={84} r={16} />)}</View>;
const genderLabel = (g: Gender | null, t: (k: string) => string) => (g ? t(`register.${g}`) : null);

// ------------------------------------------------------------------ list
export function CustomersScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<Status>('all');
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(id); }, [q]);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.customers(term || undefined, status), ['notification']);
  useEffect(() => { void reload(); }, [term, status, reload]);
  const counts = data?.counts;
  const filters: { key: Status; label: string }[] = [
    { key: 'all', label: t('cust.all') },
    { key: 'active', label: counts ? `${t('cust.active')} (${counts.active})` : t('cust.active') },
    { key: 'deactivated', label: counts ? `${t('cust.deactivated')} (${counts.deactivated})` : t('cust.deactivated') },
  ];
  return (
    <Screen>
      <ButtonRow>
        <Button small icon="person-add-outline" title={t('cust.add')} onPress={() => nav.navigate('CustomerForm', undefined)} />
        <Button small variant="outline" icon="mail-unread-outline" title={counts?.pendingRequests ? `${t('cust.requests')} (${counts.pendingRequests})` : t('cust.requests')} onPress={() => nav.navigate('AccountRequests')} />
      </ButtonRow>
      <View style={s.search}>
        <Icon name="search" size={20} color={colors.secondary} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('cust.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('cust.search')} style={[type.body, s.searchInput]} />
      </View>
      <View style={s.filters}>
        {filters.map((f) => (
          <Tap key={f.key} accessibilityRole="button" accessibilityState={{ selected: status === f.key }} onPress={() => setStatus(f.key)} scaleTo={0.95} style={[s.chip, status === f.key && s.chipOn]}>
            <Text style={[type.smallMedium, { color: status === f.key ? colors.white : colors.navy }]}>{f.label}</Text>
          </Tap>
        ))}
      </View>
      {loading && !data ? <Skel /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />
        : !data!.customers.length ? <View style={{ height: 280 }}><Message icon="people-outline" title={t('admin.noCustomers')} /></View>
        : data!.customers.map((c, i) => (
          <Enter key={c.id} index={i}>
            <Card onPress={() => nav.navigate('CustomerDetail', { id: c.id, name: c.name ?? c.phone })} style={s.block}>
              <ListRow leading={<Avatar name={c.name} />} trailing={<CallButton phone={c.phone} compact label={t('admin.callCustomer')} />}>
                <TitleBadge title={c.name ?? '—'} titleStyle={[type.bodyMedium, { color: colors.text }]} badge={!c.isActive ? <Pill text={t('cust.deactivated')} tone="red" /> : c.pendingRequest ? <Pill text={t('cust.requestPending')} tone="amber" /> : null} />
                <Text style={[type.small, { color: colors.secondary }]}>+91 {c.phone}{c.city ? ` · ${c.city}` : ''}</Text>
                <Text style={[type.small, { color: colors.muted }]}>{t('admin.orderCount', { count: c.orderCount ?? 0 })} · {t('cust.joined', { date: formatDate(c.joinedAt) })}</Text>
              </ListRow>
            </Card>
          </Enter>))}
    </Screen>
  );
}

// ------------------------------------------------------------------ detail
function Stat({ icon, label, value, tone = 'blue' }: { icon: IconName; label: string; value: string; tone?: 'blue' | 'green' | 'amber' }) {
  const fg = tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : colors.primary;
  const bg = tone === 'green' ? colors.greenBg : tone === 'amber' ? colors.amberBg : colors.card;
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: bg }]}><Icon name={icon} size={20} color={fg} /></View>
      <Text style={[type.h2, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[type.small, { color: colors.secondary }]}>{label}</Text>
    </View>
  );
}
const Field = ({ label, value }: { label: string; value: string | null }) => (value ? (
  <View style={s.field}><Text style={[type.small, { color: colors.secondary, width: 110 }]}>{label}</Text><Text style={[type.body, { color: colors.text, flex: 1, minWidth: 0 }]}>{value}</Text></View>
) : null);

export function CustomerDetailScreen({ navigation, route }: NativeStackScreenProps<AdminStackParamList, 'CustomerDetail'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.customer(route.params.id), ['notification', 'order:update']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  if (loading && !data) return <Screen><Skel /></Screen>;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const d = data!;
  const c = d.customer;
  const pending = d.requests.find((r) => r.status === 'pending');
  const toggle = async () => {
    const ok = await showDialog(c.isActive
      ? { title: t('cust.deactivateTitle'), message: t('cust.deactivateMsg', { name: c.name ?? c.phone }), icon: 'person-remove', tone: 'danger', confirmLabel: t('cust.deactivate'), cancelLabel: t('common.cancel') }
      : { title: t('cust.activateTitle'), message: t('cust.activateMsg', { name: c.name ?? c.phone }), icon: 'person-add', confirmLabel: t('cust.activate'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    setBusy(true); setErr('');
    try { await endpoints.admin.setCustomerActive(c.id, !c.isActive, note.trim() || undefined); tick('success'); setNote(''); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Card style={s.block}>
        <ListRow leading={<Avatar name={c.name} size={56} />} trailing={<CallButton phone={c.phone} compact label={t('admin.callCustomer')} />} centered>
          <TitleBadge title={c.name ?? '—'} titleStyle={[type.h3, { color: colors.text }]} badge={<Pill text={c.isActive ? t('cust.active') : t('cust.deactivated')} tone={c.isActive ? 'green' : 'red'} />} />
          <Text style={[type.small, { color: colors.secondary }]}>+91 {c.phone}</Text>
          <Text style={[type.small, { color: colors.muted }]}>{t('admin.customerSince', { date: formatDate(c.joinedAt) })}</Text>
        </ListRow>
        <View style={{ marginTop: spacing.md, gap: 6 }}>
          <Field label={t('cust.email')} value={c.email} />
          <Field label={t('cust.gender')} value={genderLabel(c.gender, t)} />
          <Field label={t('cust.dob')} value={c.dateOfBirth ? formatDate(c.dateOfBirth) : null} />
          <Field label={t('cust.city')} value={c.city} />
          {d.addresses.map((a, i) => <Field key={i} label={i === 0 ? t('cust.addresses') : ''} value={a} />)}
          {!c.isActive && c.deactivatedAt ? <Field label={t('cust.deactivatedOn')} value={formatDateTime(c.deactivatedAt)} /> : null}
        </View>
        <ButtonRow style={{ marginTop: spacing.md }}>
          <Button small variant="outline" icon="create-outline" title={t('cust.edit')} onPress={() => navigation.navigate('CustomerForm', { id: c.id })} />
        </ButtonRow>
      </Card>

      {pending ? <RequestCard request={{ ...pending, customer: { id: c.id, name: c.name, phone: c.phone, isActive: c.isActive } }} onDone={reload} compact /> : null}

      <Card style={s.block}>
        <Text style={[type.h3, { color: colors.text }]}>{c.isActive ? t('cust.deactivateTitle') : t('cust.activateTitle')}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{c.isActive ? t('cust.deactivateHelp') : t('cust.activateHelp')}</Text>
        <TextField label={t('cust.noteForCustomer')} value={note} onChangeText={setNote} maxLength={300} />
        <ButtonRow>
          <Button small variant={c.isActive ? 'danger' : 'primary'} icon={c.isActive ? 'person-remove-outline' : 'person-add-outline'} title={c.isActive ? t('cust.deactivate') : t('cust.activate')} onPress={toggle} loading={busy} />
        </ButtonRow>
      </Card>

      <View style={s.statGrid}>
        <Stat icon="receipt" label={t('admin.cdOrders')} value={String(d.orderCount)} />
        <Stat icon="checkmark-done" label={t('admin.cdDelivered')} value={String(d.deliveredCount)} tone="green" />
        <Stat icon="cash" label={t('admin.cdLifetime')} value={formatMoney(d.lifetimeValue)} tone="amber" />
      </View>
      <Text style={[type.h3, s.sec]}>{t('admin.cdRecent')}</Text>
      {d.orders.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noOrders')}</Text> : d.orders.map((o) => (
        <Pressable key={o.id} accessibilityRole="button" onPress={() => navigation.navigate('OrderReview', { orderId: o.id })} style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={[type.bodyMedium, { color: colors.text }]}>#{o.orderNumber}</Text><Text style={[type.small, { color: colors.secondary }]}>{formatDateTime(o.createdAt)}{o.amount !== null ? ` · ${formatMoney(o.amount)}` : ''}</Text></View>
          <Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} />
        </Pressable>
      ))}
      {d.requests.length ? <Text style={[type.h3, s.sec]}>{t('cust.requestHistory')}</Text> : null}
      {d.requests.map((r) => (
        <View key={r.id} style={s.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>{t(r.kind === 'deactivate' ? 'account.deactivateRequest' : 'account.reactivateRequest')}</Text>
            <Text style={[type.small, { color: colors.secondary }]}>{r.reason} · {formatDateTime(r.createdAt)}</Text>
            {r.adminNote ? <Text style={[type.small, { color: colors.muted }]}>{r.adminNote}</Text> : null}
          </View>
          <Pill text={t(`account.status_${r.status}`)} tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'pending' ? 'amber' : 'blue'} />
        </View>
      ))}
    </Screen>
  );
}

// ------------------------------------------------------------------ add / edit
export function CustomerFormScreen({ navigation, route }: NativeStackScreenProps<AdminStackParamList, 'CustomerForm'>) {
  const { t } = useTranslation();
  const id = route.params?.id;
  const existing = useLoad(() => (id ? endpoints.admin.customer(id) : Promise.resolve(null)));
  const [loaded, setLoaded] = useState(!id);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'phone' | 'email' | 'dob', string>>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => {
    const c: CustomerSummary | undefined = existing.data?.customer;
    if (!c || loaded) return;
    setName(c.name ?? ''); setPhone(c.phone); setEmail(c.email ?? ''); setGender(c.gender); setDob(isoToDob(c.dateOfBirth)); setCity(c.city ?? '');
    setLoaded(true);
  }, [existing.data, loaded]);
  useEffect(() => { navigation.setOptions({ title: id ? t('cust.editTitle') : t('cust.addTitle') }); }, [navigation, id, t]);
  if (!loaded) return existing.error ? <ErrorView message={existing.error} onRetry={existing.reload} retryLabel={t('common.retry')} /> : <Screen><Skel /></Screen>;

  const save = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = t('validation.name');
    if (!id && !/^[6-9]\d{9}$/.test(phone)) next.phone = t('auth.invalidPhone');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t('validation.email');
    const de = dobError(dob);
    if (de) next.dob = de === 'range' ? t('register.dobRange') : t('register.dobFormat');
    setErrors(next);
    if (Object.values(next).some(Boolean)) { tick('error'); return; }
    const profile = { name: name.trim(), email: email.trim(), gender, dateOfBirth: dob ? dobToIso(dob) : null, city: city.trim() };
    setBusy(true); setErr('');
    try {
      if (id) await endpoints.admin.updateCustomer(id, profile);
      else {
        const { customer } = await endpoints.admin.addCustomer({ ...profile, phone });
        tick('success');
        navigation.replace('CustomerDetail', { id: customer.id, name: customer.name ?? customer.phone });
        return;
      }
      tick('success');
      navigation.goBack();
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} />}>
      {!id ? <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('cust.addHelp')}</Text> : null}
      <TextField label={t('register.name')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
      <TextField label={t('register.phone')} value={id ? `+91 ${phone}` : phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} error={errors.phone}
        editable={!id} keyboardType="number-pad" maxLength={id ? 14 : 10} placeholder="98765 43210" style={id ? { backgroundColor: colors.tint } : undefined} />
      <TextField label={t('register.email')} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <GenderChips value={gender} onChange={setGender} />
      <DobField value={dob} onChange={setDob} error={errors.dob} />
      <TextField label={t('register.city')} value={city} onChangeText={setCity} autoCapitalize="words" />
    </Screen>
  );
}

// ------------------------------------------------------------------ requests
type AdminRequest = AccountRequest & { customer: { id: string; name: string | null; phone: string; isActive: boolean } };

function RequestCard({ request: r, onDone, compact = false }: { request: AdminRequest; onDone: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const deactivate = r.kind === 'deactivate';
  const decide = async (approve: boolean) => {
    const who = r.customer.name ?? r.customer.phone;
    const ok = await showDialog({
      title: approve ? (deactivate ? t('cust.approveDeactivateTitle') : t('cust.approveReactivateTitle')) : t('cust.declineTitle'),
      message: approve ? (deactivate ? t('cust.approveDeactivateMsg', { name: who }) : t('cust.approveReactivateMsg', { name: who })) : t('cust.declineMsg', { name: who }),
      icon: approve ? (deactivate ? 'person-remove' : 'person-add') : 'close-circle', tone: approve && deactivate ? 'danger' : 'primary',
      confirmLabel: approve ? t('cust.approve') : t('cust.decline'), cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    setBusy(approve ? 'approve' : 'reject'); setErr('');
    try { await endpoints.admin.decideAccountRequest(r.id, approve, note.trim() || undefined); tick('success'); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Card style={[s.block, { gap: spacing.sm }]}>
      <ListRow leading={<View style={[s.puck, { backgroundColor: deactivate ? colors.redBg : colors.greenBg }]}><Icon name={deactivate ? 'person-remove' : 'person-add'} size={20} color={deactivate ? colors.red : colors.green} /></View>}>
        <TitleBadge title={t(deactivate ? 'account.deactivateRequest' : 'account.reactivateRequest')} titleStyle={[type.bodyMedium, { color: colors.text }]} badge={<Pill text={t(`account.status_${r.status}`)} tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : r.status === 'pending' ? 'amber' : 'blue'} />} />
        {!compact ? (
          <Tap accessibilityRole="link" onPress={() => nav.navigate('CustomerDetail', { id: r.customer.id, name: r.customer.name ?? r.customer.phone })} haptic={false}>
            <Text style={[type.small, { color: colors.primary }]}>{r.customer.name ?? '—'} · +91 {r.customer.phone}</Text>
          </Tap>
        ) : null}
        <Text style={[type.small, { color: colors.muted }]}>{formatDateTime(r.createdAt)}</Text>
      </ListRow>
      <View style={s.quote}>
        <Text style={[type.body, { color: colors.text }]}>{r.reason}</Text>
        {r.details ? <Text style={[type.small, { color: colors.secondary }]}>{r.details}</Text> : null}
      </View>
      {r.adminNote ? <Text style={[type.small, { color: colors.secondary }]}>{t('account.storeNote', { note: r.adminNote })}</Text> : null}
      {r.status === 'pending' ? <>
        <TextField label={t('cust.noteForCustomer')} value={note} onChangeText={setNote} maxLength={300} />
        <ButtonRow>
          <Button small variant={deactivate ? 'danger' : 'primary'} icon="checkmark" title={deactivate ? t('cust.approveDeactivate') : t('cust.approveReactivate')} onPress={() => { void decide(true); }} loading={busy === 'approve'} disabled={busy !== null} />
          <Button small variant="outline" icon="close" title={t('cust.decline')} onPress={() => { void decide(false); }} loading={busy === 'reject'} disabled={busy !== null} />
        </ButtonRow>
      </> : null}
    </Card>
  );
}

export function AccountRequestsScreen() {
  const { t } = useTranslation();
  const [which, setWhich] = useState<'pending' | 'all'>('pending');
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.accountRequests(which), ['notification']);
  useEffect(() => { void reload(); }, [which, reload]);
  return (
    <Screen>
      <View style={s.filters}>
        {(['pending', 'all'] as const).map((k) => (
          <Tap key={k} accessibilityRole="button" accessibilityState={{ selected: which === k }} onPress={() => setWhich(k)} scaleTo={0.95} style={[s.chip, which === k && s.chipOn]}>
            <Text style={[type.smallMedium, { color: which === k ? colors.white : colors.navy }]}>{k === 'pending' ? t('cust.pending') : t('cust.all')}</Text>
          </Tap>
        ))}
      </View>
      {loading && !data ? <Skel /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />
        : !data!.requests.length ? <View style={{ height: 280 }}><Message icon="checkmark-done-circle-outline" title={which === 'pending' ? t('cust.noPending') : t('cust.noRequests')} /></View>
        : data!.requests.map((r, i) => <Enter key={r.id} index={i}><RequestCard request={r} onDone={reload} /></Enter>)}
    </Screen>
  );
}

const s = StyleSheet.create({
  block: { marginBottom: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: spacing.md, paddingHorizontal: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, color: colors.text, outlineStyle: 'none' } as object,
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  field: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { flexGrow: 1, flexBasis: 140, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white, gap: 2 },
  statIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white },
  puck: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  quote: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card, gap: 4 },
});
