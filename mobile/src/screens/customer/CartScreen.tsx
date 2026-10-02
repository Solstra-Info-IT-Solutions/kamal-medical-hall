import { isImageMime } from '../../fileKinds';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOutLeft, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Enter, Tap } from '../../components/motion';
import { Button, Card, Icon, Message, Screen } from '../../components/ui';
import type { CustomerStackParamList, CustomerTabParamList } from '../../navigation/types';
import { useCart } from '../../store/cart';
import { colors, radius, spacing, type } from '../../theme';

export function CartScreen(_p: BottomTabScreenProps<CustomerTabParamList, 'Cart'>) {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<CustomerStackParamList>>();
  const { medicines, prescriptions, note, setNote, setMedicines, setPrescriptions } = useCart();
  const empty = !medicines.length && !prescriptions.length;
  const count = medicines.length + prescriptions.length;

  if (empty) {
    return (
      <SafeAreaView style={s.fill} edges={['top']}>
        <Text style={[type.h2, s.title]}>{t('cart.title', { count: 0 })}</Text>
        <Message icon="cart-outline" title={t('cart.emptyTitle')} text={t('cart.empty')} actionLabel={t('cart.startOrder')} onAction={() => nav.navigate('Tabs', { screen: 'Home' })} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Screen footer={<Button title={t('cart.chooseAddress')} icon="arrow-forward" onPress={() => nav.navigate('Addresses', { select: true })} />}>
        <Enter><Text style={[type.h2, s.title, { paddingHorizontal: 0 }]}>{t('cart.title', { count })}</Text></Enter>
        {prescriptions.map((f, i) => (
          <Animated.View key={f.id} entering={FadeInDown.delay(i * 70).duration(420).springify().damping(18)} exiting={FadeOutLeft.duration(240)} layout={LinearTransition.springify().damping(18)}>
          <Card style={s.item}>
            {!isImageMime(f.mimeType) ? <View style={s.pdf}><Icon name="document-text" size={28} /></View> : <Image source={{ uri: f.uri }} style={s.thumb} />}
            <View style={{ flex: 1, marginHorizontal: spacing.md }}><Text style={[type.bodyMedium, { color: colors.text }]}>{t('cart.prescription')} {i + 1}</Text><Text style={[type.small, { color: colors.secondary }]} numberOfLines={1}>{f.name}</Text></View>
            <Tap accessibilityRole="button" accessibilityLabel={t('upload.remove', { name: f.name })} hitSlop={10} onPress={() => setPrescriptions(prescriptions.filter((x) => x.id !== f.id))}><Icon name="close-circle" size={26} color={colors.navy} /></Tap>
          </Card>
          </Animated.View>
        ))}
        {medicines.map((m, i) => (
          <Animated.View key={m.id} entering={FadeInDown.delay(i * 70).duration(420).springify().damping(18)} exiting={FadeOutLeft.duration(240)} layout={LinearTransition.springify().damping(18)}>
          <Card style={s.item}>
            <View style={s.pdf}><Icon name="medkit" size={26} /></View>
            <View style={{ flex: 1, marginHorizontal: spacing.md }}><Text style={[type.bodyMedium, { color: colors.text }]} numberOfLines={2}>{m.name}</Text><Text style={[type.small, { color: colors.secondary }]}>{t('cart.qty', { count: m.quantity })}</Text></View>
            <Tap accessibilityRole="button" accessibilityLabel={t('cart.removeItem', { name: m.name })} hitSlop={10} onPress={() => setMedicines(medicines.filter((x) => x.id !== m.id))}><Icon name="close-circle" size={26} color={colors.navy} /></Tap>
          </Card>
          </Animated.View>
        ))}
        <Tap accessibilityRole="button" onPress={() => nav.navigate(prescriptions.length ? 'Upload' : 'TypeMedicines')} style={s.add}>
          <Icon name="add-circle" size={30} />
          <View><Text style={[type.bodyMedium, { color: colors.primary }]}>{t('cart.addMore')}</Text><Text style={[type.small, { color: colors.secondary }]}>{t(prescriptions.length ? 'cart.addMoreRx' : 'cart.addMoreMed')}</Text></View>
        </Tap>
        <View style={s.note}>
          <TextInput value={note} onChangeText={setNote} maxLength={300} multiline placeholder={t('cart.notePlaceholder')} placeholderTextColor={colors.muted} accessibilityLabel={t('cart.notePlaceholder')} style={[type.body, { color: colors.text, minHeight: 56, textAlignVertical: 'top' }]} />
        </View>
        <Text style={[type.small, { color: colors.secondary, marginTop: spacing.md }]}>{t('cart.pending')}</Text>
        <Text style={[type.small, { color: colors.green, marginTop: 4 }]}>{t('cart.freeDelivery')}</Text>
      </Screen>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.white },
  title: { color: colors.text, textAlign: 'center', paddingVertical: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, padding: spacing.md, backgroundColor: colors.white },
  thumb: { width: 54, height: 66, borderRadius: radius.sm },
  pdf: { width: 54, height: 66, borderRadius: radius.sm, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, borderStyle: 'dashed' },
  note: { marginTop: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.tint },
});
