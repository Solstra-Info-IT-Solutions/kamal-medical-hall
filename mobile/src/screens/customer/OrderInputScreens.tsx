import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInRight, FadeOutLeft, LinearTransition, SlideInDown, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { Enter, Float, Ripples, Tap } from '../../components/motion';
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
  const setPrescriptions = useCart((s) => s.setPrescriptions);
  const [files, setFiles] = useState<PrescriptionFile[]>(stored);
  const [sheet, setSheet] = useState(false);
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

  /**
   * Closes the bottom sheet and waits until its window is really gone. On Android a system picker launched while the
   * Modal is still dismissing can lose its result, which made the pickers appear to do nothing.
   */
  const closeSheet = async () => {
    setSheet(false);
    await new Promise<void>((resolve) => setTimeout(resolve, Platform.OS === 'web' ? 0 : 450));
  };

  const pickImages = async (source: 'camera' | 'gallery') => {
    await closeSheet();
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
    await closeSheet();
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

  const next = async () => {
    if (!files.length) return setError(t('upload.needOne'));
    setPrescriptions(files);
    navigation.navigate('Tabs', { screen: 'Cart' });
  };

  return (
    <Screen footer={<Button title={t('common.next')} onPress={next} disabled={busy} />}>
      <Enter><Card onPress={() => (files.length >= MAX_FILES ? setError(t('upload.limit')) : setSheet(true))} style={s.drop}>
        <View style={s.camWrap}><Ripples size={100} count={2} /><Float amplitude={4} duration={1800}><Icon name="camera" size={64} /></Float></View>
        <Text style={[type.h3, { color: colors.text, marginTop: spacing.md }]}>{t('upload.cardTitle')}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{t('upload.cardSub')}</Text>
      </Card></Enter>
      <View style={s.strip}>
        {files.map((f) => (
          <Animated.View key={f.id} entering={ZoomIn.duration(320).springify().damping(12)} exiting={ZoomOut.duration(200)} layout={LinearTransition.springify()} style={s.thumb}>
            {!isImageMime(f.mimeType) ? <View style={s.pdf}><Icon name="document-text" size={30} /><Text style={type.smallMedium}>{fileBadge(f.name, f.mimeType)}</Text></View> : <Image source={{ uri: f.uri }} style={s.img} />}
            <Pressable accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: f.name })} onPress={() => setFiles((c) => c.filter((x) => x.id !== f.id))} style={s.x}><Icon name="close" size={14} color={colors.white} /></Pressable>
          </Animated.View>
        ))}
        {files.length > 0 && files.length < MAX_FILES ? <Animated.View entering={FadeIn.duration(300)} layout={LinearTransition.springify()}><Tap accessibilityRole="button" accessibilityLabel={t('upload.add')} onPress={() => setSheet(true)} style={[s.thumb, s.plus]}><Icon name="add" size={30} /></Tap></Animated.View> : null}
      </View>
      {error ? <Text style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{error}</Text> : null}
      <Enter index={2}><View style={{ marginTop: spacing.lg, gap: 4 }}>
        <Text style={[type.body, { color: colors.secondary }]}>• {t('upload.hint1')}</Text>
        <Text style={[type.body, { color: colors.secondary }]}>• {t('upload.hint2', { max: MAX_FILES })}</Text>
        <Text style={[type.small, { color: colors.green, marginTop: spacing.sm }]}>{t('upload.notice')}</Text>
      </View></Enter>
      <Modal transparent visible={sheet} animationType="fade" onRequestClose={() => setSheet(false)}>
        <Pressable style={s.backdrop} onPress={() => setSheet(false)}>
          <Animated.View entering={Platform.OS === 'web' ? FadeIn.duration(200) : SlideInDown.duration(320).springify().damping(18)} style={s.sheet}>
            {([['camera', 'upload.camera', () => pickImages('camera')], ['images', 'upload.gallery', () => pickImages('gallery')], ['document-text', 'upload.file', pickFile]] as const).map(([icon, label, fn]) => (
              <Pressable key={label} accessibilityRole="button" onPress={fn} style={s.sheetRow}><Icon name={icon} size={24} /><Text style={[type.bodyMedium, { color: colors.text }]}>{t(label)}</Text></Pressable>
            ))}
          </Animated.View>
        </Pressable>
      </Modal>
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
    navigation.navigate('Tabs', { screen: 'Cart' });
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
        <Animated.View key={r.id} entering={FadeInRight.duration(380).springify().damping(16)} exiting={FadeOutLeft.duration(220)} layout={LinearTransition.springify().damping(18)} style={s.row}>
          <View style={s.num}><Text style={[type.smallMedium, { color: colors.white }]}>{i + 1}</Text></View>
          <Text style={[type.bodyMedium, { flex: 1, color: colors.text }]} numberOfLines={2}>{r.name}</Text>
          <View style={s.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.decrease', { name: r.name })} onPress={() => (r.quantity === 1 ? setRows((x) => x.filter((y) => y.id !== r.id)) : qty(r.id, -1))} style={s.stepBtn}><Icon name={r.quantity === 1 ? 'trash-outline' : 'remove'} size={20} color={r.quantity === 1 ? colors.red : colors.navy} /></Pressable>
            <Text style={[type.bodyMedium, { minWidth: 26, textAlign: 'center' }]}>{r.quantity}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('medicines.increase', { name: r.name })} onPress={() => qty(r.id, 1)} style={s.stepBtn}><Icon name="add" size={20} color={colors.navy} /></Pressable>
          </View>
        </Animated.View>
      ))}
      <Animated.View layout={LinearTransition.springify().damping(18)}><Tap accessibilityRole="button" onPress={() => input.current?.focus()} style={s.addMore}><Icon name="add" size={22} /><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('medicines.addMore')}</Text></Tap></Animated.View>
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
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { ...type.body, flex: 1, color: colors.text, paddingVertical: 8, outlineStyle: 'none' } as object,
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 4 },
  stepBtn: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  addMore: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  instr: { flexDirection: 'row', gap: 10, marginTop: spacing.xl, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.tint },
});
