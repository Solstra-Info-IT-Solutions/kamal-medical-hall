import { useMemo, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors, spacing, type } from '../theme';

export interface Point { label: string; value: number }
const compact = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
const niceMax = (v: number) => { if (v <= 0) return 100; const p = 10 ** Math.floor(Math.log10(v)); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smooth(pts: { x: number; y: number }[]) {
  if (pts.length < 2) return pts.length ? `M${pts[0]!.x},${pts[0]!.y}` : '';
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Area chart with a soft gradient, light grid, value labels and tap-to-inspect (the selected day is shown above the chart). */
export function AreaChart({ data, height = 190, format, color = colors.primary }: { data: Point[]; height?: number; format: (n: number) => string; color?: string }) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(null);
  const padL = 38, padR = 8, padT = 12, padB = 6;
  const max = useMemo(() => niceMax(Math.max(...data.map((d) => d.value), 0)), [data]);
  const geo = useMemo(() => {
    const iw = Math.max(1, w - padL - padR), ih = height - padT - padB;
    const step = data.length > 1 ? iw / (data.length - 1) : 0;
    const pts = data.map((d, i) => ({ x: padL + (data.length > 1 ? i * step : iw / 2), y: padT + ih - (d.value / max) * ih }));
    const line = smooth(pts);
    const area = pts.length > 1 ? `${line} L${pts[pts.length - 1]!.x},${padT + ih} L${pts[0]!.x},${padT + ih} Z` : '';
    return { pts, line, area, ih, step };
  }, [data, w, height, max]);
  const best = data.reduce((b, d, i) => (d.value > (data[b]?.value ?? -1) ? i : b), 0);
  const active = sel ?? best;
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const select = (x: number) => { if (!geo.pts.length) return; let bi = 0; geo.pts.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(geo.pts[bi]!.x - x)) bi = i; }); setSel(bi); };
  const ticks = [0, 0.5, 1];

  return (
    <View>
      <View style={s.readout}>
        <Text style={[type.small, { color: colors.secondary }]}>{data[active]?.label ?? ''}{sel === null ? ' · best day' : ''}</Text>
        <Text style={[type.h2, { color: colors.navy }]}>{format(data[active]?.value ?? 0)}</Text>
      </View>
      <View onLayout={onLayout} style={{ height }}>
        {w > 0 ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={(e) => select(e.nativeEvent.locationX)} accessibilityRole="adjustable" accessibilityLabel="Daily sales chart">
            <Svg width={w} height={height}>
              <Defs>
                <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={color} stopOpacity={0.35} />
                  <Stop offset="1" stopColor={color} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              {ticks.map((t) => {
                const y = padT + geo.ih - t * geo.ih;
                return <G key={t}><Line x1={padL} x2={w - padR} y1={y} y2={y} stroke={colors.border} strokeWidth={1} strokeDasharray={t === 0 ? undefined : '4 4'} /></G>;
              })}
              {geo.area ? <Path d={geo.area} fill="url(#fill)" /> : null}
              {geo.line ? <Path d={geo.line} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {geo.pts[active] ? (
                <G>
                  <Line x1={geo.pts[active]!.x} x2={geo.pts[active]!.x} y1={padT} y2={padT + geo.ih} stroke={color} strokeOpacity={0.35} strokeWidth={1.5} />
                  <Circle cx={geo.pts[active]!.x} cy={geo.pts[active]!.y} r={9} fill={color} fillOpacity={0.18} />
                  <Circle cx={geo.pts[active]!.x} cy={geo.pts[active]!.y} r={5} fill={colors.white} stroke={color} strokeWidth={3} />
                </G>
              ) : null}
            </Svg>
            {ticks.map((t) => <Text key={t} style={[type.small, s.yLabel, { top: padT + geo.ih - t * geo.ih - 9 }]}>{compact(max * t)}</Text>)}
          </Pressable>
        ) : null}
      </View>
      {data.length > 1 ? <View style={s.xLabels}><Text style={[type.small, { color: colors.secondary }]}>{data[0]!.label}</Text><Text style={[type.small, { color: colors.secondary }]}>{data[data.length - 1]!.label}</Text></View> : null}
    </View>
  );
}

export interface Segment { label: string; value: number; color: string }

/** Donut with the total in the middle and a legend underneath (amounts and shares). */
export function Donut({ segments, centerLabel, centerValue, format, size = 150 }: { segments: Segment[]; centerLabel: string; centerValue: string; format: (n: number) => string; size?: number }) {
  const total = segments.reduce((n, x) => n + x.value, 0);
  const stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={s.donutWrap}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
            {total > 0 ? segments.map((seg) => {
              const len = (seg.value / total) * c;
              const el = <Circle key={seg.label} cx={size / 2} cy={size / 2} r={r} stroke={seg.color} strokeWidth={stroke} fill="none" strokeDasharray={`${Math.max(0, len - 3)} ${c - Math.max(0, len - 3)}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
              offset += len;
              return el;
            }) : null}
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, s.donutCenter]}>
          <Text style={[type.small, { color: colors.secondary }]}>{centerLabel}</Text>
          <Text style={[type.h3, { color: colors.navy }]} numberOfLines={1} adjustsFontSizeToFit>{centerValue}</Text>
        </View>
      </View>
      <View style={{ flex: 1, gap: 10 }}>
        {segments.map((seg) => (
          <View key={seg.label} style={s.legend}>
            <View style={[s.dot, { backgroundColor: seg.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[type.smallMedium, { color: colors.text }]} numberOfLines={1}>{seg.label}</Text>
              <Text style={[type.small, { color: colors.secondary }]}>{format(seg.value)} · {total ? Math.round((seg.value / total) * 100) : 0}%</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  readout: { marginBottom: spacing.sm },
  yLabel: { position: 'absolute', left: 0, width: 34, textAlign: 'right', color: colors.muted, fontSize: 11 },
  xLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 38, marginTop: 4 },
  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  donutCenter: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
