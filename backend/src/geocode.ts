
import { Order } from './models/Order.js';

/**
 * Best-effort address -> coordinates using OpenStreetMap Nominatim.
 * Returns null on any failure so ordering never depends on geocoding.
 */
export async function geocode(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'KamalMedicalHall/1.0 (store delivery app)',
      },
    });

    if (!res.ok) return null;

    const [hit] = (await res.json()) as Array<{
      lat: string;
      lon: string;
    }>;

    if (!hit) return null;

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return { lat, lng };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fills in delivery coordinates on an order whose address was typed
 * without a GPS fix, so customers can track it on a map.
 */
export async function fillOrderCoordinates(
  orderId: string,
  snap: {
    line1?: string;
    line2?: string;
    landmark?: string;
    pincode: string;
    city?: string;
    latitude?: number | null;
  },
): Promise<void> {
  if (snap.latitude != null) return;

  const city = snap.city ?? 'Jaipur';

  const attempts = [
    [snap.line1, snap.line2, city, snap.pincode, 'India'],
    [snap.landmark, snap.line2, city, snap.pincode, 'India'],
    [snap.pincode, city, 'India'],
  ];

  for (const parts of attempts) {
    const query = parts.filter(Boolean).join(', ');
    if (!query) continue;

    const found = await geocode(query);

    if (found) {
      await Order.updateOne(
        { _id: orderId },
        {
          $set: {
            'addressSnapshot.latitude': found.lat,
            'addressSnapshot.longitude': found.lng,
          },
        },
      );

      return;
    }

    // Nominatim usage policy: at most one request per second.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
}
