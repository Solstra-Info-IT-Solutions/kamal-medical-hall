import i18n from './localization';
import type { OrderStatus } from './api/types';

const locale = () => (i18n.language === 'hi' ? 'hi-IN' : 'en-IN');

/** Parses yyyy-mm-dd (or an ISO timestamp) as a calendar date without timezone shifts. */
function toDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}
export const formatDate = (value: string) => toDate(value).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDateTime = (value: string) => new Date(value).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const formatDayChip = (value: string, index: number) => ({
  top: index === 0 ? i18n.t('time.today') : index === 1 ? i18n.t('time.tomorrow') : toDate(value).toLocaleDateString(locale(), { weekday: 'short' }),
  bottom: toDate(value).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }),
});
export const formatMoney = (amount: number) => `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const statusTone = (s: OrderStatus): 'green' | 'red' | 'amber' | 'blue' =>
  s === 'delivered' ? 'green' : s === 'rejected' || s === 'cancelled' ? 'red' : s === 'quoted' || s === 'awaiting_payment' ? 'amber' : 'blue';

export const ACTIVE_STATUSES: OrderStatus[] = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch', 'out_for_delivery'];
export const callPhone = (phone: string) => `tel:${phone}`;

/** Today's date in India as YYYY-MM-DD, optionally shifted by whole days. */
export const istDate = (shiftDays = 0) => new Date(Date.now() + 5.5 * 3600000 + shiftDays * 86400000).toISOString().slice(0, 10);
/** DD/MM/YYYY typed by a person -> YYYY-MM-DD, or null when it is not a real date. */
export function parseDmy(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}
/** Adds the slashes while the person types digits. */
export const maskDmy = (text: string) => {
  const d = text.replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};
