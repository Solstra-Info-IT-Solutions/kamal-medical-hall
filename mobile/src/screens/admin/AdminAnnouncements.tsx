import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import { uploadPrescription } from '../../api/upload';
import type { Announcement } from '../../api/types';
import { SourceOptions } from '../../components/SourceOptions';
import { Skeleton, Tap, tick } from '../../components/motion';
import { Button, Card, ErrorView, Icon, Message, Pill, Screen, TextField } from '../../components/ui';
import { showDialog } from '../../dialog';
import { useErrorPopup, useLoad } from '../../hooks';
import { colors, radius, spacing, type } from '../../theme';
import { formatDateTime } from '../../utils';

const DAYS = [1, 3, 7, 14, 30];
const MAX_IMAGES = 6;
/** End of the day, `n` days from now, as an ISO timestamp. */
const endOfDay = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(23, 59, 59, 0); return d.toISOString(); };
/** "2026-10-20" typed by the admin -> end of that day; null when it is not a future date. */
const parseDay = (v: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null; const d = new Date(`${v.trim()}T23:59:59`); return Number.isNaN(d.getTime()) || d.getTime() <= Date.now() ? null : d.toISOString(); };

interface Draft { key: number; title: string; body: string; images: { uri: string; name: string; mimeType: string }[]; days: number | null; custom: string }
const blank = (key: number): Draft => ({ key, title: '', body: '', images: [], days: 7, custom: '' });

function ExpiryPicker({ days, custom, onDays, onCustom }: { days: number | null; custom: string; onDays: (n: number | null) => void; onCustom: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <View>
      <Text style={[type.smallMedium, { color: colors.text, marginBottom: 6 }]}>{t('ann.expiresIn')} *</Text>
      <View style={s.chips}>
        {DAYS.map((n) => (
          <Tap key={n} accessibilityRole="radio" accessibilityState={{ selected: days === n }} onPress={() => { onDays(n); onCustom(''); }} style={[s.chip, days === n && s.chipOn]}>
            <Text style={[type.smallMedium, { color: days === n ? colors.white : colors.navy }]}>{t('ann.days', { count: n })}</Text>
          </Tap>
        ))}
      </View>
      <TextField label={t('ann.orDate')} value={custom} onChangeText={(v) => { onCustom(v); onDays(null); }} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" hint={t('ann.dateHint')} />
    </View>
  );
}

