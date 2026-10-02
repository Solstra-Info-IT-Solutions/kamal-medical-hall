import { config } from './config.js';

export const SLOTS = [
  { id: '09-11', label: '9:00 AM - 11:00 AM', startHour: 9 },
  { id: '11-13', label: '11:00 AM - 1:00 PM', startHour: 11 },
  { id: '13-15', label: '1:00 PM - 3:00 PM', startHour: 13 },
  { id: '15-17', label: '3:00 PM - 5:00 PM', startHour: 15 },
  { id: '17-19', label: '5:00 PM - 7:00 PM', startHour: 17 },
  { id: '19-21', label: '7:00 PM - 9:00 PM', startHour: 19 },
] as const;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const DAYS_AHEAD = 4;

/** yyyy-mm-dd for the calendar date in Asia/Kolkata. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function slotStart(date: string, startHour: number): Date {
  return new Date(Date.parse(`${date}T${String(startHour).padStart(2, '0')}:00:00.000Z`) - IST_OFFSET_MS);
}

export function isSlotBookable(date: string, slotId: string, now = new Date()): boolean {
  const slot = SLOTS.find((s) => s.id === slotId);
  if (!slot) return false;
  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => istDate(new Date(now.getTime() + i * 86400000)));
  if (!days.includes(date)) return false;
  return slotStart(date, slot.startHour).getTime() >= now.getTime() + config.minLeadMinutes * 60000;
}

export function listDeliveryDays(now = new Date()) {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const date = istDate(new Date(now.getTime() + i * 86400000));
    return { date, slots: SLOTS.map((s) => ({ id: s.id, label: s.label, available: isSlotBookable(date, s.id, now) })) };
  });
}
