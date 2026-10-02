import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { useLayout } from '../layout';
import { colors, radius, spacing, type } from '../theme';
import { formatMoney } from '../utils';
import { Tap, tick } from './motion';
import { Button, Icon } from './ui';

export interface PaymentInfo {
  amount: number; orderNumber: string; upiId: string | null; upiName: string | null; upiUri: string | null;
  bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; bankIfsc: string | null; configured: boolean;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tap accessibilityRole="button" accessibilityLabel={`Copy ${label}`} onPress={async () => { await Clipboard.setStringAsync(value); tick('success'); setDone(true); setTimeout(() => setDone(false), 1500); }} scaleTo={0.98} style={s.row}>
      <View style={{ flex: 1 }}><Text style={[type.small, { color: colors.secondary }]}>{label}</Text><Text style={[type.bodyMedium, { color: colors.text }]} selectable>{value}</Text></View>
      <Icon name={done ? 'checkmark-circle' : 'copy-outline'} size={22} color={done ? colors.green : colors.primary} />
    </Tap>
  );
}

/** Full-screen sheet the delivery partner shows to the customer: a UPI QR with the exact amount, the UPI ID and bank details. */
export function PaymentSheet({ visible, info, onClose }: { visible: boolean; info: PaymentInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { width } = useLayout();
  const qr = Math.max(150, Math.min(240, width - 120));
  return (
    <Modal transparent visible={visible} animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={s.backdrop}>
        <Animated.View entering={SlideInDown.duration(320).springify().damping(18)} style={s.sheet}>
          <View style={s.grab} />
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }} showsVerticalScrollIndicator={false}>
            <Text style={[type.small, { color: colors.secondary, textAlign: 'center' }]}>{t('pay.amountToPay')} · #{info?.orderNumber}</Text>
            <Text style={[type.h1, { color: colors.text, textAlign: 'center', fontSize: 36, lineHeight: 50 }]}>{formatMoney(info?.amount ?? 0)}</Text>

            {info?.upiUri ? (
              <View style={s.qrBox}>
                <View style={s.qrFrame}><QRCode value={info.upiUri} size={qr} color={colors.navy} backgroundColor={colors.white} /></View>
                <Text style={[type.small, { color: colors.secondary, textAlign: 'center', marginTop: spacing.sm }]}>{t('pay.scanAnyUpi')}</Text>
              </View>
            ) : null}
            {info?.upiId ? <CopyRow label={t('pay.upiId')} value={info.upiId} /> : null}
            {info?.upiName ? <CopyRow label={t('pay.payeeName')} value={info.upiName} /> : null}

            {info?.bankAccountNumber ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[type.h3, { color: colors.text, marginBottom: 4 }]}>{t('pay.bankTransfer')}</Text>
                {info.bankName ? <CopyRow label={t('pay.bankName')} value={info.bankName} /> : null}
                {info.bankAccountName ? <CopyRow label={t('pay.accountName')} value={info.bankAccountName} /> : null}
                <CopyRow label={t('pay.accountNumber')} value={info.bankAccountNumber} />
                {info.bankIfsc ? <CopyRow label={t('pay.ifsc')} value={info.bankIfsc} /> : null}
              </View>
            ) : null}

            {info && !info.configured ? (
              <View style={s.warn}><Icon name="information-circle" size={22} color={colors.amber} /><Text style={[type.small, { color: colors.text, flex: 1 }]}>{t('pay.notConfigured')}</Text></View>
            ) : null}
          </ScrollView>
          <Button title={t('common.done')} onPress={onClose} />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.md },
  qrBox: { alignItems: 'center', marginVertical: spacing.lg },
  qrFrame: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.white, boxShadow: '0px 8px 20px rgba(11,95,219,0.12)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: spacing.md, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.tint, borderWidth: 1, borderColor: colors.border },
  warn: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.amberBg },
});
