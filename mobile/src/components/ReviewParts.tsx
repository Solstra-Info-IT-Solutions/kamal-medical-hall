import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Review } from '../api/types';
import { colors, radius, spacing, type } from '../theme';
import { formatDate } from '../utils';
import { Pill } from './ui';
import { Icon } from './ui';

/** Five stars. Pass `onChange` to make it a tappable rating input. */
export function StarRating({ value, size = 20, onChange }: { value: number; size?: number; onChange?: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: onChange ? 8 : 2 }} accessibilityLabel={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Icon name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? '#F5A623' : colors.muted} />;
        return onChange
          ? <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star`} hitSlop={6} onPress={() => onChange(n)}>{star}</Pressable>
          : <View key={n}>{star}</View>;
      })}
    </View>
  );
}

/** A customer review with its photos. `admin` also shows who wrote it and the moderation status. */
export function ReviewCard({ review, admin, children }: { review: Review; admin?: boolean; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const tone = review.status === 'approved' ? 'green' : review.status === 'rejected' ? 'red' : 'amber';
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          {admin ? <Text style={[type.bodyMedium, { color: colors.text }]}>{review.customerName ?? review.customerPhone}</Text> : null}
          <Text style={[type.small, { color: colors.secondary }]}>#{review.orderNumber} · {formatDate(review.createdAt)}</Text>
        </View>
        <Pill text={t(`reviews.status_${review.status}`)} tone={tone} />
      </View>
      <View style={{ marginTop: spacing.sm }}><StarRating value={review.rating} /></View>
      {review.comment ? <Text style={[type.body, { color: colors.text, marginTop: spacing.sm }]}>{review.comment}</Text> : null}
      {review.images.length ? (
        <View style={s.images}>
          {review.images.map((i) => (
            <Pressable key={i.id} accessibilityRole="button" onPress={() => { if (i.url) void Linking.openURL(i.url); }} style={s.thumb}>
              {i.url ? <Image source={{ uri: i.url }} style={s.img} /> : <Icon name="image" size={24} />}
            </Pressable>
          ))}
        </View>
      ) : null}
      {review.status === 'rejected' && review.adminNote ? <Text style={[type.small, { color: colors.red, marginTop: spacing.sm }]}>{review.adminNote}</Text> : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  thumb: { width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: '100%' },
});
