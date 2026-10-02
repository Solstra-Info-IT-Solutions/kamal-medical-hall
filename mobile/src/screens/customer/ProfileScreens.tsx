import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { Enter, Tap } from '../../components/motion';
import { Button, Card, Icon, Loading, Message, Screen, TextField, type IconName } from '../../components/ui';
import { ApiError } from '../../api/client';
import { notice, showDialog } from '../../dialog';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

export function ProfileScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Profile'>) {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const { user, logout } = useSession();
  const deleteAccountApi = useSession((st) => st.deleteAccount);
  const logOut = async () => {
    const ok = await showDialog({ title: t('profile.logout'), message: t('profile.logoutMsg'), icon: 'log-out', tone: 'primary', confirmLabel: t('profile.logout'), cancelLabel: t('common.cancel') });
    if (ok) { useCart.getState().clear(); await logout(); }
  };
  const deleteAccount = async () => {
    const ok = await showDialog({ title: t('profile.deleteTitle'), message: t('profile.deleteMsg'), icon: 'trash', tone: 'danger', confirmLabel: t('profile.deleteConfirm'), cancelLabel: t('common.cancel'), acknowledge: t('profile.deleteAck') });
    if (!ok) return;
    try { useCart.getState().clear(); await deleteAccountApi(); } catch (e) { await notice(t('profile.deleteFailed'), e instanceof ApiError && e.code === 'active_orders' ? t('profile.deleteActive') : (e as Error).message, t('common.ok')); }
  };
  let rowIndex = 1;
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Enter index={rowIndex++}><Tap accessibilityRole="button" onPress={onPress} scaleTo={0.98} style={s.row}>
      <Icon name={icon} size={24} color={danger ? colors.red : colors.navy} />
      <Text style={[type.bodyMedium, { flex: 1, color: danger ? colors.red : colors.text }]}>{label}</Text>
      {!danger ? <Icon name="chevron-forward" size={20} color={colors.muted} /> : null}
    </Tap></Enter>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <Screen>
        <Enter index={0}><View style={s.avatarRow}>
          <View style={s.avatar}><Icon name="person" size={34} color={colors.white} /></View>
          <View style={{ flex: 1 }}><Text style={[type.h3, { color: colors.text }]}>{user?.name}</Text><Text style={[type.body, { color: colors.secondary }]}>+91 {user?.phone}</Text></View>
        </View></Enter>
        {row('create-outline', t('profile.edit'), () => nav.navigate('EditProfile'))}
        {row('location-outline', t('profile.addresses'), () => nav.navigate('Addresses'))}
        {row('notifications-outline', t('home.notifications'), () => nav.navigate('Notifications'))}
        {row('language-outline', t('profile.language'), () => nav.navigate('Language'))}
        {row('help-circle-outline', t('profile.help'), () => nav.navigate('Help'))}
        {row('document-text-outline', t('profile.legal'), () => nav.navigate('Legal'))}
        {row('log-out-outline', t('profile.logout'), logOut, true)}
        {row('trash-outline', t('profile.deleteAccount'), deleteAccount, true)}
      </Screen>
    </SafeAreaView>
  );
}

export function EditProfileScreen({ navigation }: { navigation: Nav }) {
  const { t } = useTranslation();
  const { user, updateProfile } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [errors, setErrors] = useState<{ name?: string; email?: string; api?: string }>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t('validation.name');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) e.email = t('validation.email');
    setErrors(e);
    if (e.name || e.email) return;
    setBusy(true);
    try { await updateProfile({ name: name.trim(), email: email.trim() }); navigation.goBack(); } catch (err) { setErrors({ api: (err as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('address.save')} onPress={save} loading={busy} />}>
      <TextField label={t('signup.name')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" />
      <TextField label={t('signup.email')} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" />
      <TextField label={t('profile.phone')} value={`+91 ${user?.phone ?? ''}`} editable={false} style={{ backgroundColor: colors.tint }} />
      {errors.api ? <Text style={[type.small, { color: colors.red }]}>{errors.api}</Text> : null}
    </Screen>
  );
}

/** Shared by every role. */
export function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const update = useSession((st) => st.updateProfile);
  const [err, setErr] = useState('');
  const choose = async (language: 'en' | 'hi') => {
    try { await update({ language }); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Screen>
      {(['hi', 'en'] as const).map((l) => (
        <Pressable key={l} accessibilityRole="radio" accessibilityState={{ selected: i18n.language === l }} onPress={() => choose(l)} style={[s.lang, i18n.language === l && { borderColor: colors.primary, backgroundColor: colors.card }]}>
          <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]}>{l === 'hi' ? 'हिन्दी' : 'English'}</Text>
          <Icon name={i18n.language === l ? 'radio-button-on' : 'radio-button-off'} size={24} color={i18n.language === l ? colors.primary : colors.muted} />
        </Pressable>
      ))}
      {err ? <Text style={[type.small, { color: colors.red }]}>{t('common.error')}: {err}</Text> : null}
    </Screen>
  );
}

export function HelpScreen() {
  const { t } = useTranslation();
  const { data, loading } = useLoad(() => endpoints.config());
  if (loading && !data) return <Loading />;
  const st = data?.store;
  return (
    <Screen>
      <Text style={[type.h3, { color: colors.text }]}>{t('brand.name')}</Text>
      <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.lg }]}>{st?.address ?? t('home.location')}</Text>
      {st?.phone ? <Button title={`${t('order.callStore')} · ${st.phone}`} icon="call" onPress={() => Linking.openURL(`tel:${st.phone}`)} style={{ marginBottom: spacing.md }} /> : null}
      {st?.email ? <Button title={st.email} variant="outline" icon="mail" onPress={() => Linking.openURL(`mailto:${st.email}`)} /> : null}
      {!st?.phone && !st?.email ? <Card><Text style={[type.body, { color: colors.secondary }]}>{t('help.pending')}</Text></Card> : null}
      <Text style={[type.small, { color: colors.secondary, marginTop: spacing.lg }]}>{st ? `${t('help.hours')}: ${st.openingTime} - ${st.closingTime}` : ''}</Text>
    </Screen>
  );
}

export function LegalScreen() {
  const { t } = useTranslation();
  return <Message icon="document-text-outline" title={t('legal.title')} text={t('legal.pending')} />;
}

const s = StyleSheet.create({
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: spacing.lg, marginBottom: spacing.sm },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.border },
  lang: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.md },
});
