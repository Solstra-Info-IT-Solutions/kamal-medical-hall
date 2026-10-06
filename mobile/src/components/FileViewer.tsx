import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { create } from 'zustand';
import { colors, radius, spacing, type } from '../theme';
import { Button, Icon } from './ui';

export interface ViewerOptions {
  title: string;
  /** Pictures to show in the app: one for a photo, one per page for a PDF. */
  urls: string[];
  /** Original file, tried if the pictures cannot be loaded; also what "open outside the app" uses. */
  fallbackUrl?: string | null;
  /** When given, a download button appears in the header. */
  downloadUrl?: string | null;
}

interface ViewerState { current: ViewerOptions | null; open: (o: ViewerOptions) => void; close: () => void }
const useViewer = create<ViewerState>((set) => ({ current: null, open: (current) => set({ current }), close: () => set({ current: null }) }));

/** Opens a prescription, bill or other picture / PDF inside the app (no browser). */
export const openFile = (options: ViewerOptions) => useViewer.getState().open(options);

function Pages({ options }: { options: ViewerOptions }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [urls, setUrls] = useState(options.urls.length ? options.urls : options.fallbackUrl ? [options.fallbackUrl] : []);
  const [triedFallback, setTriedFallback] = useState(options.urls.length === 0);
  const [loaded, setLoaded] = useState(0);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [ratio, setRatio] = useState<Record<number, number>>({});
  const [dead, setDead] = useState(options.urls.length === 0 && !options.fallbackUrl);

  // Pages appear one after another, so a PDF with fewer pages than we try simply stops.
  const visible = failedAt === null ? Math.min(urls.length, loaded + 1) : Math.min(failedAt, urls.length);

  const onError = (i: number) => {
    if (i > 0) return setFailedAt((f) => (f === null ? i : Math.min(f, i)));
    if (!triedFallback && options.fallbackUrl) { setTriedFallback(true); setUrls([options.fallbackUrl]); setLoaded(0); setFailedAt(null); return; }
    setDead(true);
  };

  if (dead || urls.length === 0) {
    return (
      <View style={s.center}>
        <Icon name="document-text-outline" size={48} color={colors.muted} />
        <Text style={[type.bodyMedium, { color: colors.white, textAlign: 'center', marginTop: spacing.md }]}>{t('viewer.noPreview')}</Text>
        <Text style={[type.small, { color: '#B9C4DD', textAlign: 'center', marginVertical: spacing.sm }]}>{t('viewer.noPreviewHelp')}</Text>
        {options.fallbackUrl ? <Button small title={t('viewer.openOutside')} icon="open-outline" onPress={() => { void Linking.openURL(options.fallbackUrl!); }} /> : null}
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} maximumZoomScale={4} minimumZoomScale={1} bouncesZoom>
      {urls.slice(0, visible).map((u, i) => (
        <View key={`${u}-${i}`} style={{ marginBottom: spacing.sm }}>
          {urls.length > 1 ? <Text style={[type.small, s.pageLabel]}>{t('viewer.page', { n: i + 1 })}</Text> : null}
          <Image
            source={{ uri: u }}
            style={{ width, height: width * (ratio[i] ?? 1.35), backgroundColor: '#101A33' }}
            resizeMode="contain"
            onLoad={(e) => {
              const src = e.nativeEvent.source;
              if (src?.width && src?.height) setRatio((r) => ({ ...r, [i]: src.height / src.width }));
              setLoaded((n) => Math.max(n, i + 1));
            }}
            onError={() => onError(i)}
            accessibilityLabel={`${options.title} ${i + 1}`}
          />
          {i >= loaded ? <View style={s.spinner} pointerEvents="none"><ActivityIndicator color={colors.white} /></View> : null}
        </View>
      ))}
    </ScrollView>
  );
}

/** Mounted once at the root; shows whatever `openFile` was last called with. */
export function FileViewerHost() {
  const { t } = useTranslation();
  const current = useViewer((v) => v.current);
  const close = useViewer((v) => v.close);
  return (
    <Modal visible={!!current} transparent={false} animationType="none" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={s.root}>
        <View style={s.header}>
          <Text style={[type.bodyMedium, { color: colors.white, flex: 1 }]} numberOfLines={1}>{current?.title}</Text>
          {current?.downloadUrl ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('viewer.download')} hitSlop={8} onPress={() => { void Linking.openURL(current.downloadUrl!); }} style={s.round}><Icon name="download" size={20} color={colors.white} /></Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={t('viewer.close')} hitSlop={8} onPress={close} style={s.round}><Icon name="close" size={22} color={colors.white} /></Pressable>
        </View>
        {current ? <Pages key={`${current.title}-${current.urls.join('|')}-${current.fallbackUrl ?? ''}`} options={current} /> : null}
      </SafeAreaView>
    </Modal>
  );
}

// Close the viewer when the user signs out or the app resets state.
export function useCloseViewerOnUnmount() {
  useEffect(() => () => useViewer.getState().close(), []);
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1330' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  pageLabel: { color: '#B9C4DD', paddingHorizontal: spacing.md, paddingVertical: 4 },
  spinner: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
});
