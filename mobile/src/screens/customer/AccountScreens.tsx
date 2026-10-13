import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { AccountRequest } from '../../api/types';
import { CheckRow, ChoiceChips } from '../../components/forms';
import { TitleBadge } from '../../components/layout';
import { Enter, tick } from '../../components/motion';
import { Button, ButtonRow, Card, Icon, Pill, Screen, TextField } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup } from '../../hooks';
import { onRealtime } from '../../realtime';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDateTime } from '../../utils';

const DEACTIVATE_REASONS = ['moving', 'notNeeded', 'otherStore', 'privacy', 'service', 'other'] as const;
const REACTIVATE_REASONS = ['needMedicines', 'changedMind', 'backInTown', 'other'] as const;

/** Keeps the account status current: the admin's decision arrives as a notification. */
function useLiveAccount() {
  const refresh = useSession((s) => s.refresh);
  useEffect(() => { void refresh(); return onRealtime('notification', () => { void refresh(); }); }, [refresh]);
}

const statusTone = (st: AccountRequest['status']) => (st === 'approved' ? 'green' : st === 'rejected' ? 'red' : st === 'pending' ? 'amber' : 'blue');

/** The latest request and what happened to it, with "Cancel request" while it is waiting. */
function RequestCard({ request }: { request: AccountRequest }) {
  const { t } = useTranslation();
  const refresh = useSession((s) => s.refresh);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const cancel = async () => {
    const ok = await showDialog({ title: t('account.cancelTitle'), message: t('account.cancelMsg'), icon: 'close-circle', confirmLabel: t('account.cancelRequest'), cancelLabel: t('common.back') });
    if (!ok) return;
    setBusy(true);
    try { await endpoints.cancelAccountRequest(request.id); tick('success'); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card style={s.card}>
      <TitleBadge title={t(request.kind === 'deactivate' ? 'account.deactivateRequest' : 'account.reactivateRequest')} titleStyle={[type.bodyMedium, { color: colors.text }]}
        badge={<Pill text={t(`account.status_${request.status}`)} tone={statusTone(request.status)} />} />
      <Text style={[type.small, { color: colors.secondary }]}>{t('account.sentOn', { date: formatDateTime(request.createdAt) })}</Text>
      <Text style={[type.body, { color: colors.text }]}>{request.reason}</Text>
      {request.details ? <Text style={[type.small, { color: colors.secondary }]}>{request.details}</Text> : null}
      {request.status === 'pending' ? <Text style={[type.small, { color: colors.amber }]}>{t('account.pendingHelp')}</Text> : null}
      {request.adminNote ? <View style={s.note}><Icon name="chatbox-ellipses-outline" size={18} color={colors.primary} /><Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('account.storeNote', { note: request.adminNote })}</Text></View> : null}
      {request.status === 'pending' ? <ButtonRow><Button small variant="outline" icon="close" title={t('account.cancelRequest')} onPress={cancel} loading={busy} /></ButtonRow> : null}
    </Card>
  );
}

