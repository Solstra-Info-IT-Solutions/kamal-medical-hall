import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import type { ExportKind } from '../../api/types';
import { Avatar, CallButton } from '../../components/CallButton';
import { AreaChart, Donut } from '../../components/charts';
import { ReviewCard } from '../../components/ReviewParts';
import { Skeleton, Tap, tick } from '../../components/motion';
import { ButtonRow, Button, Card, ErrorView, Icon, Message, Pill, Screen, TextField, type IconName } from '../../components/ui';
import { notice, showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import { useContentStyle } from '../../layout';
import type { AdminStackParamList } from '../../navigation/types';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, formatDateTime, formatMoney, statusTone } from '../../utils';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
const Skel = () => <View style={{ padding: spacing.lg, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={96} r={16} />)}</View>;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Opens a short-lived link so the phone's browser downloads the CSV report. */
export async function downloadExport(kind: ExportKind, days: number, t: (k: string) => string) {
  try { const { url } = await endpoints.admin.exportLink(kind, days); await Linking.openURL(url); }
  catch (e) { await notice(t('common.error'), (e as Error).message, t('common.ok')); }
}

function RangeChips({ value, onChange, options = [7, 30, 90] }: { value: number; onChange: (n: number) => void; options?: number[] }) {
  const { t } = useTranslation();
  return (
    <View style={s.chips}>
      {options.map((d) => (
        <Tap key={d} accessibilityRole="button" accessibilityState={{ selected: value === d }} onPress={() => onChange(d)} style={[s.chip, value === d && s.chipOn]}>
          <Text style={[type.smallMedium, { color: value === d ? colors.white : colors.navy }]}>{t('admin.lastDays', { count: d })}</Text>
        </Tap>
      ))}
    </View>
  );
}

