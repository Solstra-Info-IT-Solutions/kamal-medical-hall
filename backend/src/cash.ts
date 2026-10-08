import { pool, tx, type Queryable } from './db.js';
import { notifyAdmins } from './notify.js';
import { emitAdmins } from './realtime.js';

const DAY_START = "date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'";
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export interface CashPartner { partnerId: string; name: string; phone: string; total: number; orders: { orderId: string; orderNumber: string; amount: number; collectedAt: string }[] }

/** Cash the delivery partners collected from customers and have not yet handed to the shop. */
export async function cashToCollect(db: Queryable = pool): Promise<{ total: number; partners: CashPartner[] }> {
  const { rows } = await db.query(`
    select p.collected_by as partner_id, u.name, u.phone, o.id as order_id, o.order_number, p.amount, p.collected_at
    from payments p join orders o on o.id = p.order_id join users u on u.id = p.collected_by
    where p.method = 'cod' and p.collected_via = 'cash' and p.cash_settled_at is null and p.status = 'cod_collected'
    order by u.name, p.collected_at`);
  const by = new Map<string, CashPartner>();
  for (const r of rows) {
    const e: CashPartner = by.get(r.partner_id) ?? { partnerId: r.partner_id, name: r.name ?? 'Delivery partner', phone: r.phone, total: 0, orders: [] };
    e.total += Number(r.amount);
    e.orders.push({ orderId: r.order_id, orderNumber: r.order_number, amount: Number(r.amount), collectedAt: r.collected_at });
    by.set(r.partner_id, e);
  }
  const partners = [...by.values()];
  return { total: partners.reduce((s, p) => s + p.total, 0), partners };
}

/** Today's takings (delivered orders), split by how they were paid. */
export async function todayRevenue(db: Queryable = pool) {
  const { rows } = await db.query(`
    select count(*)::int as orders, coalesce(sum(quoted_amount), 0) as total,
           coalesce(sum(quoted_amount) filter (where payment_method = 'razorpay'), 0) as online,
           coalesce(sum(quoted_amount) filter (where payment_method = 'cod'), 0) as cod
    from orders where status = 'delivered' and updated_at >= ${DAY_START}`);
  const r = rows[0];
  return { orders: r.orders as number, total: Number(r.total), online: Number(r.online), cod: Number(r.cod) };
}

export async function closingSummary(db: Queryable = pool) {
  const [revenue, cash, store] = await Promise.all([todayRevenue(db), cashToCollect(db), db.query('select closing_time, is_open from store_settings where id = 1')]);
  return { closingTime: store.rows[0]?.closing_time as string, isOpen: Boolean(store.rows[0]?.is_open), revenue, cash };
}

/** The one-line message admins get: today's revenue and who has to hand over how much. */
export function closingMessage(s: Awaited<ReturnType<typeof closingSummary>>) {
  const staff = s.cash.partners.length ? `Collect cash: ${s.cash.partners.map((p) => `${p.name} ${inr(p.total)}`).join(', ')} (total ${inr(s.cash.total)}).` : 'No cash to collect from staff.';
  return `Today's revenue ${inr(s.revenue.total)} from ${s.revenue.orders} order${s.revenue.orders === 1 ? '' : 's'} (online ${inr(s.revenue.online)}, cash/UPI on delivery ${inr(s.revenue.cod)}). ${staff}`;
}

/** Marks the cash of a partner (all of it, or only the given orders) as handed over; those orders become fully paid. */
export async function settleCash(adminId: string, partnerId: string, orderIds?: string[]) {
  return tx(async (c) => {
    const { rows } = await c.query(`
      update payments p set cash_settled_at = now(), cash_settled_by = $1
      where p.method = 'cod' and p.collected_via = 'cash' and p.cash_settled_at is null and p.status = 'cod_collected' and p.collected_by = $2
        and ($3::uuid[] is null or p.order_id = any($3::uuid[]))
      returning p.order_id, p.amount`, [adminId, partnerId, orderIds?.length ? orderIds : null]);
    if (rows.length) {
      await c.query("update payments set status = 'paid' where order_id = any($1::uuid[]) and method = 'cod'", [rows.map((r) => r.order_id)]);
      await c.query("update orders set payment_status = 'paid', updated_at = now() where id = any($1::uuid[])", [rows.map((r) => r.order_id)]);
    }
    return { settled: rows.length, amount: rows.reduce((s, r) => s + Number(r.amount), 0) };
  });
}

/** "HH:MM" -> minutes since midnight. */
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const istNow = () => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)!.value; return { day: `${g('year')}-${g('month')}-${g('day')}`, mins: Number(g('hour')) * 60 + Number(g('minute')) }; };

/**
 * Runs every minute. From one hour before closing time the admins get one alert a day (push + live popup) with the
 * day's revenue and how much cash each staff member still has to hand in. The day is recorded first, so a restart
 * or a second instance cannot send it twice.
 */
export async function closingAlertTick() {
  const { rows } = await pool.query('select closing_time, is_open, closing_alert_day::text as done from store_settings where id = 1');
  const s = rows[0];
  if (!s?.is_open || !s.closing_time) return;
  const now = istNow();
  const closes = minutes(s.closing_time);
  if (s.done === now.day || now.mins < closes - 60 || now.mins > closes + 30) return;
  const claimed = await pool.query("update store_settings set closing_alert_day = $1::date where id = 1 and closing_alert_day is distinct from $1::date returning 1", [now.day]);
  if (!claimed.rows.length) return;
  const summary = await closingSummary();
  const message = closingMessage(summary);
  await notifyAdmins(null, 'closing_alert', 'Store closes in 1 hour', message);
  emitAdmins('closing:alert', { message, ...summary });
}
