import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { Card, Icon, Pill, type IconName } from '../../components/ui';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';
import { formatDate, statusTone } from '../../utils';

export function HomeScreen(_props: BottomTabScreenProps<CustomerTabParamList, 'Home'>) {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const user = useSession((s) => s.user);
  const completed = useLoad(() => endpoints.orders('completed'));
  const active = useLoad(() => endpoints.orders('active'));
  const unread = useLoad(async () => (await endpoints.notifications()).notifications.filter((n) => !n.read).length);
  const refreshing = completed.loading || active.loading;
  const refresh = () => { void completed.reload(); void active.reload(); void unread.reload(); };

  const action = (icon: IconName | 'pill', title: string, sub: string, to: 'Upload' | 'TypeMedicines') => (
    <Card onPress={() => nav.navigate(to)} style={s.action}>
      <View style={{ flex: 1 }}>
        {icon === 'pill' ? <MaterialCommunityIcons name="pill" size={40} color={colors.primary} /> : <Icon name={icon} size={38} />}
        <Text style={[type.h3, s.actionTitle]}>{title}</Text>
        <Text style={[type.small, { color: colors.secondary }]}>{sub}</Text>
      </View>
      <Icon name="chevron-forward" size={26} />
    </Card>
  );

  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <View style={s.loc}><Icon name="location-sharp" size={22} color={colors.navy} /><Text style={[type.bodyMedium, { color: colors.navy }]}>{t('home.location')}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('home.notifications')} onPress={() => nav.navigate('Notifications')} hitSlop={10}>
            <Icon name="notifications" size={26} color={colors.navy} />
            {(unread.data ?? 0) > 0 ? <View style={s.badge} /> : null}
          </Pressable>
        </View>
        <Text style={[type.h2, { marginTop: spacing.lg, color: colors.text }]}>{user?.name ? t('home.greetingName', { name: user.name.split(' ')[0] }) : t('home.greeting')}</Text>
        <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.lg }]}>{t('home.help')}</Text>

        {action('camera', t('home.uploadTitle'), t('home.uploadSubtitle'), 'Upload')}
        {action('pill', t('home.typeTitle'), t('home.typeSubtitle'), 'TypeMedicines')}

        {(active.data?.orders.length ?? 0) > 0 ? <>
          <Text style={[type.h3, s.section]}>{t('home.activeOrders')}</Text>
          {active.data!.orders.map((o) => (
            <Card key={o.id} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} style={s.orderCard}>
              <View style={{ flex: 1 }}><Text style={[type.bodyMedium]}>#{o.orderNumber}</Text><Text style={[type.small, { color: colors.secondary }]}>{formatDate(o.createdAt)}</Text></View>
              <Pill text={t(`status.${o.status}`)} tone={statusTone(o.status)} />
            </Card>
          ))}
        </> : null}

        <View style={s.sectionRow}>
          <Text style={[type.h3, { color: colors.text }]}>{t('home.pastOrders')}</Text>
          <Pressable onPress={() => nav.navigate('Tabs', { screen: 'Orders' })}><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('home.viewAll')}</Text></Pressable>
        </View>
        {completed.error ? <Text style={[type.small, { color: colors.red }]}>{completed.error}</Text> : null}
        {completed.data && completed.data.orders.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('home.noPast')}</Text> : null}
        {completed.data?.orders.slice(0, 3).map((o) => (
          <Pressable key={o.id} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} style={s.pastRow}>
            <View style={s.thumb}><Icon name={o.kind === 'prescription' ? 'document-text-outline' : 'medkit-outline'} size={26} color={colors.secondary} /></View>
            <View style={{ flex: 1, marginHorizontal: spacing.md }}><Text style={[type.bodyMedium]}>#{o.orderNumber}</Text><Text style={[type.small, { color: colors.secondary }]}>{formatDate(o.createdAt)}</Text></View>
            <Pill text={t(`status.${o.status}`)} tone="green" />
          </Pressable>
        ))}
        <View style={s.note}><Icon name="shield-checkmark" size={20} color={colors.green} /><Text style={[type.small, { flex: 1, color: colors.text }]}>{t('home.rxNotice')}</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { position: 'absolute', right: 1, top: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 140, marginBottom: spacing.md },
  actionTitle: { color: colors.text, marginTop: spacing.sm },
  section: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  orderCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, padding: spacing.md },
  pastRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, marginBottom: spacing.sm },
  thumb: { width: 52, height: 58, borderRadius: radius.sm, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: spacing.xl, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#EFFAF3' },
});
