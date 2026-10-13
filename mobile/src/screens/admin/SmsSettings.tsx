import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { endpoints, type SmsSettings } from '../../api/endpoints';
import { TitleBadge } from '../../components/layout';
import { Tap, tick } from '../../components/motion';
import { Button, ButtonRow, Card, ErrorView, Icon, Loading, Pill, Screen, TextField } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import { colors, radius, spacing, type } from '../../theme';

const TYPES = ['TRANS', 'PROMO', 'OTP'];
type Form = { senderId: string; smsType: string; apiKey: string; otpTemplate: string; apiUrl: string };
const fromServer = (d: SmsSettings): Form => ({ senderId: d.senderId, smsType: d.smsType, apiKey: '', otpTemplate: d.otpTemplate, apiUrl: d.apiUrl });

/** Admin: the SMS gateway (PearlSMS) that sends the login OTP. Sender ID, SMS type, API key and the message are editable. */
export function SmsSettingsScreen() {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.sms());
  const [f, setF] = useState<Form | null>(null);
  const [saved, setSaved] = useState<SmsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => { if (data && !f) { setF(fromServer(data)); setSaved(data); } }, [data, f]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  if (!f || !saved) return <Loading />;
  const set = (k: keyof Form) => (v: string) => setF({ ...f, [k]: v });
  const missingOtp = !f.otpTemplate.includes('{otp}');
  const preview = f.otpTemplate.replaceAll('{otp}', '123456');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const next = await endpoints.admin.saveSms({ senderId: f.senderId, smsType: f.smsType, otpTemplate: f.otpTemplate, apiKey: f.apiKey.trim() || undefined, apiUrl: f.apiUrl.trim() || undefined });
      setSaved(next); setF(fromServer(next)); tick('success');
      await showDialog({ title: t('sms.savedTitle'), message: t('sms.savedMsg'), icon: 'checkmark-circle', confirmLabel: t('common.ok') });
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(false); }
  };
  const test = async () => {
    setTesting(true); setErr('');
    try {
      await endpoints.admin.testSms(testPhone);
      tick('success');
      await showDialog({ title: t('sms.testSentTitle'), message: t('sms.testSentMsg', { phone: testPhone }), icon: 'paper-plane', confirmLabel: t('common.ok') });
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setTesting(false); }
  };

  return (
    <Screen footer={<Button title={t('address.save')} icon="checkmark" onPress={save} loading={busy} disabled={missingOtp || !f.senderId.trim()} />}>
      <Card style={s.section}>
        <TitleBadge title={t('sms.gateway')} titleStyle={[type.h3, { color: colors.text }]} badge={<Pill text={saved.inUse ? t('sms.inUse') : t('sms.notInUse')} tone={saved.inUse ? 'green' : 'amber'} />} />
        <Text style={[type.small, { color: colors.secondary }]}>{saved.inUse ? t('sms.inUseHelp') : t('sms.notInUseHelp')}</Text>
      </Card>

      <Card style={s.section}>
        <TextField label={t('sms.senderId')} value={f.senderId} onChangeText={(v) => set('senderId')(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={11} hint={t('sms.senderIdHint')} />
        <Text style={[type.smallMedium, { color: colors.text, marginTop: spacing.sm }]}>{t('sms.smsType')}</Text>
        <View style={s.chips}>
          {[...new Set([...TYPES, f.smsType])].filter(Boolean).map((v) => {
            const on = f.smsType === v;
            return <Tap key={v} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => set('smsType')(v)} style={[s.chip, on && s.chipOn]}><Text style={[type.smallMedium, { color: on ? colors.white : colors.text }]}>{v}</Text></Tap>;
          })}
        </View>
        <TextField label={t('sms.otherType')} value={TYPES.includes(f.smsType) ? '' : f.smsType} onChangeText={(v) => set('smsType')(v.toUpperCase().replace(/[^A-Z_]/g, '') || 'TRANS')} autoCapitalize="characters" autoCorrect={false} placeholder="TRANS" />
        <TextField
          label={t('sms.apiKey')} value={f.apiKey} onChangeText={set('apiKey')} secureTextEntry autoCapitalize="none" autoCorrect={false}
          placeholder={saved.apiKeySet ? t('sms.keySaved', { hint: saved.apiKeyHint }) : t('sms.keyMissing')}
          hint={saved.apiKeySet ? t('sms.keyKeepHint') : undefined}
        />
      </Card>

      <Card style={s.section}>
        <TextField label={t('sms.template')} value={f.otpTemplate} onChangeText={set('otpTemplate')} multiline error={missingOtp ? t('sms.needsOtp') : undefined} hint={t('sms.templateHint')} />
        <View style={s.preview}>
          <Icon name="chatbox-ellipses-outline" size={20} color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colors.secondary }]}>{t('sms.preview')}</Text>
            <Text style={[type.body, { color: colors.text }]}>{preview}</Text>
          </View>
        </View>
        <TextField label={t('sms.apiUrl')} value={f.apiUrl} onChangeText={set('apiUrl')} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      </Card>

      <Card style={s.section}>
        <Text style={[type.h3, { color: colors.text }]}>{t('sms.testTitle')}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{t('sms.testHelp')}</Text>
        <TextField label={t('auth.phoneLabel')} value={testPhone} onChangeText={(v) => setTestPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={10} placeholder="98XXXXXXXX" />
        <ButtonRow>
          <Button small variant="outline" icon="paper-plane-outline" title={t('sms.sendTest')} onPress={test} loading={testing} disabled={testPhone.length !== 10} />
        </ButtonRow>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  section: { gap: spacing.sm, marginBottom: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, height: 36, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  preview: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.card },
});
