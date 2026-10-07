import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export type PlaceState = { status: 'loading' | 'denied' | 'unavailable' } | { status: 'ready'; label: string };

/** "Mansarovar, Jaipur": the neighbourhood (or street) and the city, from the phone's position. */
export function placeLabel(a: Pick<Location.LocationGeocodedAddress, 'district' | 'subregion' | 'street' | 'name' | 'city' | 'region'>): string {
  const first = a.district || (a.street && a.street !== a.name ? a.street : '') || a.name || a.subregion || '';
  const city = a.city || a.subregion || a.region || '';
  return [first, city].filter((x, i, all) => x && all.indexOf(x) === i).join(', ');
}

let cached: string | null = null; // survives screen changes, so the header never flashes back to "finding..."

/** The customer's current area, kept fresh when the app returns to the foreground. `retry` asks again (e.g. after allowing location). */
export function useCurrentPlace() {
  const [state, setState] = useState<PlaceState>(cached ? { status: 'ready', label: cached } : { status: 'loading' });
  const alive = useRef(true);

  const locate = useCallback(async () => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { if (alive.current) setState({ status: 'denied' }); return; }
      const pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }) ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const [addr] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      const label = addr ? placeLabel(addr) : '';
      if (!label) throw new Error('no address');
      cached = label;
      if (alive.current) setState({ status: 'ready', label });
    } catch {
      if (alive.current) setState((s) => (s.status === 'ready' ? s : { status: 'unavailable' }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void locate();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void locate(); });
    return () => { alive.current = false; sub.remove(); };
  }, [locate]);

  return { place: state, retry: () => { setState((s) => (s.status === 'ready' ? s : { status: 'loading' })); void locate(); } };
}
