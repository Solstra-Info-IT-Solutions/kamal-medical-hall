import { pool } from './db.js';

/**
 * Best-effort address -> coordinates using OpenStreetMap Nominatim (no API key needed; fine for a single store's volume).
 * Returns null on any failure so ordering never depends on it.
 */
export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'KamalMedicalHall/1.0 (store delivery app)' } });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as Array<{ lat: string; lon: string }>;
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fills in delivery coordinates on an order whose address was typed (no GPS fix), so customers can track it on a map. */
export async function fillOrderCoordinates(orderId: string, snap: { line1?: string; line2?: string; landmark?: string; pincode: string; city?: string; latitude?: number | null }) {
  if (snap.latitude != null) return;
  const attempts = [
    [snap.line1, snap.line2, snap.city ?? 'Jaipur', snap.pincode, 'India'],
    [snap.landmark, snap.line2, snap.city ?? 'Jaipur', snap.pincode, 'India'],
    [snap.pincode, snap.city ?? 'Jaipur', 'India'],
  ];
  for (const parts of attempts) {
    const found = await geocode(parts.filter(Boolean).join(', '));
    if (found) {
      await pool.query(`update orders set address_snapshot = address_snapshot || jsonb_build_object('latitude', $2::float8, 'longitude', $3::float8) where id = $1`, [orderId, found.lat, found.lng]);
      return;
    }
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim usage policy: at most 1 request per second
  }
}
