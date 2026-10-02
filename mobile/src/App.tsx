import { NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold, useFonts } from '@expo-google-fonts/noto-sans-devanagari';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { restoreLanguage } from './localization';
import { Navigation } from './navigation';
import { fonts } from './theme';

void SplashScreen.preventAutoHideAsync();

// Make every <Text>/<TextInput> use the brand font unless a style overrides it.
const patch = (C: { defaultProps?: { style?: unknown } }) => { C.defaultProps = { ...C.defaultProps, style: [{ fontFamily: fonts.regular }, C.defaultProps?.style] }; };
patch(Text as never);
patch(TextInput as never);

export function App() {
  const [fontsLoaded, fontError] = useFonts({ NotoSansDevanagari_400Regular, NotoSansDevanagari_500Medium, NotoSansDevanagari_600SemiBold, NotoSansDevanagari_700Bold });
  const [langReady, setLangReady] = useState(false);
  useEffect(() => { void restoreLanguage().finally(() => setLangReady(true)); }, []);
  const ready = (fontsLoaded || !!fontError) && langReady;
  useEffect(() => { if (ready) void SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;
  return <SafeAreaProvider><StatusBar style="dark" /><Navigation /></SafeAreaProvider>;
}
