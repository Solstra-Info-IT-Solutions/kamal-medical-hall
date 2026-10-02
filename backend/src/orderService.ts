import type pg from 'pg';
import { pool, hasAfterCommit, type Queryable } from './db.js';
import { emitOrder } from './realtime.js';
import { conflict, notFound } from './http.js';
import { signedPrescriptionUrl } from './services.js';
import type { AuthUser } from './auth.js';

export type OrderStatus = 'requested' | 'quoted' | 'accepted' | 'awaiting_payment' | 'ready_to_dispatch' | 'out_for_delivery' | 'delivered' | 'rejected' | 'cancelled';

/** Statuses from which the customer or the store may still cancel (before the order leaves the store). */
export const CANCELLABLE: OrderStatus[] = ['requested', 'quoted', 'accepted', 'awaiting_payment', 'ready_to_dispatch'];

const ORDER_SQL = `
  select o.*, c.name as customer_name, c.phone as customer_phone, p.name as partner_name, p.phone as partner_phone
  from orders o join users c on c.id = o.customer_id left join users p on p.id = o.partner_id`;

export async function loadOrder(id: string, viewer: AuthUser, db: Queryable = pool) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(id);
  const { rows } = await db.query(`${ORDER_SQL} where ${isUuid ? 'o.id' : 'o.order_number'} = $1`, [id]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  const allowed = viewer.role === 'admin' || (viewer.role === 'customer' && o.customer_id === viewer.id) || (viewer.role === 'delivery_partner' && o.partner_id === viewer.id);
  if (!allowed) throw notFound('Order not found'); // do not reveal other users' orders
  const [items, rx, history] = await Promise.all([
    db.query('select id, name, quantity from order_items where order_id = $1 order by name', [o.id]),
    db.query('select id, public_id, mime_type, size_bytes from prescriptions where order_id = $1', [o.id]),
    db.query('select status, reason, created_at from status_history where order_id = $1 order by created_at', [o.id]),
  ]);
  const staffView = viewer.role !== 'customer';
  return {
    id: o.id, orderNumber: o.order_number, kind: o.kind, status: o.status, note: o.note,
    address: o.address_snapshot, deliveryDate: o.delivery_date instanceof Date ? o.delivery_date.toISOString().slice(0, 10) : o.delivery_date,
    deliverySlot: o.delivery_slot, quotedAmount: o.quoted_amount === null ? null : Number(o.quoted_amount),
    quoteExpiresAt: o.quote_expires_at, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    rejectionReason: o.rejection_reason, cancelReason: o.cancel_reason, createdAt: o.created_at,
    items: items.rows,
    // Partners never see prescriptions.
    prescriptions: viewer.role === 'delivery_partner' ? [] : rx.rows.map((r) => ({ id: r.id, mimeType: r.mime_type, sizeBytes: r.size_bytes, url: signedPrescriptionUrl(r.public_id, r.mime_type) })),
    history: history.rows,
    reviewedBy: staffView ? o.reviewed_by : undefined,
    customer: staffView ? { id: o.customer_id, name: o.customer_name, phone: o.customer_phone } : undefined,
    partner: o.partner_id && viewer.role !== 'customer' ? { id: o.partner_id, name: o.partner_name, phone: o.partner_phone } : o.partner_id ? { id: o.partner_id, name: o.partner_name } : null,
  };
}

/** Atomic compare-and-set status change; fails with 409 when the order is not in an allowed state. */
export async function transition(
  c: pg.PoolClient | (pg.PoolClient & { afterCommit: (fn: () => void) => void }), orderId: string, from: OrderStatus[], to: OrderStatus, actorId: string | null,
  set: Record<string, unknown> = {}, reason?: string,
) {
  const cols = Object.keys(set);
  const sql = `update orders set status = $1, updated_at = now()${cols.map((k, i) => `, ${k} = $${i + 4}`).join('')}
               where id = $2 and status = any($3::order_status[]) returning *`;
  const { rows } = await c.query(sql, [to, orderId, from, ...cols.map((k) => set[k])]);
  if (!rows[0]) throw conflict('This order can no longer be changed this way. Please refresh.', 'invalid_state');
  await c.query('insert into status_history (order_id, status, actor_id, reason) values ($1,$2,$3,$4)', [orderId, to, actorId, reason ?? null]);
  if (hasAfterCommit(c)) c.afterCommit(() => emitOrder(rows[0]));
  return rows[0];
}
