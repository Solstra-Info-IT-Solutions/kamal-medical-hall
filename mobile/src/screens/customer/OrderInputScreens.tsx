import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Tap } from '../../components/motion';
import { Button, Card, Icon, Screen } from '../../components/ui';
import { useAutoFocus } from '../../hooks';
import type { CustomerStackParamList } from '../../navigation/types';
import { fileBadge, guessMime, isBlockedName, isImageMime } from '../../fileKinds';
import { MAX_FILE_BYTES, MAX_FILES, useCart, type PrescriptionFile } from '../../store/cart';
import { colors, radius, spacing, type } from '../../theme';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function UploadScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'Upload'>) {
  const { t } = useTranslation();
  const stored = useCart((s) => s.prescriptions);
  const medicines = useCart((s) => s.medicines);
  const setPrescriptions = useCart((s) => s.setPrescriptions);
  const setMedicines = useCart((s) => s.setMedicines);
  const [files, setFiles] = useState<PrescriptionFile[]>(stored);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const accept = (incoming: PrescriptionFile[]) => {
    const msgs: string[] = [];
    const ok: PrescriptionFile[] = [];
    let room = MAX_FILES - files.length;
    for (const f of incoming) {
      if (f.sizeBytes !== undefined && f.sizeBytes > MAX_FILE_BYTES) msgs.push(t('upload.tooLarge', { name: f.name }));
      else if (room <= 0) { if (!msgs.includes(t('upload.limit'))) msgs.push(t('upload.limit')); }
      else { ok.push(f); room -= 1; }
    }
    if (ok.length) setFiles((c) => [...c, ...ok]);
    setError(msgs.join('\n'));
  };

  const pickImages = async (source: 'camera' | 'gallery') => {
    if (files.length >= MAX_FILES) return setError(t('upload.limit'));
    setBusy(true); setError('');
    try {
      // The gallery uses the system photo picker, which needs no permission. Only the camera asks.
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setError(t('upload.permission'));
      }
      const res = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_FILES - files.length, quality: 0.8 });
      if (res.canceled) return;
      const out: PrescriptionFile[] = [];
      for (const a of res.assets) {
        const mimeType = guessMime(a.fileName ?? a.uri, a.mimeType ?? 'image/jpeg');
        const ext = (mimeType.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
        out.push({ id: uid(), uri: a.uri, name: a.fileName ?? `prescription.${ext}`, mimeType: isImageMime(mimeType) ? mimeType : 'image/jpeg', sizeBytes: a.fileSize });
      }
      accept(out);
    } catch { setError(t('upload.pickFailed')); } finally { setBusy(false); }
  };

  const pickFile = async () => {
    if (files.length >= MAX_FILES) return setError(t('upload.limit'));
    setError('');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
      if (res.canceled) return;
      const ok = res.assets.filter((a) => !isBlockedName(a.name));
      if (ok.length < res.assets.length) setError(t('upload.blocked'));
      accept(ok.map((a) => ({ id: uid(), uri: a.uri, name: a.name, mimeType: guessMime(a.name, a.mimeType), sizeBytes: a.size })));
    } catch { setError(t('upload.pickFailed')); }
  };

  const qty = (id: string, d: number) => setMedicines(medicines.map((x) => (x.id === id ? { ...x, quantity: Math.min(99, Math.max(1, x.quantity + d)) } : x)));

  const next = () => {
    if (!files.length) return setError(t('upload.needOne'));
    setPrescriptions(files);
    navigation.navigate('Tabs', { screen: 'Cart' });
  };

  const options: { icon: 'camera' | 'images' | 'document-text'; label: string; onPress: () => void }[] = [
    { icon: 'camera', label: t('upload.camera'), onPress: () => { void pickImages('camera'); } },
    { icon: 'images', label: t('upload.gallery'), onPress: () => { void pickImages('gallery'); } },
    { icon: 'document-text', label: t('upload.file'), onPress: () => { void pickFile(); } },
  ];

  return (
    <Screen footer={<Button title={t('common.next')} onPress={next} disabled={busy} />}>
      <Text style={[type.h3, { color: colors.text }]}>{t('upload.cardTitle')}</Text>
      <Text style={[type.small, { color: colors.secondary, marginBottom: spacing.md }]}>{t('upload.cardSub')}</Text>
      {files.length < MAX_FILES ? options.map((o) => (
        <Tap key={o.label} accessibilityRole="button" accessibilityLabel={o.label} onPress={o.onPress} disabled={busy} style={s.option}>
          <View style={s.optionIcon}><Icon name={o.icon} size={24} color={colors.primary} /></View>
          <Text style={[type.bodyMedium, { color: colors.text, flex: 1 }]}>{o.label}</Text>
          <Icon name="chevron-forward" size={20} color={colors.muted} />
        </Tap>
      )) : null}

      {files.length > 0 ? (
        <View style={s.strip}>
          {files.map((f) => (
            <View key={f.id} style={s.thumb}>
              {!isImageMime(f.mimeType) ? <View style={s.pdf}><Icon name="document-text" size={30} /><Text style={type.smallMedium}>{fileBadge(f.name, f.mimeType)}</Text></View> : <Image source={{ uri: f.uri }} style={s.img} />}
              <Pressable accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: f.name })} hitSlop={8} onPress={() => setFiles((c) => c.filter((x) => x.id !== f.id))} style={s.x}><Icon name="close" size={14} color={colors.white} /></Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <Text style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{error}</Text> : null}

      {files.length > 0 ? (
        <View style={{ marginTop: spacing.xl }}>
          <Text style={[type.h3, { color: colors.text }]}>{t('medicines.listTitle')}</Text>
          {medicines.map((m, i) => (
            <View key={m.id} style={s.row}>
              <View style={s.num}><Text style={[type.smallMedium, { color: colors.white }]}>{i + 1}</Text></View>
              <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]} numberOfLines={2}>{m.name}</Text>
              <View style={s.stepper}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.decrease', { name: m.name })} onPress={() => (m.quantity === 1 ? setMedicines(medicines.filter((y) => y.id !== m.id)) : qty(m.id, -1))} style={s.stepBtn}><Icon name={m.quantity === 1 ? 'trash-outline' : 'remove'} size={20} color={m.quantity === 1 ? colors.red : colors.navy} /></Pressable>
                <Text style={[type.bodyMedium, { minWidth: 26, textAlign: 'center' }]}>{m.quantity}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.increase', { name: m.name })} onPress={() => qty(m.id, 1)} style={s.stepBtn}><Icon name="add" size={20} color={colors.navy} /></Pressable>
              </View>
            </View>
          ))}
          <Tap accessibilityRole="button" onPress={() => navigation.navigate('TypeMedicines')} style={s.addNames}>
            <Icon name="add-circle" size={28} />
            <View style={{ flex: 1 }}>
              <Text style={[type.bodyMedium, { color: colors.primary }]}>{medicines.length ? t('medicines.addMore') : t('home.typeTitle')}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{t('home.typeSubtitle')}</Text>
            </View>
          </Tap>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg, gap: 4 }}>
        <Text style={[type.body, { color: colors.secondary }]}>• {t('upload.hint1')}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>• {t('upload.hint2', { max: MAX_FILES })}</Text>
        <Text style={[type.small, { color: colors.green, marginTop: spacing.sm }]}>{t('upload.notice')}</Text>
      </View>
    </Screen>
  );
}

