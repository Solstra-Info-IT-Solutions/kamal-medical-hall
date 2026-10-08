import type pg from 'pg';
import { pool, hasAfterCommit, type Queryable } from './db.js';
import { emitOrder } from './realtime.js';
import { conflict, notFound } from './http.js';
import { previewUrls, signedBillUrl, signedPrescriptionUrl, type ResourceType } from './services.js';
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
  // One parallel batch: this used to be a batch followed by three more sequential queries (each a cross-region round trip).
  const [items, rx, history, storeRow, reviewRow, partnerFlag, collectionRow] = await Promise.all([
    db.query('select id, name, quantity from order_items where order_id = $1 order by name', [o.id]),
    db.query('select id, public_id, mime_type, size_bytes, resource_type from prescriptions where order_id = $1', [o.id]),
    db.query('select status, reason, created_at from status_history where order_id = $1 order by created_at', [o.id]),
    db.query('select address, phone from store_settings where id = 1'),
    viewer.role === 'delivery_partner' ? Promise.resolve({ rows: [] as Array<Record<string, unknown>> }) : db.query('select id, rating, status from reviews where order_id = $1', [o.id]),
    viewer.role === 'delivery_partner' ? db.query('select can_call_customer from delivery_partners where user_id = $1', [viewer.id]) : Promise.resolve({ rows: [] as Array<Record<string, unknown>> }),
    viewer.role === 'customer' ? Promise.resolve({ rows: [] as Array<Record<string, any>> }) : db.query("select p.collected_via, p.collection_ref, p.collected_at, p.cash_settled_at, p.proof_public_id, p.proof_mime, p.proof_resource_type, u.name as collector from payments p left join users u on u.id = p.collected_by where p.order_id = $1 and p.collected_via is not null limit 1", [o.id]),
  ]);
  const col = collectionRow.rows[0] as Record<string, any> | undefined;
  const staffView = viewer.role !== 'customer';
  const rv = (reviewRow.rows[0] as { id: string; rating: number; status: string } | undefined) ?? null;
  const store = storeRow.rows[0];
  const deliveredAt = history.rows.filter((h) => h.status === 'delivered').at(-1)?.created_at ?? null;
  const bill = o.bill_public_id && viewer.role !== 'delivery_partner'
    ? {
      name: o.bill_name ?? `Bill-${o.order_number}`, mimeType: o.bill_mime, sizeBytes: o.bill_size, uploadedAt: o.bill_uploaded_at,
      viewUrl: signedBillUrl(o.bill_public_id, o.bill_mime, o.bill_resource_type, false, `Bill-${o.order_number}`),
      previewUrls: previewUrls(o.bill_public_id, o.bill_mime, o.bill_resource_type as ResourceType),
      downloadUrl: signedBillUrl(o.bill_public_id, o.bill_mime, o.bill_resource_type, true, o.bill_name?.replace(/\.[^.]+$/, '') || `Bill-${o.order_number}`),
    }
    : null;
  // Delivery partners only see the customer's phone once they accepted the order, and only if the admin allows calling.
  let phoneVisible = viewer.role === 'admin';
  let canCallCustomer = viewer.role === 'admin';
  if (viewer.role === 'delivery_partner') {
    canCallCustomer = Boolean(partnerFlag.rows[0]?.can_call_customer);
    phoneVisible = canCallCustomer && Boolean(o.partner_accepted_at);
  }
  const address = phoneVisible || viewer.role === 'customer' ? o.address_snapshot : { ...o.address_snapshot, phone: null };
  return {
    id: o.id, orderNumber: o.order_number, kind: o.kind, status: o.status, note: o.note,
    address, partnerAccepted: Boolean(o.partner_accepted_at), canCallCustomer, deliveryDate: o.delivery_date instanceof Date ? o.delivery_date.toISOString().slice(0, 10) : o.delivery_date,
    deliverySlot: o.delivery_slot, quotedAmount: o.quoted_amount === null ? null : Number(o.quoted_amount),
    quoteExpiresAt: o.quote_expires_at, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    rejectionReason: o.rejection_reason, cancelReason: o.cancel_reason, createdAt: o.created_at,
    items: items.rows,
    // Partners never see prescriptions.
    prescriptions: viewer.role === 'delivery_partner' ? [] : rx.rows.map((r) => ({ id: r.id, mimeType: r.mime_type, sizeBytes: r.size_bytes, name: String(r.public_id).split('/').pop(), url: signedPrescriptionUrl(r.public_id, r.mime_type, r.resource_type), previewUrls: previewUrls(r.public_id, r.mime_type, r.resource_type as ResourceType) })),
    collection: col ? {
      via: col.collected_via, reference: col.collection_ref, collectedAt: col.collected_at, collectedBy: col.collector, cashSettledAt: col.cash_settled_at,
      proof: col.proof_public_id ? { url: signedPrescriptionUrl(col.proof_public_id, col.proof_mime, col.proof_resource_type), mimeType: col.proof_mime } : null,
    } : null,
    history: history.rows, deliveredAt, bill, review: rv ? { id: rv.id, rating: rv.rating, status: rv.status } : null,
    store: { name: 'Kamal Medical Hall', address: store?.address ?? null, phone: store?.phone ?? null },
    reviewedBy: staffView ? o.reviewed_by : undefined,
    customer: staffView ? { id: o.customer_id, name: o.customer_name, phone: phoneVisible ? o.customer_phone : null } : undefined,
    partner: o.partner_id && viewer.role !== 'customer' ? { id: o.partner_id, name: o.partner_name, phone: o.partner_phone } : o.partner_id && o.partner_accepted_at ? { id: o.partner_id, name: o.partner_name } : null,
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
