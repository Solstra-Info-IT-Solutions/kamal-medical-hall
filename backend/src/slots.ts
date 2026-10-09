const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAYS_AHEAD = 7;
export const DEFAULT_CUTOFF = '18:00';

/** yyyy-mm-dd for the calendar date in Asia/Kolkata. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
/** Minutes since midnight, Asia/Kolkata. */
const istMinutes = (at: Date) => { const d = new Date(at.getTime() + IST_OFFSET_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/**
 * The seven dates a customer can choose (no time of day). Before the cut-off time (set by the admin, 6 PM by default)
 * today is included; at or after it the list starts tomorrow, so the order is prepared for the next day.
 */
export function listDeliveryDates(now = new Date(), cutoff = DEFAULT_CUTOFF): string[] {
  const start = istMinutes(now) >= toMinutes(cutoff) ? 1 : 0;
  return Array.from({ length: DAYS_AHEAD }, (_, i) => istDate(new Date(now.getTime() + (start + i) * 86400000)));
}

export const isDateBookable = (date: string, now = new Date(), cutoff = DEFAULT_CUTOFF) => listDeliveryDates(now, cutoff).includes(date);

/** Shape kept for older app versions, which expect a list of slots per day: there is now one, "Any time". */
export function listDeliveryDays(now = new Date(), cutoff = DEFAULT_CUTOFF) {
  return listDeliveryDates(now, cutoff).map((date) => ({ date, slots: [{ id: 'day', label: 'Any time', available: true }] }));
}
