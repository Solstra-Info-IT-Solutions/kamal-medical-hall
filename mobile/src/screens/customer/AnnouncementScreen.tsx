import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { endpoints } from '../../api/endpoints';
import { openFile } from '../../components/FileViewer';
import { Skeleton } from '../../components/motion';
import { ErrorView, Message, Pill } from '../../components/ui';
import { useLoad } from '../../hooks';
import { useContentStyle } from '../../layout';
import type { CustomerStackParamList } from '../../navigation/types';
import { colors, radius, spacing, type } from '../../theme';
import { formatDateTime } from '../../utils';

/** One announcement in full: all its pictures, the text and how long it is valid. */
export function AnnouncementScreen({ route }: NativeStackScreenProps<CustomerStackParamList, 'Announcement'>) {
  const { t } = useTranslation();
  const content = useContentStyle(true);
  const { data, error, loading, reload } = useLoad(() => endpoints.announcement(route.params.id));
  if (loading && !data) return <View style={{ padding: spacing.lg, gap: 12 }}><Skeleton h={200} r={16} /><Skeleton h={28} w="70%" /><Skeleton h={80} r={12} /></View>;
  if (error && !data) return error.toLowerCase().includes('not found') ? <Message icon="megaphone-outline" title={t('ann.gone')} text={t('ann.goneHelp')} /> : <ErrorView message={error} onRetry={reload} retryLabel={t('common.retry')} />;
  const a = data!.announcement;
  return (
    <ScrollView contentContainerStyle={[s.body, content]} showsVerticalScrollIndicator={false}>
      {a.images.map((im, i) => (
        <Pressable key={im.publicId} accessibilityRole="button" accessibilityLabel={`${a.title} ${i + 1}`} onPress={() => openFile({ title: a.title, urls: a.images.map((x) => x.url).filter((u): u is string => !!u), fallbackUrl: im.fullUrl })}>
          {im.url ? <Image source={{ uri: im.url }} style={s.img} resizeMode="cover" /> : null}
        </Pressable>
      ))}
      <View style={s.pillRow}><Pill text={a.expired ? t('ann.expiredShort') : t('ann.validTill', { date: formatDateTime(a.expiresAt) })} tone={a.expired ? 'red' : 'green'} /></View>
      <Text style={[type.h2, { color: colors.text }]}>{a.title}</Text>
      {a.body ? <Text style={[type.body, { color: colors.text }]} selectable>{a.body}</Text> : null}
      {a.expired ? <Text style={[type.small, { color: colors.secondary }]}>{t('ann.expiredNote')}</Text> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  img: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: colors.card },
  pillRow: { flexDirection: 'row' },
});
