import { Image, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '../core/network/status';
import { colors, fonts } from '../theme';

const logo = require('../../assets/logo.png');

/** Plain brand screen shown while fonts, language and the saved session load. (No animation.) */
export function AnimatedSplash({ tagline }: { tagline: string }) {
  const { t } = useTranslation();
  const slow = useNetworkStatus((n) => n.slow);
  return (
    <View style={s.root} pointerEvents="none">
      <Image source={logo} style={s.logo} resizeMode="contain" accessibilityLabel="Kamal Medical Hall" />
      <Text style={s.tagline}>{tagline}</Text>
      {slow ? <Text style={s.waking}>{t('common.waking')}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  logo: { width: 250, height: 250 },
  waking: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.secondary, textAlign: 'center', marginTop: 16, paddingHorizontal: 32 },
  tagline: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 30, color: colors.primaryDark, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
});
