import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { endpoints } from '../../api/endpoints';
import { OrderCard } from '../../components/OrderCard';
import { Enter, Float, Skeleton, Tap } from '../../components/motion';
import { Icon, type IconName } from '../../components/ui';
import { useLoad } from '../../hooks';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useSession } from '../../store/session';
import { colors, radius, spacing, type } from '../../theme';

function Bell({ unread, onPress, label }: { unread: number; onPress: () => void; label: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    if (unread > 0) r.value = withRepeat(withSequence(withTiming(14, { duration: 90 }), withTiming(-12, { duration: 120 }), withTiming(8, { duration: 100 }), withTiming(0, { duration: 100 }), withTiming(0, { duration: 2400 })), -1);
    else r.value = 0;
  }, [unread, r]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Tap accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={10} style={s.bell}>
      <Animated.View style={a}><Icon name="notifications" size={26} color={colors.navy} /></Animated.View>
      {unread > 0 ? <View style={s.badge}><Text style={s.badgeText}>{unread > 9 ? '9+' : unread}</Text></View> : null}
    </Tap>
  );
}

function ActionCard({ icon, title, sub, onPress, tone }: { icon: IconName | 'pill'; title: string; sub: string; onPress: () => void; tone: 'blue' | 'green' }) {
  const c = tone === 'blue' ? [colors.card, '#DCEBFB'] as const : [colors.card, '#DDF3E8'] as const;
  const ink = tone === 'blue' ? colors.primary : colors.green;
  return (
    <Tap onPress={onPress} scaleTo={0.97} style={s.actionShadow} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.action}>
        <View style={s.bigIcon} pointerEvents="none">{icon === 'pill' ? <MaterialCommunityIcons name="pill" size={120} color={ink} /> : <Icon name={icon} size={110} color={ink} />}</View>
        <View style={{ flex: 1 }}>
          <Float amplitude={3} duration={2200} style={s.iconPuck}>{icon === 'pill' ? <MaterialCommunityIcons name="pill" size={30} color={ink} /> : <Icon name={icon} size={30} color={ink} />}</Float>
          <Text style={[type.h3, s.actionTitle]}>{title}</Text>
          <Text style={[type.small, { color: colors.secondary }]}>{sub}</Text>
        </View>
        <View style={s.chev}><Icon name="chevron-forward" size={20} color={colors.white} /></View>
      </LinearGradient>
    </Tap>
  );
}

export function HomeScreen(_props: BottomTabScreenProps<CustomerTabParamList, 'Home'>) {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const user = useSession((st) => st.user);
  const completed = useLoad(() => endpoints.orders('completed'));
  const active = useLoad(() => endpoints.orders('active'));
  const unread = useLoad(async () => (await endpoints.notifications()).notifications.filter((n) => !n.read).length);
  const refreshing = completed.loading && !!completed.data;
  const refresh = () => { void completed.reload(); void active.reload(); void unread.reload(); };
  const first = !completed.data && !active.data;

  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />} showsVerticalScrollIndicator={false}>
        <Enter index={0}>
          <View style={s.top}>
            <View style={s.loc}><Icon name="location-sharp" size={22} color={colors.navy} /><Text style={[type.bodyMedium, { color: colors.navy }]}>{t('home.location')}</Text></View>
            <Bell unread={unread.data ?? 0} onPress={() => nav.navigate('Notifications')} label={t('home.notifications')} />
          </View>
        </Enter>
        <Enter index={1}>
          <Text style={[type.h2, { marginTop: spacing.lg, color: colors.text }]}>{user?.name ? t('home.greetingName', { name: user.name.split(' ')[0] }) : t('home.greeting')}</Text>
          <Text style={[type.body, { color: colors.secondary, marginBottom: spacing.lg }]}>{t('home.help')}</Text>
        </Enter>

        <Enter index={2}><ActionCard icon="camera" tone="blue" title={t('home.uploadTitle')} sub={t('home.uploadSubtitle')} onPress={() => nav.navigate('Upload')} /></Enter>
        <Enter index={3}><ActionCard icon="pill" tone="green" title={t('home.typeTitle')} sub={t('home.typeSubtitle')} onPress={() => nav.navigate('TypeMedicines')} /></Enter>

        {first ? <View style={{ gap: 12, marginTop: spacing.xl }}><Skeleton h={22} w="45%" /><Skeleton h={104} r={16} /><Skeleton h={104} r={16} /></View> : <>
          {(active.data?.orders.length ?? 0) > 0 ? <>
            <Enter index={4}><Text style={[type.h3, s.section]}>{t('home.activeOrders')}</Text></Enter>
            {active.data!.orders.map((o, i) => <OrderCard key={o.id} order={o} index={i + 5} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} />)}
          </> : null}

          <Enter index={5}>
            <View style={s.sectionRow}>
              <Text style={[type.h3, { color: colors.text }]}>{t('home.pastOrders')}</Text>
              <Tap onPress={() => nav.navigate('Tabs', { screen: 'Orders' })} haptic={false}><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('home.viewAll')}</Text></Tap>
            </View>
          </Enter>
          {completed.error ? <Text style={[type.small, { color: colors.red }]}>{completed.error}</Text> : null}
          {completed.data && completed.data.orders.length === 0 ? <Text style={[type.small, { color: colors.secondary }]}>{t('home.noPast')}</Text> : null}
          {completed.data?.orders.slice(0, 3).map((o, i) => <OrderCard key={o.id} order={o} index={i + 6} onPress={() => nav.navigate('OrderDetail', { orderId: o.id })} />)}
        </>}

        <Enter index={7}>
          <View style={s.note}><Icon name="shield-checkmark" size={20} color={colors.green} /><Text style={[type.small, { flex: 1, color: colors.text }]}>{t('home.rxNotice')}</Text></View>
        </Enter>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bell: { padding: 4 },
  badge: { position: 'absolute', right: -2, top: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.red, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 10, lineHeight: 14, fontFamily: 'NotoSansDevanagari_700Bold' },
  actionShadow: { marginBottom: spacing.md, borderRadius: radius.lg, boxShadow: '0px 8px 20px rgba(11,95,219,0.12)' },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 132, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, overflow: 'hidden' },
  bigIcon: { position: 'absolute', right: -14, bottom: -22, opacity: 0.1 },
  iconPuck: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm, boxShadow: '0px 4px 10px rgba(15,33,71,0.10)' },
  actionTitle: { color: colors.text },
  chev: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  section: { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  note: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: '#EFFAF3' },
});
void Easing;
