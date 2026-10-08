import { NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold, useFonts } from '@expo-google-fonts/noto-sans-devanagari';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnimatedSplash } from './components/AnimatedSplash';
import { DialogHost } from './components/DialogHost';
import { FileViewerHost } from './components/FileViewer';
import { NotificationToast } from './components/NotificationToast';
import { warmUp } from './core/network/socketClient';
import i18n, { restoreLanguage } from './localization';
import { Navigation } from './navigation';
import { useSession } from './store/session';
import { colors, fonts } from './theme';

void SplashScreen.preventAutoHideAsync();

// Make every <Text>/<TextInput> use the brand font unless a style overrides it.
const patch = (C: { defaultProps?: { style?: unknown } }) => { C.defaultProps = { ...C.defaultProps, style: [{ fontFamily: fonts.regular }, C.defaultProps?.style] }; };
patch(Text as never);
patch(TextInput as never);
// Respect the user's font size but cap it so very large settings do not break layouts.
(Text as unknown as { defaultProps: Record<string, unknown> }).defaultProps.maxFontSizeMultiplier = 1.3;
(TextInput as unknown as { defaultProps: Record<string, unknown> }).defaultProps.maxFontSizeMultiplier = 1.3;

const MIN_SPLASH_MS = 600;

export function App() {
  const [fontsLoaded, fontError] = useFonts({ NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold });
  const [langReady, setLangReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const sessionStatus = useSession((s) => s.status);
  useEffect(() => { warmUp(); }, []);
  useEffect(() => { void restoreLanguage().finally(() => setLangReady(true)); }, []);
  const ready = (fontsLoaded || !!fontError) && langReady;
  useEffect(() => {
    if (!ready) return;
    void SplashScreen.hideAsync();
    const id = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(id);
  }, [ready]);
  if (!ready) return null;
  const showSplash = !minElapsed || sessionStatus === 'loading';
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <StatusBar style="dark" />
        <Navigation />
        <NotificationToast />
        <DialogHost />
        <FileViewerHost />
        {showSplash ? <AnimatedSplash tagline={i18n.t('brand.tagline')} /> : null}
      </View>
    </SafeAreaProvider>
  );
}