export function TypeMedicinesScreen({ navigation }: NativeStackScreenProps<CustomerStackParamList, 'TypeMedicines'>) {
  const { t } = useTranslation();
  const stored = useCart((s) => s.medicines);
  const note = useCart((s) => s.note);
  const { setMedicines, setNote } = useCart.getState();
  const [rows, setRows] = useState(stored);
  const [text, setText] = useState('');
  const [instruction, setInstruction] = useState(note);
  const [error, setError] = useState('');
  const input = useRef<TextInput>(null);
  useAutoFocus(input);

  const add = () => {
    const name = text.trim();
    if (name.length < 2) return;
    if (rows.length >= 30) return setError(t('medicines.limit'));
    setRows((r) => r.some((x) => x.name.toLowerCase() === name.toLowerCase()) ? r.map((x) => x.name.toLowerCase() === name.toLowerCase() ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x) : [...r, { id: uid(), name, quantity: 1 }]);
    setText(''); setError('');
  };
  const qty = (id: string, d: number) => setRows((r) => r.map((x) => x.id === id ? { ...x, quantity: Math.min(99, Math.max(1, x.quantity + d)) } : x));

  const next = () => {
    const pending = text.trim().length >= 2;
    const final = pending ? [...rows, { id: uid(), name: text.trim(), quantity: 1 }] : rows;
    if (!final.length) return setError(t('medicines.needOne'));
    setMedicines(final); setNote(instruction.trim());
    navigation.goBack(); // back to the upload page, which lists the medicines
  };

  return (
    <Screen footer={<Button title={t('common.next')} onPress={next} />}>
      <View style={s.search}>
        <Icon name="search" size={22} color={colors.secondary} />
        <TextInput ref={input} value={text} onChangeText={setText} onSubmitEditing={add} blurOnSubmit={false} returnKeyType="done" maxLength={120} placeholder={t('medicines.placeholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('medicines.placeholder')} style={s.searchInput} />
        {text.trim().length >= 2 ? <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.addBtn')} onPress={add} hitSlop={8}><Icon name="add-circle" size={30} /></Pressable> : null}
      </View>
      <Text style={[type.small, { color: colors.secondary, marginTop: 6 }]}>{t('medicines.example')}</Text>
      {rows.length > 0 ? <Text style={[type.h3, { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }]}>{t('medicines.listTitle')}</Text> : null}
      {rows.map((r, i) => (
        <View key={r.id} style={s.row}>
          <View style={s.num}><Text style={[type.smallMedium, { color: colors.white }]}>{i + 1}</Text></View>
          <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]} numberOfLines={2}>{r.name}</Text>
          <View style={s.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.decrease', { name: r.name })} onPress={() => (r.quantity === 1 ? setRows((x) => x.filter((y) => y.id !== r.id)) : qty(r.id, -1))} style={s.stepBtn}><Icon name={r.quantity === 1 ? 'trash-outline' : 'remove'} size={20} color={r.quantity === 1 ? colors.red : colors.navy} /></Pressable>
            <Text style={[type.bodyMedium, { minWidth: 26, textAlign: 'center' }]}>{r.quantity}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.increase', { name: r.name })} onPress={() => qty(r.id, 1)} style={s.stepBtn}><Icon name="add" size={20} color={colors.navy} /></Pressable>
          </View>
        </View>
      ))}
      <Tap accessibilityRole="button" onPress={() => input.current?.focus()} style={s.addMore}><Icon name="add" size={22} /><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('medicines.addMore')}</Text></Tap>
      {error ? <Text style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{error}</Text> : null}
      <View style={s.instr}>
        <Icon name="create-outline" size={22} color={colors.navy} />
        <TextInput value={instruction} onChangeText={setInstruction} maxLength={300} multiline placeholder={t('medicines.instruction')} placeholderTextColor={colors.muted} accessibilityLabel={t('medicines.instruction')} style={[type.body, { flex: 1, color: colors.text, minHeight: 60, textAlignVertical: 'top' }]} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  drop: { alignItems: 'center', paddingVertical: spacing.xxl, borderRadius: radius.xl },
  camWrap: { width: 110, height: 110, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: 12, marginTop: spacing.lg },
  thumb: { width: 84, height: 108, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.tint },
  img: { flex: 1, borderRadius: radius.md },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  plus: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
  x: { position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card },
  optionIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  addNames: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderStyle: 'dashed' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { ...type.body, flex: 1, color: colors.text, paddingVertical: 8, outlineStyle: 'none' } as object,
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 4 },
  stepBtn: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  instr: { flexDirection: 'row', gap: 10, marginTop: spacing.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.tint },
});
