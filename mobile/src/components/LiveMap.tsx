import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { colors } from '../theme';
import { MAP_HTML, type MapData } from './mapHtml';

/** Live map for phones: OpenStreetMap through Leaflet in a WebView. Push new positions via the `data` prop. */
export function LiveMap({ data, style }: { data: MapData; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) ref.current?.injectJavaScript(`window.update(${JSON.stringify(data)});true;`);
  }, [data, ready]);
  return (
    <View style={[s.box, style]}>
      <WebView
        ref={ref} source={{ html: MAP_HTML, baseUrl: 'https://localhost' }} originWhitelist={['*']} javaScriptEnabled domStorageEnabled
        onMessage={(e: WebViewMessageEvent) => { if (e.nativeEvent.data === 'ready') setReady(true); }}
        style={s.web} scrollEnabled={false} nestedScrollEnabled bounces={false} accessibilityLabel="Live delivery map"
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.card },
  web: { flex: 1, backgroundColor: 'transparent' },
});
