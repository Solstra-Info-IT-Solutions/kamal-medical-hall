import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../../api/client';
import { otpProvider } from '../../auth/provider';
import { BackButton, Button, Icon, TextField } from '../../components/ui';
import { useSession } from '../../store/session';
import { colors, fonts, radius, spacing, type } from '../../theme';
import type { AuthStackParamList } from '../../navigation/types';

const logo = require('../../../assets/logo.png');
export const LEGAL_URL_NOTE = 'legal';

export function WelcomeScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, 'Welcome'>) {
  const { t } = useTranslation();
  const bootError = useSession((s) => s.bootError);
  return (
    <SafeAreaView style={s.fill}>
      <View style={s.welcomeTop}>
        <Image source={logo} style={s.welcomeLogo} resizeMode="contain" accessibilityLabel="Kamal Medical Hall" />
        <Text style={[type.h1, s.tagline]}>{t('brand.tagline')}</Text>
        {bootError ? <Text style={[type.small, { color: colors.red, textAlign: 'center', marginTop: 8 }]}>{bootError}</Text> : null}
      </View>
      <View style={s.art}>
        <Icon name="leaf" size={120} color="#BFE3C9" />
        <View style={s.artIcon}><Icon name="medkit" size={64} /></View>
      </View>
      <View style={{ padding: spacing.lg }}>
        <Button title={t('auth.start')} icon="arrow-forward" onPress={() => navigation.navigate('Login')} />
      </View>
    </SafeAreaView>
  );
}

const IndiaFlag = () => (
  <View style={s.flag}><View style={{ flex: 1, backgroundColor: '#FF9933' }} /><View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#000080' }} /></View><View style={{ flex: 1, backgroundColor: '#138808' }} /></View>
);

export function LoginScreen({ navigation }: NativeStackScreenProps<AuthStackParamList, 'Login'>) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = /^[6-9]\d{9}$/.test(phone);

  const submit = async () => {
    if (!valid) return setError(t('auth.invalidPhone'));
    setBusy(true); setError('');
    try {
      await otpProvider.sendOtp(phone);
      navigation.navigate('OTP', { phone });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('auth.sendFailed'));
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.fill}>
      <BackButton />
      <ScrollView contentContainerStyle={s.authBody} keyboardShouldPersistTaps="handled">
        <Image source={logo} style={s.authLogo} resizeMode="contain" />
        <Text style={[type.h2, s.center]}>{t('auth.loginTitle')}</Text>
        <Text style={[type.small, s.center, { color: colors.secondary, marginBottom: spacing.xl }]}>{t('auth.loginSubtitle')}</Text>
        <View style={[s.phoneBox, !!error && { borderColor: colors.red }]}>
          <IndiaFlag /><Text style={[type.bodyMedium, { marginHorizontal: 10 }]}>+91</Text>
          <TextInput value={phone} onChangeText={(v) => { setPhone(v.replace(/\D/g, '').slice(0, 10)); setError(''); }} keyboardType="number-pad" maxLength={10}
            placeholder="98765 43210" placeholderTextColor={colors.muted} accessibilityLabel={t('auth.phoneLabel')} style={s.phoneInput} autoFocus onSubmitEditing={submit} />
        </View>
        {error ? <Text style={[type.small, { color: colors.red, marginTop: 6 }]}>{error}</Text> : null}
        <Button title={t('auth.sendOtp')} onPress={submit} loading={busy} disabled={!valid} style={{ marginTop: spacing.lg }} />
        <Text style={[type.small, s.center, { color: colors.secondary, marginTop: spacing.xxxl }]}>{t('auth.consent')}</Text>
        <Pressable onPress={() => navigation.navigate('Legal')}><Text style={[type.smallMedium, s.center, { color: colors.primary }]}>{t('auth.consentLink')}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