/** Announcements: prepare several, send them together; the sent ones stay saved here to send again, extend or delete. */
export function AnnouncementsScreen() {
  const { t } = useTranslation();
  const saved = useLoad(() => endpoints.admin.announcements(), ['announcement:update']);
  const [drafts, setDrafts] = useState<Draft[]>([blank(1)]);
  const [nextKey, setNextKey] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ id: string; days: number | null; custom: string } | null>(null);
  useErrorPopup(err);

  const patch = (key: number, p: Partial<Draft>) => setDrafts((d) => d.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const pick = async (key: number, source: 'camera' | 'gallery') => {
    setErr('');
    try {
      if (source === 'camera') { const perm = await ImagePicker.requestCameraPermissionsAsync(); if (!perm.granted) { setErr(t('upload.permission')); return; } }
      const res = source === 'camera' ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_IMAGES, quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      setDrafts((all) => all.map((d) => (d.key === key ? { ...d, images: [...d.images, ...res.assets.map((a, i) => ({ uri: a.uri, name: a.fileName ?? `announcement-${Date.now()}-${i}.jpg`, mimeType: a.mimeType?.startsWith('image/') ? a.mimeType : 'image/jpeg' }))].slice(0, MAX_IMAGES) } : d)));
    } catch { setErr(t('admin.billPickFailed')); }
  };

  const expiryOf = (d: { days: number | null; custom: string }) => (d.days ? endOfDay(d.days) : parseDay(d.custom));
  const valid = (d: Draft) => d.title.trim().length >= 2 && (d.body.trim().length >= 2 || d.images.length > 0) && !!expiryOf(d);
  const ready = drafts.length > 0 && drafts.every(valid);

  const sendAll = async () => {
    const ok = await showDialog({ title: t('ann.confirmTitle', { count: drafts.length }), message: t('ann.confirmMsg'), icon: 'megaphone', confirmLabel: t('ann.send'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    setBusy('send'); setErr('');
    try {
      const items = [];
      for (const d of drafts) {
        const images = [];
        if (d.images.length) {
          const sig = await endpoints.signUpload('announcement');
          const ups = await Promise.all(d.images.map((im, i) => uploadPrescription({ id: `ann-${d.key}-${i}`, ...im }, sig)));
          images.push(...ups.map((u) => ({ publicId: u.publicId, mimeType: u.mimeType, resourceType: u.resourceType, sizeBytes: u.sizeBytes })));
        }
        items.push({ title: d.title.trim(), body: d.body.trim(), images, expiresAt: expiryOf(d)! });
      }
      const r = await endpoints.admin.createAnnouncements(items);
      tick('success');
      setDrafts([blank(nextKey)]); setNextKey(nextKey + 1);
      await saved.reload();
      await showDialog({ title: t('ann.sentTitle'), message: t('ann.sentMsg', { count: items.length, people: r.sentTo }), icon: 'checkmark-circle', confirmLabel: t('common.ok') });
    } catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };

  const resend = async (a: Announcement) => {
    setBusy(`send-${a.id}`); setErr('');
    try { const r = await endpoints.admin.sendAnnouncement(a.id); tick('success'); await saved.reload(); await showDialog({ title: t('ann.resentTitle'), message: t('ann.resentMsg', { people: r.sentTo }), icon: 'checkmark-circle', confirmLabel: t('common.ok') }); }
    catch (e) { setErr((e as Error).message); tick('error'); } finally { setBusy(null); }
  };
  const remove = async (a: Announcement) => {
    const ok = await showDialog({ title: t('ann.deleteTitle'), message: t('ann.deleteMsg', { title: a.title }), icon: 'trash', tone: 'danger', confirmLabel: t('ann.delete'), cancelLabel: t('common.cancel') });
    if (!ok) return;
    setBusy(`del-${a.id}`); setErr('');
    try { await endpoints.admin.deleteAnnouncement(a.id); tick('success'); await saved.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const saveExpiry = async () => {
    if (!edit) return;
    const expiresAt = expiryOf(edit);
    if (!expiresAt) { setErr(t('ann.badDate')); tick('error'); return; }
    setBusy(`exp-${edit.id}`); setErr('');
    try { await endpoints.admin.updateAnnouncement(edit.id, { expiresAt }); tick('success'); setEdit(null); await saved.reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Screen footer={<Button title={t('ann.sendAll', { count: drafts.length })} icon="send" onPress={sendAll} loading={busy === 'send'} disabled={!ready || !!busy} />}>
      <Text style={[type.h3, s.sec]}>{t('ann.newTitle')}</Text>
      <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('ann.newHelp')}</Text>
      {drafts.map((d, i) => (
        <Card key={d.key} style={s.draft}>
          <View style={s.draftHead}><Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{t('ann.draftN', { n: i + 1 })}</Text>
            {drafts.length > 1 ? <Tap accessibilityRole="button" accessibilityLabel={t('ann.removeDraft')} hitSlop={10} onPress={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}><Icon name="close-circle" size={24} color={colors.muted} /></Tap> : null}</View>
          <TextField label={`${t('ann.titleField')} *`} value={d.title} onChangeText={(v) => patch(d.key, { title: v })} maxLength={80} />
          <TextField label={t('ann.body')} value={d.body} onChangeText={(v) => patch(d.key, { body: v })} multiline maxLength={1000} hint={d.images.length ? t('ann.bodyOptional') : t('ann.bodyRequired')} />
          <Text style={[type.smallMedium, { color: colors.text }]}>{t('ann.pictures')}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{d.images.length ? t('ann.asSlider') : t('ann.asNotification')}</Text>
          {d.images.length ? (
            <View style={s.thumbs}>{d.images.map((im, n) => (
              <View key={im.uri + n} style={s.thumb}><Image source={{ uri: im.uri }} style={s.thumbImg} />
                <Tap accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: im.name })} hitSlop={8} onPress={() => patch(d.key, { images: d.images.filter((_, k) => k !== n) })} style={s.thumbX}><Icon name="close" size={14} color={colors.white} /></Tap></View>
            ))}</View>
          ) : null}
          {d.images.length < MAX_IMAGES ? <SourceOptions options={[{ icon: 'images', label: t('upload.gallery'), onPress: () => { void pick(d.key, 'gallery'); } }, { icon: 'camera', label: t('upload.camera'), onPress: () => { void pick(d.key, 'camera'); } }]} /> : null}
          <View style={{ height: spacing.md }} />
          <ExpiryPicker days={d.days} custom={d.custom} onDays={(n) => patch(d.key, { days: n })} onCustom={(v) => patch(d.key, { custom: v })} />
        </Card>
      ))}
      {drafts.length < 10 ? <Button variant="outline" icon="add" title={t('ann.addAnother')} onPress={() => { setDrafts((all) => [...all, blank(nextKey)]); setNextKey(nextKey + 1); }} /> : null}

      <Text style={[type.h3, s.sec, { marginTop: spacing.xl }]}>{t('ann.savedTitle')}</Text>
      {saved.loading && !saved.data ? <View style={{ gap: 12 }}><Skeleton h={110} r={16} /><Skeleton h={110} r={16} /></View>
        : saved.error && !saved.data ? <ErrorView message={saved.error} onRetry={saved.reload} retryLabel={t('common.retry')} />
        : !saved.data?.announcements.length ? <Message icon="megaphone-outline" title={t('ann.none')} text={t('ann.noneHelp')} />
        : saved.data.announcements.map((a) => <SavedCard key={a.id} a={a} busy={busy} edit={edit?.id === a.id ? edit : null} setEdit={setEdit} onSave={saveExpiry} onResend={() => resend(a)} onDelete={() => remove(a)} />)}
    </Screen>
  );
}

function SavedCard({ a, busy, edit, setEdit, onSave, onResend, onDelete }: { a: Announcement; busy: string | null; edit: { id: string; days: number | null; custom: string } | null; setEdit: (e: { id: string; days: number | null; custom: string } | null) => void; onSave: () => void; onResend: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const first = a.images[0]?.url;
  return (
    <Card style={s.saved}>
      <View style={s.savedTop}>
        {first ? <Image source={{ uri: first }} style={s.savedImg} /> : <View style={[s.savedImg, s.savedIcon]}><Icon name="notifications" size={24} color={colors.primary} /></View>}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>{a.title}</Text>
          {a.body ? <Text style={[type.small, { color: colors.secondary }]} numberOfLines={2}>{a.body}</Text> : null}
          <View style={s.pills}>
            <Pill text={a.expired ? t('ann.expired') : t('ann.active')} tone={a.expired ? 'red' : 'green'} />
            <Pill text={a.hasImages ? t('ann.kindSlider', { count: a.images.length }) : t('ann.kindText')} tone="blue" />
          </View>
        </View>
      </View>
      <Text style={[type.small, { color: colors.secondary }]}>{a.expired ? t('ann.expiredOn', { date: formatDateTime(a.expiresAt) }) : t('ann.expiresOn', { date: formatDateTime(a.expiresAt) })} · {t('ann.sentTimes', { count: a.sendCount })}{a.lastSentAt ? ` · ${t('ann.lastSent', { date: formatDateTime(a.lastSentAt) })}` : ''}</Text>
      {a.expired ? <Text style={[type.small, { color: colors.amber }]}>{t('ann.expiredHelp')}</Text> : null}
      {edit ? (
        <View style={{ marginTop: spacing.sm }}>
          <ExpiryPicker days={edit.days} custom={edit.custom} onDays={(n) => setEdit({ ...edit, days: n })} onCustom={(v) => setEdit({ ...edit, custom: v })} />
          <View style={s.row}>
            <View style={s.rowBtn}><Button small variant="outline" title={t('common.cancel')} onPress={() => setEdit(null)} /></View>
            <View style={s.rowBtn}><Button small title={t('ann.saveDate')} icon="checkmark" loading={busy === `exp-${a.id}`} onPress={onSave} /></View>
          </View>
        </View>
      ) : (
        <View style={s.row}>
          <View style={s.rowBtn}><Button small title={t('ann.sendAgain')} icon="send" onPress={onResend} loading={busy === `send-${a.id}`} disabled={a.expired || !!busy} /></View>
          <View style={s.rowBtn}><Button small variant="outline" title={t('ann.editDate')} icon="calendar" onPress={() => setEdit({ id: a.id, days: 7, custom: '' })} disabled={!!busy} /></View>
          <View style={s.rowBtn}><Button small variant="danger" title={t('ann.delete')} icon="trash-outline" onPress={onDelete} loading={busy === `del-${a.id}`} disabled={!!busy} /></View>
        </View>
      )}
    </Card>
  );
}

const s = StyleSheet.create({
  sec: { color: colors.text, marginTop: spacing.sm },
  draft: { marginBottom: spacing.md },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  thumb: { width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card },
  thumbImg: { width: '100%', height: '100%' },
  thumbX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  saved: { marginTop: spacing.md, gap: 8 },
  savedTop: { flexDirection: 'row', gap: 12 },
  savedImg: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.card },
  savedIcon: { alignItems: 'center', justifyContent: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  rowBtn: { flexGrow: 1, flexBasis: 100 },
});
