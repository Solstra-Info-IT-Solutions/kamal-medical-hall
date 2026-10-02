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