export function OtpScreen({ route, navigation }: NativeStackScreenProps<AuthStackParamList, 'OTP'>) {
  const { t } = useTranslation();
  const { phone } = route.params;
  const login = useSession((st) => st.login);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(RESEND_SECONDS);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const verify = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy) return;
    setBusy(true); setError('');
    try {
      const token = await otpProvider.confirmOtp(value);
      await login(token); // routing to the right app happens from the server-assigned role
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === 'invalid_otp' ? t('auth.wrongOtp') : e.message) : t('auth.verifyFailed'));
      setCode('');
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setError('');
    try { await otpProvider.sendOtp(phone); setLeft(RESEND_SECONDS); } catch (e) { setError(e instanceof ApiError ? e.message : t('auth.sendFailed')); }
  };

  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0');
  return (
    <SafeAreaView style={s.fill}>
      <BackButton onPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.authBody} keyboardShouldPersistTaps="handled">
        <Image source={logo} style={s.authLogo} resizeMode="contain" />
        <Text style={[type.h2, s.center]}>{t('auth.otpTitle')}</Text>
        <Text style={[type.small, s.center, { color: colors.secondary, marginBottom: spacing.xl }]}>{t('auth.otpSubtitle', { phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` })}</Text>
        <Pressable onPress={() => input.current?.focus()} style={s.otpRow} accessibilityLabel={t('auth.otpLabel')}>
          {Array.from({ length: OTP_LENGTH }, (_, i) => (
            <View key={i} style={[s.otpBox, code.length === i && s.otpBoxActive, !!error && { borderColor: colors.red }]}><Text style={[type.h2, { color: colors.text }]}>{code[i] ?? ''}</Text></View>
          ))}
          <TextInput ref={input} value={code} autoFocus keyboardType="number-pad" maxLength={OTP_LENGTH} textContentType="oneTimeCode" autoComplete="sms-otp" style={s.otpHidden}
            onChangeText={(v) => { const c = v.replace(/\D/g, '').slice(0, OTP_LENGTH); setCode(c); setError(''); if (c.length === OTP_LENGTH) void verify(c); }} />
        </Pressable>
        {error ? <Text style={[type.small, s.center, { color: colors.red, marginTop: 8 }]}>{error}</Text> : null}
        {left > 0
          ? <Text style={[type.body, s.center, { color: colors.secondary, marginVertical: spacing.lg }]}>{t('auth.resendIn', { time: `${mm}:${ss}` })}</Text>
          : <Pressable onPress={resend} style={{ marginVertical: spacing.lg }}><Text style={[type.bodyMedium, s.center, { color: colors.primary }]}>{t('auth.resend')}</Text></Pressable>}
        <Button title={t('auth.verify')} onPress={() => verify()} loading={busy} disabled={code.length !== OTP_LENGTH} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function SignupScreen() {
  const { t } = useTranslation();
  const update = useSession((st) => st.updateProfile);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; api?: string }>({});

  const submit = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = t('validation.name');
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) next.email = t('validation.email');
    setErrors(next);
    if (next.name || next.email) return;
    setBusy(true);
    try { await update({ name: name.trim(), email: email.trim() }); } catch (e) { setErrors({ api: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={s.fill}>
      <ScrollView contentContainerStyle={s.authBody} keyboardShouldPersistTaps="handled">
        <Image source={logo} style={s.authLogo} resizeMode="contain" />
        <Text style={[type.h2, s.center]}>{t('signup.title')}</Text>
        <Text style={[type.small, s.center, { color: colors.secondary, marginBottom: spacing.xl }]}>{t('signup.subtitle')}</Text>
        <TextField label={t('signup.name')} value={name} onChangeText={setName} error={errors.name} autoCapitalize="words" textContentType="name" />
        <TextField label={t('signup.email')} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" />
        {errors.api ? <Text style={[type.small, { color: colors.red, marginBottom: 8 }]}>{errors.api}</Text> : null}
        <Button title={t('signup.continue')} onPress={submit} loading={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}

export function openUrl(url: string) { void Linking.openURL(url); }

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  center: { textAlign: 'center', color: colors.text },
  welcomeTop: { alignItems: 'center', paddingTop: spacing.xxxl, paddingHorizontal: spacing.xl },
  welcomeLogo: { width: 250, height: 250 },
  tagline: { color: colors.primaryDark, textAlign: 'center', marginTop: spacing.sm },
  art: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  artIcon: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.15, shadowRadius: 18, elevation: 4 },
  authBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  authLogo: { width: 190, height: 190, alignSelf: 'center', marginBottom: spacing.sm },
  phoneBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 56 },
  phoneInput: { flex: 1, fontFamily: fonts.medium, fontSize: 17, color: colors.text, paddingVertical: 10, outlineStyle: 'none' } as object,
  flag: { width: 28, height: 20, borderRadius: 3, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBox: { flex: 1, height: 58, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  otpBoxActive: { borderColor: colors.primary, borderWidth: 2 },
  otpHidden: { position: 'absolute', opacity: 0, width: '100%', height: '100%' },
});
