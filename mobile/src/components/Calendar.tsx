import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { colors, fonts, radius, spacing, type } from '../theme';
import { Tap, tick } from './motion';
import { Button, Icon } from './ui';

/**
 * The KMH calendar. Every date in the app is chosen with it.
 *  - Dates are "YYYY-MM-DD" strings in local (India) time, so there is no time-zone drift.
 *  - Days outside `min`/`max` are shown faded and cannot be picked (for example the past, for an expiry date).
 *  - It opens on the chosen date, or on today (selected) when nothing is chosen yet and today is allowed.
 *  - Tapping the month and year opens a year list, for dates far away such as a date of birth.
 */
export type IsoDate = string;

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number): IsoDate => `${y}-${pad(m + 1)}-${pad(d)}`; // m is 0-based
export const todayIso = (): IsoDate => { const n = new Date(); return toIso(n.getFullYear(), n.getMonth(), n.getDate()); };
export const addDaysIso = (iso: IsoDate, days: number): IsoDate => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y!, m! - 1, d! + days); return toIso(t.getFullYear(), t.getMonth(), t.getDate()); };
const parts = (iso: IsoDate) => { const [y, m, d] = iso.split('-').map(Number); return { y: y!, m: m! - 1, d: d! }; };
export const isIsoDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const MONTHS: Record<string, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const WEEKDAYS: Record<string, string[]> = { en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'], hi: ['र', 'सो', 'मं', 'बु', 'गु', 'शु', 'श'] };
const lang = (l: string) => (l.startsWith('hi') ? 'hi' : 'en');

/** "21 Mar 1994" (or the Hindi month) for showing a chosen date. */
export function formatIso(iso: IsoDate | null | undefined, language = 'en'): string {
  if (!isIsoDate(iso)) return '';
  const { y, m, d } = parts(iso);
  const month = MONTHS[lang(language)]![m]!;
  return `${d} ${lang(language) === 'en' ? month.slice(0, 3) : month} ${y}`;
}

interface CalendarProps {
  visible: boolean;
  value: IsoDate | null;
  min?: IsoDate;
  max?: IsoDate;
  title?: string;
  onSelect: (v: IsoDate) => void;
  onClose: () => void;
}

function Day({ label, selected, today, disabled, onPress }: { label: number; selected: boolean; today: boolean; disabled: boolean; onPress: () => void }) {
  // The fill changes at once (so the number is always readable); only a small "pop" is animated.
  const pop = useSharedValue(1);
  useEffect(() => { if (selected) pop.value = withSequence(withTiming(0.82, { duration: 70 }), withSpring(1, { damping: 9, stiffness: 260 })); }, [selected, pop]);
  const scale = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} accessibilityLabel={String(label)} disabled={disabled} onPress={onPress} style={s.cell}>
      <Animated.View style={[s.day, scale, selected && { backgroundColor: colors.primary }, today && !selected && s.today]}>
        <Text style={[s.dayText, disabled && { color: colors.border }, today && !selected && { color: colors.primary, fontFamily: fonts.bold }, selected && { color: colors.white, fontFamily: fonts.bold }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function CalendarModal({ visible, value, min, max, title, onSelect, onClose }: CalendarProps) {
  const { t, i18n } = useTranslation();
  const L = lang(i18n.language);
  const today = todayIso();
  const todayAllowed = (!min || today >= min) && (!max || today <= max);
  const start = value && isIsoDate(value) ? value : todayAllowed ? today : min ?? max ?? today;
  const [picked, setPicked] = useState<IsoDate | null>(start);
  const [view, setView] = useState(() => { const p = parts(start); return { y: p.y, m: p.m }; });
  const [years, setYears] = useState(false);
  const yearScroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    const s0 = value && isIsoDate(value) ? value : todayAllowed ? today : min ?? max ?? today;
    setPicked(s0); const p = parts(s0); setView({ y: p.y, m: p.m }); setYears(false);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const minP = min ? parts(min) : null, maxP = max ? parts(max) : null;
  const canPrev = !minP || view.y > minP.y || (view.y === minP.y && view.m > minP.m);
  const canNext = !maxP || view.y < maxP.y || (view.y === maxP.y && view.m < maxP.m);
  const move = (dir: -1 | 1) => setView((v) => { const m = v.m + dir; return m < 0 ? { y: v.y - 1, m: 11 } : m > 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m }; });

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1).getDay();
    const count = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array<null>(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [view]);
  const allowed = (iso: IsoDate) => (!min || iso >= min) && (!max || iso <= max);

  const yearList = useMemo(() => {
    const now = new Date().getFullYear();
    const from = minP?.y ?? now - 100, to = maxP?.y ?? now + 10;
    return Array.from({ length: to - from + 1 }, (_, i) => to - i);
  }, [minP?.y, maxP?.y]);
  const chooseYear = (y: number) => {
    let m = view.m;
    if (minP && y === minP.y && m < minP.m) m = minP.m;
    if (maxP && y === maxP.y && m > maxP.m) m = maxP.m;
    setView({ y, m }); setYears(false); tick('light');
  };

  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)} style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('common.cancel')} />
        <Animated.View entering={ZoomIn.duration(260).springify().damping(15)} style={s.card} accessibilityViewIsModal>
          <View style={s.banner}>
            <Text style={[type.small, { color: 'rgba(255,255,255,0.85)' }]}>{title ?? t('cal.choose')}</Text>
            <Text style={[type.h2, { color: colors.white }]}>{picked ? formatIso(picked, L) : t('cal.none')}</Text>
          </View>

          <View style={s.head}>
            <Tap accessibilityRole="button" accessibilityLabel={t('cal.prev')} onPress={() => move(-1)} disabled={!canPrev || years} style={[s.arrow, (!canPrev || years) && { opacity: 0.3 }]}><Icon name="chevron-back" size={20} color={colors.primary} /></Tap>
            <Tap accessibilityRole="button" accessibilityLabel={t('cal.chooseYear')} onPress={() => { setYears((v) => !v); setTimeout(() => yearScroll.current?.scrollTo({ y: Math.max(0, Math.floor(yearList.indexOf(view.y) / 4) * 48 - 96), animated: false }), 0); }} style={s.monthBtn}>
              <Text style={[type.h3, { color: colors.navy }]}>{MONTHS[L]![view.m]} {view.y}</Text>
              <Icon name={years ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
            </Tap>
            <Tap accessibilityRole="button" accessibilityLabel={t('cal.next')} onPress={() => move(1)} disabled={!canNext || years} style={[s.arrow, (!canNext || years) && { opacity: 0.3 }]}><Icon name="chevron-forward" size={20} color={colors.primary} /></Tap>
          </View>

          {years ? (
            <ScrollView ref={yearScroll} style={{ height: 6 * 44 + 8 }} contentContainerStyle={s.years} showsVerticalScrollIndicator={false}>
              {yearList.map((y) => (
                <Tap key={y} accessibilityRole="button" accessibilityState={{ selected: y === view.y }} onPress={() => chooseYear(y)} scaleTo={0.94} style={[s.year, y === view.y && s.yearOn]}>
                  <Text style={[type.bodyMedium, { color: y === view.y ? colors.white : colors.navy }]}>{y}</Text>
                </Tap>
              ))}
            </ScrollView>
          ) : (
            <View>
              <View style={s.week}>{WEEKDAYS[L]!.map((w, i) => <Text key={i} style={[s.weekText, (i === 0) && { color: colors.red }]}>{w}</Text>)}</View>
              <View style={s.grid}>
                {cells.map((d, i) => {
                  if (d === null) return <View key={`e${i}`} style={s.cell} />;
                  const iso = toIso(view.y, view.m, d);
                  return <Day key={iso} label={d} selected={picked === iso} today={iso === today} disabled={!allowed(iso)} onPress={() => { setPicked(iso); tick('light'); }} />;
                })}
                {Array.from({ length: Math.max(0, 42 - cells.length) }, (_, i) => <View key={`t${i}`} style={s.cell} />)/* always 6 rows, so the card does not jump */}
              </View>
            </View>
          )}

          <View style={s.footer}>
            {todayAllowed ? (
              <Tap accessibilityRole="button" onPress={() => { setPicked(today); const p = parts(today); setView({ y: p.y, m: p.m }); setYears(false); }} style={s.todayBtn}>
                <Icon name="today-outline" size={18} color={colors.primary} />
                <Text style={[type.smallMedium, { color: colors.primary }]}>{t('cal.today')}</Text>
              </Tap>
            ) : <View />}
            <View style={s.actions}>
              <Button small variant="outline" title={t('common.cancel')} onPress={onClose} style={s.actionBtn} />
              <Button small title={t('cal.done')} onPress={() => { if (picked && allowed(picked)) { onSelect(picked); onClose(); } }} disabled={!picked || !allowed(picked)} style={s.actionBtn} />
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/**
 * A form box that shows the chosen date with a calendar icon. Tapping anywhere on it opens the KMH calendar.
 * `value`/`onChange` use "YYYY-MM-DD" (empty string or null = nothing chosen).
 */
export function DateField({ label, value, onChange, min, max, placeholder, hint, error, clearable = false, compact = false, title, accessibilityLabel }: {
  label?: string; value: IsoDate | null | ''; onChange: (v: IsoDate | null) => void; min?: IsoDate; max?: IsoDate;
  placeholder?: string; hint?: string; error?: string; clearable?: boolean; compact?: boolean; title?: string; accessibilityLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const shown = value ? formatIso(value, i18n.language) : '';
  return (
    <View style={{ marginBottom: compact ? 0 : spacing.md, flex: compact ? 1 : undefined }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Tap accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label ?? t('cal.choose')} accessibilityHint={shown || undefined} onPress={() => setOpen(true)} scaleTo={0.99}
        style={[s.box, compact && s.boxCompact, !!error && { borderColor: colors.red }, open && { borderColor: colors.primary, backgroundColor: colors.tint }]}>
        <View style={[s.boxIcon, compact && { width: 30, height: 30 }]}><Icon name="calendar" size={compact ? 16 : 20} color={colors.primary} /></View>
        <Text numberOfLines={1} style={[type.body, { flex: 1, color: shown ? colors.text : colors.muted }]}>{shown || placeholder || t('cal.choose')}</Text>
        {clearable && value ? (
          <Tap accessibilityRole="button" accessibilityLabel={t('cal.clear')} hitSlop={10} onPress={() => onChange(null)} haptic={false}><Icon name="close-circle" size={20} color={colors.muted} /></Tap>
        ) : <Icon name="chevron-down" size={18} color={colors.muted} />}
      </Tap>
      {error ? <Text style={[type.small, { color: colors.red, marginTop: 4 }]}>{error}</Text> : hint ? <Text style={[type.small, { color: colors.secondary, marginTop: 4 }]}>{hint}</Text> : null}
      <CalendarModal visible={open} value={value || null} min={min} max={max} title={title ?? label} onSelect={(v) => onChange(v)} onClose={() => setOpen(false)} />
    </View>
  );
}

const CELL = 44;
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.white, borderRadius: radius.xl, overflow: 'hidden', boxShadow: '0px 20px 50px rgba(15,33,71,0.35)' },
  banner: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  arrow: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  monthBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.md },
  week: { flexDirection: 'row', paddingHorizontal: spacing.md },
  weekText: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 12, color: colors.secondary, paddingVertical: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md },
  cell: { width: `${100 / 7}%`, height: CELL, alignItems: 'center', justifyContent: 'center' },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 1.5, borderColor: colors.primary },
  dayText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  years: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingVertical: 4, gap: 8 },
  year: { width: '22.5%', height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tint },
  yearOn: { backgroundColor: colors.primary },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.sm },
  todayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  actions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  actionBtn: { minWidth: 96 },
  label: { ...type.smallMedium, color: colors.secondary, marginBottom: 6 },
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white },
  boxCompact: { minHeight: 44, paddingHorizontal: spacing.sm, gap: 8 },
  boxIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
});
