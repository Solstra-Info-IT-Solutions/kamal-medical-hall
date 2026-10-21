import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { Gender } from '../api/types';
import { colors, radius, spacing, type } from '../theme';
import { Tap } from './motion';
import { DateField, todayIso } from './Calendar';
import { Icon } from './ui';

/** One choice out of a few, as chips that wrap onto the next line on narrow phones. Tapping the chosen one clears it when `clearable`. */
export function ChoiceChips<T extends string>({ label, options, value, onChange, clearable = false }: { label?: string; options: { value: T; label: string }[]; value: T | null | undefined; onChange: (v: T | null) => void; clearable?: boolean }) {
  return (
    <View style={{ gap: 6, marginBottom: spacing.md }}>
      {label ? <Text style={[type.smallMedium, { color: colors.text }]}>{label}</Text> : null}
      <View style={s.chips} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Tap key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(on && clearable ? null : o.value)} scaleTo={0.95} style={[s.chip, on && s.chipOn]}>
              <Text style={[type.smallMedium, { color: on ? colors.white : colors.text }]}>{o.label}</Text>
            </Tap>
          );
        })}
      </View>
    </View>
  );
}

export function GenderChips({ value, onChange }: { value: Gender | null | undefined; onChange: (v: Gender | null) => void }) {
  const { t } = useTranslation();
  return <ChoiceChips label={t('register.gender')} clearable value={value} onChange={onChange} options={[{ value: 'male', label: t('register.male') }, { value: 'female', label: t('register.female') }, { value: 'other', label: t('register.other') }]} />;
}

/** A tick box with a label that can wrap to several lines. */
export function CheckRow({ checked, onChange, children, error }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; error?: boolean }) {
  return (
    <Tap accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} scaleTo={0.98} style={s.check}>
      <View style={[s.box, checked && s.boxOn, error && !checked && { borderColor: colors.red }]}>{checked ? <Icon name="checkmark" size={16} color={colors.white} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </Tap>
  );
}

/** "1990-05-31" <-> "31/05/1990" (older screens and stored text use the day-first form). */
export const dobToIso = (v: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
export const isoToDob = (v: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

/** Date of birth with the KMH calendar: any day from 1900 up to today (future days are disabled). Value "YYYY-MM-DD". */
export function DobField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const { t } = useTranslation();
  return <DateField label={t('register.dob')} value={value} onChange={(v) => onChange(v ?? '')} min="1900-01-01" max={todayIso()} placeholder={t('register.dobPick')} error={error} clearable />;
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, minHeight: 38, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: spacing.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