function Stat({ icon, label, value, tone = 'blue' }: { icon: IconName; label: string; value: string; tone?: 'blue' | 'green' | 'amber' | 'red' }) {
  const fg = tone === 'green' ? colors.green : tone === 'amber' ? colors.amber : tone === 'red' ? colors.red : colors.primary;
  const bg = tone === 'green' ? colors.greenBg : tone === 'amber' ? colors.amberBg : tone === 'red' ? colors.redBg : colors.card;
  return (
    <View style={s.stat}>
      <View style={[s.statIcon, { backgroundColor: bg }]}><Icon name={icon} size={20} color={fg} /></View>
      <Text style={[type.h2, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[type.small, { color: colors.secondary }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Revenue
export function RevenueScreen() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.revenue(days), ['order:update']);
  const change = useCallback((n: number) => setDays(n), []);
  useEffect(() => { void reload(); }, [days, reload]);
  if (loading && !data) return <Skel />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const r = data!;
  const topQty = Math.max(1, ...r.topItems.map((i) => i.quantity));
  const palette = [colors.primary, colors.amber, colors.green, colors.navy];
  return (
    <Screen wide>
      <RangeChips value={days} onChange={change} />

      <LinearGradient colors={[colors.navy, colors.primary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <Text style={[type.small, { color: 'rgba(255,255,255,0.8)' }]}>{t('admin.revSales')} · {t('admin.lastDays', { count: days })}</Text>
        <Text style={[type.h1, { color: colors.white, fontSize: 38, lineHeight: 48 }]} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(r.sales)}</Text>
        <View style={s.heroRow}>
          <View style={s.heroStat}><Text style={s.heroNum}>{r.delivered}</Text><Text style={s.heroLabel}>{t('admin.revDelivered')}</Text></View>
          <View style={s.heroDivider} />
          <View style={s.heroStat}><Text style={s.heroNum} numberOfLines={1} adjustsFontSizeToFit>{formatMoney(r.avgOrder)}</Text><Text style={s.heroLabel}>{t('admin.revAvg')}</Text></View>
          <View style={s.heroDivider} />
          <View style={s.heroStat}><Text style={s.heroNum}>{r.ordersLost}/{r.ordersPlaced}</Text><Text style={s.heroLabel}>{t('admin.revLost')}</Text></View>
        </View>
      </LinearGradient>

      <Text style={[type.h3, s.sec]}>{t('admin.revDaily')}</Text>
      <Card>
        {r.daily.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noSales')}</Text> : (
          <AreaChart data={r.daily.map((d) => ({ label: formatDate(d.day), value: d.sales }))} format={formatMoney} />
        )}
      </Card>

      <Text style={[type.h3, s.sec]}>{t('admin.revSplit')}</Text>
      <Card>
        {r.paymentSplit.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noSales')}</Text> : (
          <Donut centerLabel={t('admin.revSales')} centerValue={formatMoney(r.paymentSplit.reduce((n, x) => n + x.sales, 0))} format={formatMoney}
            segments={r.paymentSplit.map((p, i) => ({ label: `${p.method ? t(`pay.${p.method}`) : '—'} · ${p.orders}`, value: p.sales, color: palette[i % palette.length]! }))} />
        )}
      </Card>

      <Text style={[type.h3, s.sec]}>{t('admin.revTop')}</Text>
      <Card>
        {r.topItems.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('admin.noSales')}</Text> : r.topItems.map((i, n) => (
          <View key={i.name} style={s.topItem}>
            <View style={[s.rank, n === 0 && { backgroundColor: colors.amber }]}><Text style={[type.smallMedium, { color: colors.white }]}>{n + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <View style={s.rowBetween}><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={2}>{i.name}</Text><Text style={[type.smallMedium, { color: colors.secondary }]}>{t('admin.revQty', { count: i.quantity })}</Text></View>
              <View style={s.track}><LinearGradient colors={[colors.primary, '#7AB8F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.trackFill, { width: `${Math.max(6, Math.round((i.quantity / topQty) * 100))}%` }]} /></View>
            </View>
          </View>
        ))}
      </Card>

      <Text style={[type.h3, s.sec]}>{t('admin.download')}</Text>
      <ButtonRow>
        <Button small variant="outline" icon="download" title={t('admin.exp_revenue')} onPress={() => { void downloadExport('revenue', days, t); }} style={{ flex: 1 }} />
        <Button small variant="outline" icon="download" title={t('admin.exp_orders')} onPress={() => { void downloadExport('orders', days, t); }} style={{ flex: 1 }} />
      </ButtonRow>
      <Button small variant="outline" icon="download" title={t('admin.exp_payments')} onPress={() => { void downloadExport('payments', days, t); }} style={{ marginTop: spacing.sm }} />
    </Screen>
  );
}

// ---------------------------------------------------------------- Exports
const EXPORTS: { kind: ExportKind; icon: IconName }[] = [
  { kind: 'revenue', icon: 'cash' }, { kind: 'orders', icon: 'receipt' }, { kind: 'payments', icon: 'card' },
  { kind: 'customers', icon: 'people' }, { kind: 'attendance', icon: 'calendar' }, { kind: 'reviews', icon: 'star' },
];
export function ExportsScreen() {
  const { t } = useTranslation();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  return (
    <Screen>
      <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.sm }]}>{t('admin.exportHelp')}</Text>
      <RangeChips value={days} onChange={setDays} options={[7, 30, 90, 365]} />
      {EXPORTS.map((e) => (
        <View key={e.kind} style={s.exportRow}>
          <View style={s.statIcon}><Icon name={e.icon} size={22} color={colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[type.bodyMedium, { color: colors.text }]}>{t(`admin.exp_${e.kind}`)}</Text>
            <Text style={[type.small, { color: colors.secondary }]}>{t(`admin.expHelp_${e.kind}`)}</Text>
          </View>
          <Button small icon="download" title={t('admin.csv')} loading={busy === e.kind} onPress={async () => { setBusy(e.kind); await downloadExport(e.kind, days, t); setBusy(null); }} />
        </View>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- Reviews moderation
export function AdminReviewsScreen() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.reviews(status), ['notification']);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  useEffect(() => { void reload(); }, [status, reload]);
  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    if (decision === 'rejected') {
      const ok = await showDialog({ title: t('reviews.rejectTitle'), message: t('reviews.rejectMsg'), icon: 'close-circle', tone: 'danger', confirmLabel: t('reviews.reject'), cancelLabel: t('common.cancel') });
      if (!ok) return;
    }
    setBusy(id); setErr('');
    try { await endpoints.admin.decideReview(id, decision, decision === 'rejected' ? t('reviews.defaultRejectNote') : undefined); tick('success'); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Screen>
      <View style={s.chips}>
        {(['pending', 'approved', 'rejected'] as const).map((k) => (
          <Tap key={k} accessibilityRole="button" accessibilityState={{ selected: status === k }} onPress={() => setStatus(k)} style={[s.chip, status === k && s.chipOn]}>
            <Text style={[type.smallMedium, { color: status === k ? colors.white : colors.navy }]}>{t(`reviews.status_${k}`)}</Text>
          </Tap>
        ))}
      </View>
      {loading && !data ? <Skel /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.reviews.length ? <View style={{ height: 280 }}><Message icon="star-outline" title={t('reviews.adminEmpty')} /></View> : data.reviews.map((r) => (
        <ReviewCard key={r.id} review={r} admin>
          {r.status === 'pending' ? (
            <ButtonRow style={{ marginTop: spacing.md }}>
              <Button small variant="danger" icon="close" title={t('reviews.reject')} loading={busy === r.id} onPress={() => { void decide(r.id, 'rejected'); }} style={{ flex: 1 }} />
              <Button small icon="checkmark" title={t('reviews.approve')} loading={busy === r.id} onPress={() => { void decide(r.id, 'approved'); }} style={{ flex: 1 }} />
            </ButtonRow>
          ) : null}
        </ReviewCard>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- Customer chats
export function AdminChatsScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const content = useContentStyle(true);
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.chatThreads(status), ['chat:message', 'chat:update']);
  useEffect(() => { void reload(); }, [status, reload]);
  return (
    <SafeAreaView style={s.fill} edges={['left', 'right', 'bottom']}>
      <View style={s.chips}>
        {(['open', 'closed'] as const).map((k) => (
          <Tap key={k} accessibilityRole="button" accessibilityState={{ selected: status === k }} onPress={() => setStatus(k)} style={[s.chip, status === k && s.chipOn]}>
            <Text style={[type.smallMedium, { color: status === k ? colors.white : colors.navy }]}>{t(`admin.chat_${k}`)}</Text>
          </Tap>
        ))}
        {data ? <Pill text={data.adminBusy ? t('admin.chatBusy') : t('admin.chatFree')} tone={data.adminBusy ? 'amber' : 'green'} /> : null}
      </View>
      {loading && !data ? <Skel /> : error && !data ? <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} /> : !data?.threads.length ? <Message icon="chatbubbles-outline" title={t('admin.noChats')} /> : (
        <ScrollView contentContainerStyle={[{ padding: spacing.lg }, content]} refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />}>
          {data.threads.map((th) => (
            <Pressable key={th.id} accessibilityRole="button" onPress={() => nav.navigate('AdminChat', { threadId: th.id, name: th.customerName ?? th.customerPhone })} style={s.threadRow}>
              <Avatar name={th.customerName} />
              <View style={{ flex: 1 }}>
                <View style={s.rowBetween}><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={2}>{th.customerName ?? th.customerPhone}</Text><Text style={[type.small, { color: colors.muted }]}>{clock(th.lastMessageAt)}</Text></View>
                <Text style={[type.small, { color: colors.secondary }]} numberOfLines={2}>{th.lastBody}</Text>
                <View style={s.pillRow}>
                  {th.status === 'open' ? <Pill text={th.state === 'active' ? t('admin.chatActive') : t('admin.chatWaiting', { position: th.position })} tone={th.state === 'active' ? 'green' : 'amber'} /> : <Pill text={t('admin.chat_closed')} tone="blue" />}
                  {th.orderNumber ? <Pill text={`#${th.orderNumber}`} tone="blue" /> : null}
                </View>
              </View>
              {th.unread > 0 ? <View style={s.badge}><Text style={s.badgeText}>{th.unread}</Text></View> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function AdminChatScreen({ navigation, route }: NativeStackScreenProps<AdminStackParamList, 'AdminChat'>) {
  const { t } = useTranslation();
  const { data, error, loading, reload } = useLoad(() => endpoints.admin.chatThread(route.params.threadId), ['chat:message']);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const scroller = useRef<ScrollView>(null);
  const open = data?.thread.status === 'open';
  const send = async (body: string) => {
    const msg = body.trim();
    if (!msg || sending) return;
    setSending(true); setErr('');
    try { await endpoints.admin.chatReply(route.params.threadId, msg); setText(''); tick(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  };
  const close = async () => {
    const ok = await showDialog({ title: t('admin.chatCloseTitle'), message: t('admin.chatCloseMsg'), icon: 'checkmark-done', confirmLabel: t('admin.chatClose'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    try { await endpoints.admin.chatClose(route.params.threadId); await reload(); } catch (e) { setErr((e as Error).message); }
  };
  if (loading && !data) return <Skel />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const th = data!.thread;
  const quick = [t('admin.quick1'), t('admin.quick2'), t('admin.quick3')];
  return (
    <SafeAreaView style={s.fill} edges={['bottom', 'left', 'right']}>
      <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={s.chatHead}>
          <Avatar name={th.customerName} />
          <View style={{ flex: 1 }}><Text style={[type.bodyMedium, { color: colors.text }]}>{th.customerName ?? th.customerPhone}</Text><Text style={[type.small, { color: colors.secondary }]}>+91 {th.customerPhone}</Text></View>
          <CallButton phone={th.customerPhone} compact label={t('admin.callCustomer')} />
          {th.orderId ? <Tap accessibilityRole="button" accessibilityLabel={t('admin.openOrder')} onPress={() => navigation.navigate('OrderReview', { orderId: th.orderId! })} style={s.round}><Icon name="receipt" size={20} color={colors.primary} /></Tap> : null}
          {open ? <Tap accessibilityRole="button" accessibilityLabel={t('admin.chatClose')} onPress={() => { void close(); }} style={s.round}><Icon name="checkmark-done" size={20} color={colors.green} /></Tap> : null}
        </View>
        <ScrollView ref={scroller} style={s.fill} contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
          {data!.messages.map((m) => (
            <View key={m.id} style={[s.msgRow, m.role === 'admin' ? { justifyContent: 'flex-end' } : { justifyContent: 'flex-start' }]}>
              <View style={[s.bubble, m.role === 'admin' ? s.mine : m.role === 'bot' ? s.bot : s.theirs]}>
                {m.role === 'bot' ? <Text style={[type.small, { color: colors.primary }]}>{t('chat.assistant')}</Text> : null}
                <Text style={[type.body, { color: m.role === 'admin' ? colors.white : colors.text }]}>{m.body}</Text>
                <Text style={[{ fontSize: 11, alignSelf: 'flex-end', marginTop: 2 }, { color: m.role === 'admin' ? '#DCE9FF' : colors.muted }]}>{clock(m.createdAt)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        {open ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRow} style={{ flexGrow: 0, flexShrink: 0 }}>
              {quick.map((q) => <Tap key={q} accessibilityRole="button" onPress={() => { void send(q); }} style={s.quickChip}><Text style={[type.small, { color: colors.navy }]}>{q}</Text></Tap>)}
            </ScrollView>
            <View style={s.composer}>
              <TextInput value={text} onChangeText={setText} placeholder={t('admin.replyPlaceholder')} placeholderTextColor={colors.muted} multiline maxLength={1000} accessibilityLabel={t('admin.replyPlaceholder')} style={[type.body, s.input]} />
              <Pressable accessibilityRole="button" accessibilityLabel={t('chat.send')} disabled={sending || !text.trim()} onPress={() => { void send(text); }} style={[s.sendBtn, (sending || !text.trim()) && { opacity: 0.45 }]}><Icon name="send" size={22} color={colors.white} /></Pressable>
            </View>
          </>
        ) : <Text style={[type.small, { color: colors.secondary, textAlign: 'center', padding: spacing.md }]}>{t('admin.chatIsClosed')}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Customer detail
// ---------------------------------------------------------------- Announcement to every customer
export function BroadcastScreen({ navigation }: NativeStackScreenProps<AdminStackParamList, 'Broadcast'>) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useErrorPopup(err);
  const ok = title.trim().length >= 2 && body.trim().length >= 2;
  const send = async () => {
    const yes = await showDialog({ title: t('admin.broadcastConfirmTitle'), message: t('admin.broadcastConfirmMsg'), icon: 'megaphone', confirmLabel: t('admin.broadcastSend'), cancelLabel: t('common.cancel') });
    if (!yes) return;
    setBusy(true); setErr('');
    try { const r = await endpoints.admin.broadcast(title.trim(), body.trim()); tick('success'); await notice(t('admin.broadcastDone'), t('admin.broadcastDoneMsg', { count: r.sent }), t('common.ok')); navigation.goBack(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Screen footer={<Button title={t('admin.broadcastSend')} icon="megaphone" onPress={send} loading={busy} disabled={!ok} />}>
      <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('admin.broadcastHelp')}</Text>
      <TextField label={t('admin.broadcastTitle')} value={title} onChangeText={setTitle} maxLength={60} placeholder={t('admin.broadcastTitlePh')} />
      <TextField label={t('admin.broadcastBody')} value={body} onChangeText={setBody} maxLength={240} multiline placeholder={t('admin.broadcastBodyPh')} />
      <Text style={[type.small, { color: colors.muted }]}>{body.length} / 240</Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  chip: { height: 38, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sec: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: spacing.md },
  stat: { flexGrow: 1, flexBasis: '45%', padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white, gap: 2 },
  statIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  hero: { marginTop: spacing.md, borderRadius: 24, padding: spacing.lg, gap: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.25)' },
  heroStat: { flex: 1, alignItems: 'center', gap: 2 },
  heroNum: { ...type.bodyMedium, color: colors.white, fontSize: 17 },
  heroLabel: { ...type.small, color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  heroDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.25)' },
  topItem: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.md },
  rank: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 2 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '80%', maxWidth: 18, minWidth: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: colors.primary },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.card, marginTop: 6, overflow: 'hidden' },
  trackFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  btnRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  exportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white },
  pillRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  chatHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  msgRow: { flexDirection: 'row', marginBottom: spacing.sm },
  bubble: { maxWidth: '82%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.lg },
  mine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  bot: { backgroundColor: colors.amberBg, borderBottomLeftRadius: 4 },
  quickRow: { gap: 8, paddingHorizontal: spacing.md, paddingVertical: 6 },
  quickChip: { paddingHorizontal: 14, height: 36, borderRadius: radius.pill, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, color: colors.text },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
