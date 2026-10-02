import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { useDialog } from '../dialog';
import { colors, radius, spacing, type } from '../theme';
import { Ripples, Tap } from './motion';
import { Button, Icon } from './ui';

/** The app-wide themed dialog (logout, delete account, confirmations, notices). Mount once at the root. */
export function DialogHost() {
  const current = useDialog((s) => s.current);
  const close = useDialog((s) => s.close);
  const [ack, setAck] = useState(false);
  useEffect(() => { setAck(false); }, [current]);
  if (!current) return null;
  const danger = current.tone === 'danger';
  const tint = danger ? colors.red : colors.primary;
  const bg = danger ? colors.redBg : colors.card;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => close(false)}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={s.backdrop}>
        <Animated.View entering={ZoomIn.duration(300).springify().damping(14)} style={s.card} accessibilityViewIsModal>
          <View style={s.iconWrap}>
            <Ripples size={84} color={tint} count={2} />
            <View style={[s.icon, { backgroundColor: bg }]}><Icon name={current.icon ?? (danger ? 'warning' : 'help-circle')} size={34} color={tint} /></View>
          </View>
          <Text style={[type.h2, s.title]}>{current.title}</Text>
          {current.message ? <Text style={[type.body, s.message]}>{current.message}</Text> : null}
          {current.acknowledge ? (
            <Tap accessibilityRole="checkbox" accessibilityState={{ checked: ack }} onPress={() => setAck((v) => !v)} scaleTo={0.98} style={s.ack}>
              <Icon name={ack ? 'checkbox' : 'square-outline'} size={26} color={ack ? tint : colors.muted} />
              <Text style={[type.small, { flex: 1, color: colors.text }]}>{current.acknowledge}</Text>
            </Tap>
          ) : null}
          <View style={s.buttons}>
            {current.cancelLabel ? <Button title={current.cancelLabel} variant="outline" onPress={() => close(false)} style={s.btn} /> : null}
            <Button title={current.confirmLabel} variant={danger ? 'danger' : 'primary'} disabled={!!current.acknowledge && !ack} onPress={() => close(true)} style={s.btn} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.white, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', boxShadow: '0px 20px 50px rgba(15,33,71,0.35)' },
  iconWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  icon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, textAlign: 'center' },
  message: { color: colors.secondary, textAlign: 'center', marginTop: spacing.sm },
  ack: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  buttons: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: spacing.xl },
  btn: { flex: 1 },
});