/** The form: a reason (chips, or written), optional details, and for deactivation a confirmation tick. */
function RequestForm({ kind }: { kind: AccountRequest['kind'] }) {
  const { t } = useTranslation();
  const refresh = useSession((s) => s.refresh);
  const reasons = kind === 'deactivate' ? DEACTIVATE_REASONS : REACTIVATE_REASONS;
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [details, setDetails] = useState('');
  const [ack, setAck] = useState(kind === 'reactivate');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tried, setTried] = useState(false);
  useErrorPopup(err);
  const reasonText = reason === 'other' ? other.trim() : reason ? t(`account.r_${reason}`) : '';
  const ok = reasonText.length >= 3 && ack;
  const send = async () => {
    setTried(true);
    if (!ok) { tick('error'); return; }
    if (kind === 'deactivate') {
      const sure = await showDialog({ title: t('account.confirmTitle'), message: t('account.confirmMsg'), icon: 'person-remove', tone: 'danger', confirmLabel: t('account.send'), cancelLabel: t('common.cancel') });
      if (!sure) return;
    }
    setBusy(true); setErr('');
    try {
      await endpoints.requestAccountChange({ kind, reason: reasonText, details: details.trim() || undefined });
      tick('success');
      await refresh();
      await showDialog({ title: t('account.sentTitle'), message: t('account.sentMsg'), icon: 'paper-plane', confirmLabel: t('common.ok') });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Card style={s.card}>
      <Text style={[type.h3, { color: colors.text }]}>{t(kind === 'deactivate' ? 'account.deactivateTitle' : 'account.reactivateTitle')}</Text>
      <Text style={[type.small, { color: colors.secondary }]}>{t(kind === 'deactivate' ? 'account.deactivateHelp' : 'account.reactivateHelp')}</Text>
      <ChoiceChips label={t('account.reason')} value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r, label: t(`account.r_${r}`) }))} />
      {tried && !reason ? <Text style={[type.small, { color: colors.red, marginTop: -8 }]}>{t('account.chooseReason')}</Text> : null}
      {reason === 'other' ? <TextField label={t('account.otherReason')} value={other} onChangeText={setOther} maxLength={120} error={tried && other.trim().length < 3 ? t('account.chooseReason') : undefined} /> : null}
      <TextField label={t('account.details')} value={details} onChangeText={setDetails} multiline maxLength={1000} hint={t('account.detailsHint')} />
      {kind === 'deactivate' ? (
        <CheckRow checked={ack} onChange={setAck} error={tried && !ack}>
          <Text style={[type.small, { color: colors.text }]}>{t('account.ack')}</Text>
        </CheckRow>
      ) : null}
      <Button title={t('account.send')} icon="paper-plane-outline" variant={kind === 'deactivate' ? 'danger' : 'primary'} onPress={send} loading={busy} />
    </Card>
  );
}

/** Profile > Deactivate account: the request form, or the status of the request already sent. */
export function AccountStatusScreen() {
  const { t } = useTranslation();
  useLiveAccount();
  const request = useSession((s) => s.accountRequest);
  const pending = request?.status === 'pending' ? request : null;
  return (
    <Screen>
      <Enter index={0}>
        <View style={s.statusRow}>
          <View style={[s.puck, { backgroundColor: colors.greenBg }]}><Icon name="shield-checkmark" size={22} color={colors.green} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>{t('account.activeTitle')}</Text>
            <Text style={[type.small, { color: colors.secondary }]}>{t('account.activeHelp')}</Text>
          </View>
        </View>
      </Enter>
      {request ? <Enter index={1}><RequestCard request={request} /></Enter> : null}
      {!pending ? <Enter index={2}><RequestForm kind="deactivate" /></Enter> : null}
    </Screen>
  );
}

/** What a deactivated customer sees instead of the app: the status, the reactivation form, and sign out. */
export function DeactivatedScreen() {
  const { t } = useTranslation();
  useLiveAccount();
  const { user, accountRequest, logout } = useSession();
  const pending = accountRequest?.status === 'pending' ? accountRequest : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
      <Screen footer={<Button title={t('profile.logout')} variant="outline" icon="log-out-outline" onPress={() => { void logout(); }} />}>
        <Enter index={0}>
          <View style={s.hero}>
            <View style={[s.bigPuck, { backgroundColor: colors.redBg }]}><Icon name="person-remove" size={36} color={colors.red} /></View>
            <Text style={[type.h2, { color: colors.text, textAlign: 'center' }]}>{t('account.deactivatedTitle')}</Text>
            <Text style={[type.body, { color: colors.secondary, textAlign: 'center' }]}>{t('account.deactivatedHelp', { name: user?.name ?? '' })}</Text>
          </View>
        </Enter>
        {accountRequest ? <Enter index={1}><RequestCard request={accountRequest} /></Enter> : null}
        {!pending ? <Enter index={2}><RequestForm kind="reactivate" /></Enter> : null}
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, marginBottom: spacing.md },
  puck: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  bigPuck: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.card },
});
