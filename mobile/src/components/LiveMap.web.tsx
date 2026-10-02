import { createElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme';
import { MAP_HTML, type MapData } from './mapHtml';

/** Live map for the web build: the same Leaflet page inside an iframe. */
export function LiveMap({ data, style }: { data: MapData; style?: StyleProp<ViewStyle> }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data === 'ready') setReady(true); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage(JSON.stringify(data), '*');
  }, [data, ready]);
  return (
    <View style={[s.box, style]}>
      {createElement('iframe', { ref: frame, srcDoc: MAP_HTML, title: 'Live delivery map', style: { border: 0, width: '100%', height: '100%' } })}
    </View>
  );
}

const s = StyleSheet.create({ box: { overflow: 'hidden', backgroundColor: colors.card } });
