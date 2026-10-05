import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { endpoints } from './api/endpoints';
import type { PartnerState } from './api/types';

export interface Coords { lat: number; lng: number }

export function distanceMeters(a: Coords, b: Coords) {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

/**
 * While the partner is out on a delivery or riding back, watch the position (foreground) and report it:
 * the customer's map follows the rider, and reaching the shop makes the partner available automatically.
 * `onServerState` is called with the state the server returns (e.g. "available" after arriving).
 */
export function usePartnerLocation(enabled: boolean, onServerState?: (state: PartnerState, arrived: boolean) => void) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [denied, setDenied] = useState(false);
  const last = useRef(0);
  const cb = useRef(onServerState);
  cb.current = onServerState;

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) { setDenied(true); return; }
        setDenied(false);
        const started = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 7000, distanceInterval: 15 }, (pos) => {
          if (cancelled) return;
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCoords(c);
          if (Date.now() - last.current < 6000) return; // gentle on battery and server
          last.current = Date.now();
          void endpoints.partner.location(c.lat, c.lng).then((r) => { if (!cancelled) cb.current?.(r.state, r.arrived); }).catch(() => undefined);
        });
        if (cancelled) started.remove(); else sub = started; // the screen may have closed while the watch was starting
      } catch { setDenied(true); }
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [enabled]);

  return { coords, denied };
}
