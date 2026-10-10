import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Layout building blocks that behave like chains in Android's ConstraintLayout, so every list and card is laid out by the
 * same rules and nothing depends on a screen's width:
 *
 *   ListRow     leading  <->  content  <->  trailing      (a horizontal chain)
 *               - leading and trailing keep their own size and never shrink,
 *               - content gets all the space left over (like a 0dp / match-constraint view) and wraps its text,
 *               - the leading view is aligned to the top of the content (like app:layout_constraintTop_toTopOf),
 *               - the trailing view (arrow, price, switch) is centred vertically on the whole row.
 *
 *   TitleBadge  a title and a badge on one line, the badge pinned to the right edge. If they do not fit side by side,
 *               the badge drops to its own line, still on the right: the title is never broken in the middle of a word.
 *
 *   Spacing     use the `gap` of these components and the spacing scale in theme.ts; never margins that depend on a sibling.
 */
export function ListRow({ leading, trailing, children, gap = 12, centered = false, style }: { leading?: ReactNode; trailing?: ReactNode; children: ReactNode; gap?: number; centered?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.row, { gap, alignItems: centered ? 'center' : 'flex-start' }, style]}>
      {leading ? <View style={s.fixed}>{leading}</View> : null}
      <View style={s.fill}>{children}</View>
      {trailing ? <View style={[s.fixed, { alignSelf: 'center' }]}>{trailing}</View> : null}
    </View>
  );
}

export function TitleBadge({ title, badge, titleStyle, gap = 8 }: { title: string; badge?: ReactNode; titleStyle?: StyleProp<TextStyle>; gap?: number }) {
  return (
    <View style={[s.titleLine, { columnGap: gap, rowGap: 4 }]}>
      <Text style={[s.titleText, titleStyle]}>{title}</Text>
      {badge ? <View style={s.badge}>{badge}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  fixed: { flexShrink: 0 },
  fill: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between' },
  titleText: { flexShrink: 1 },
  badge: { flexShrink: 0, marginLeft: 'auto', maxWidth: '100%' },
});
