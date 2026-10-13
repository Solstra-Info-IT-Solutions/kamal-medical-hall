import { Router } from 'express';
import { z } from 'zod';
import { authed, invalidateUser, normalisePhone, requireRole } from '../auth.js';
import { pool, tx } from '../db.js';
import { HttpError, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { accountRequestView, profileSchema } from './general.js';

/**
 * Customer accounts.
 *  - A customer asks to deactivate their account (or, once deactivated, to activate it again) with a short form.
 *    Nothing changes until the admin approves; the customer is told the outcome either way.
 *  - The admin manages customers: list with search and status filter, add, edit, activate / deactivate directly,
 *    and decide on requests.
 * A deactivated customer can sign in but only sees their account status and the reactivation form (see `authed`).
 */
export const accountRouter = Router();
accountRouter.use(authed, requireRole('customer'));

const REQUEST_COLUMNS = 'id, kind, reason, details, status, admin_note, created_at, decided_at';

accountRouter.get('/requests', async (req, res) => {
  const { rows } = await pool.query(`select ${REQUEST_COLUMNS} from account_requests where user_id = $1 order by created_at desc limit 20`, [req.user!.id]);
  res.json({ requests: rows.map(accountRequestView) });
});

accountRouter.post('/requests', async (req, res) => {
  const b = parse(z.object({
    kind: z.enum(['deactivate', 'reactivate']),
    reason: z.string().trim().min(3, 'Please choose or write a reason').max(120),
    details: z.string().trim().max(1000).optional(),
  }), req.body);
  const user = req.user!;
  const active = user.is_active !== false;
  if (b.kind === 'deactivate' && !active) throw new HttpError(409, 'already_deactivated', 'Your account is already deactivated.');
  if (b.kind === 'reactivate' && active) throw new HttpError(409, 'already_active', 'Your account is already active.');
  let row;
  try {
    row = (await pool.query(
      `insert into account_requests (user_id, kind, reason, details) values ($1, $2, $3, nullif($4, '')) returning ${REQUEST_COLUMNS}`,
      [user.id, b.kind, b.reason, b.details ?? null],
    )).rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'request_pending', 'You already have a request waiting for the store. You can cancel it first.');
    throw e;
  }
  const who = `${user.name ?? 'A customer'} (+91 ${user.phone})`;
  await notifyAdmins(null, 'account_request', b.kind === 'deactivate' ? 'Account deactivation request' : 'Account reactivation request', `${who}: ${b.reason}`);
  res.status(201).json({ request: accountRequestView(row) });
});

accountRouter.delete('/requests/:id', async (req, res) => {
  const { rowCount } = await pool.query("update account_requests set status = 'cancelled', decided_at = now() where id = $1 and user_id = $2 and status = 'pending'", [req.params.id, req.user!.id]);
  if (!rowCount) throw notFound('No pending request to cancel');
  res.status(204).end();
});

// ============================================================ Admin
export const customersAdmin = Router();
customersAdmin.use(authed, requireRole('admin'));

const CUSTOMER_COLUMNS = `u.id, u.name, u.phone, u.email, u.gender, to_char(u.date_of_birth, 'YYYY-MM-DD') as date_of_birth, u.city, u.is_active, u.deactivated_at, u.created_at, u.signed_up_at`;
const customerView = (r: Record<string, unknown>) => ({
  id: r.id, name: r.name ?? null, phone: r.phone, email: r.email ?? null, gender: r.gender ?? null, dateOfBirth: r.date_of_birth ?? null, city: r.city ?? null,
  isActive: r.is_active !== false, deactivatedAt: r.deactivated_at ?? null, joinedAt: r.created_at, signedUp: Boolean(r.signed_up_at),
  orderCount: r.order_count === undefined ? undefined : Number(r.order_count), pendingRequest: r.pending_kind ? { kind: r.pending_kind } : null,
});

customersAdmin.get('/customers', async (req, res) => {
  const q = parse(z.object({
    search: z.string().trim().max(40).optional(),
    status: z.enum(['all', 'active', 'deactivated']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }), req.query);
  const where = `u.role = 'customer' and u.phone not like 'deleted-%'
    and ($1::text is null or u.phone like '%' || $1 || '%' or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%' or u.city ilike '%' || $1 || '%')
    and ($2 = 'all' or ($2 = 'active') = u.is_active)`;
  const [list, counts] = await Promise.all([
    pool.query(
      `select ${CUSTOMER_COLUMNS}, (select count(*) from orders o where o.customer_id = u.id) as order_count,
         (select r.kind from account_requests r where r.user_id = u.id and r.status = 'pending' limit 1) as pending_kind
       from users u where ${where} order by u.created_at desc limit $3 offset $4`,
      [q.search ?? null, q.status, q.limit, q.offset]),
    pool.query(`select count(*) filter (where is_active) as active, count(*) filter (where not is_active) as deactivated,
        (select count(*) from account_requests where status = 'pending') as pending
      from users where role = 'customer' and phone not like 'deleted-%'`),
  ]);
  const c = counts.rows[0];
  res.json({ customers: list.rows.map(customerView), counts: { active: +c.active, deactivated: +c.deactivated, pendingRequests: +c.pending } });
});

customersAdmin.get('/customers/:id', async (req, res) => {
  const u = (await pool.query(`select ${CUSTOMER_COLUMNS} from users u where u.id = $1 and u.role = 'customer'`, [req.params.id])).rows[0];
  if (!u) throw notFound('Customer not found');
  const [orders, totals, requests, addresses] = await Promise.all([
    pool.query('select id, order_number, status, quoted_amount, created_at from orders where customer_id = $1 order by created_at desc limit 20', [u.id]),
    pool.query(`select count(*) as orders, count(*) filter (where status = 'delivered') as delivered, coalesce(sum(quoted_amount) filter (where status = 'delivered'), 0) as lifetime from orders where customer_id = $1`, [u.id]),
    pool.query(`select ${REQUEST_COLUMNS} from account_requests where user_id = $1 order by created_at desc limit 20`, [u.id]),
    pool.query('select line1, line2, landmark, pincode, city from addresses where user_id = $1 order by created_at limit 5', [u.id]),
  ]);
  res.json({
    customer: customerView(u),
    orderCount: +totals.rows[0].orders, deliveredCount: +totals.rows[0].delivered, lifetimeValue: Number(totals.rows[0].lifetime),
    orders: orders.rows.map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, amount: o.quoted_amount === null ? null : Number(o.quoted_amount), createdAt: o.created_at })),
    requests: requests.rows.map(accountRequestView),
    addresses: addresses.rows.map((a) => [a.line1, a.line2, a.landmark, a.city, a.pincode].filter(Boolean).join(', ')),
  });
});

/** The admin adds a customer (for example someone who phoned the shop). They sign in later with this number. */
customersAdmin.post('/customers', async (req, res) => {
  const b = parse(profileSchema.extend({ phone: z.string().min(10).max(15) }), req.body);
  const phone = normalisePhone(b.phone);
  const { rows } = await pool.query(
    `insert into users (phone, role, name, email, gender, date_of_birth, city, signed_up_at)
     values ($1, 'customer', $2, nullif($3, ''), $4, $5::date, nullif($6, ''), now()) on conflict (phone) do nothing returning id`,
    [phone, b.name, b.email ?? null, b.gender ?? null, b.dateOfBirth ?? null, b.city ?? null]);
  if (!rows[0]) throw new HttpError(409, 'already_registered', 'This mobile number already has an account.');
  const u = (await pool.query(`select ${CUSTOMER_COLUMNS} from users u where u.id = $1`, [rows[0].id])).rows[0];
  res.status(201).json({ customer: customerView(u) });
});

customersAdmin.patch('/customers/:id', async (req, res) => {
  const b = parse(profileSchema.partial(), req.body);
  const { rows } = await pool.query(
    `update users set name = coalesce($2, name), email = case when $3::text is null then email else nullif($3, '') end,
       gender = case when $4 then $5 else gender end, date_of_birth = case when $6 then $7::date else date_of_birth end,
       city = case when $8::text is null then city else nullif($8, '') end, updated_at = now()
     where id = $1 and role = 'customer' returning phone`,
    [req.params.id, b.name ?? null, b.email ?? null, b.gender !== undefined, b.gender ?? null, b.dateOfBirth !== undefined, b.dateOfBirth ?? null, b.city ?? null]);
  if (!rows[0]) throw notFound('Customer not found');
  invalidateUser(rows[0].phone);
  const u = (await pool.query(`select ${CUSTOMER_COLUMNS} from users u where u.id = $1`, [req.params.id])).rows[0];
  res.json({ customer: customerView(u) });
});

const OPEN_STATUSES = "('requested','quoted','accepted','awaiting_payment','ready_to_dispatch','out_for_delivery')";

/** Sets a customer active or not. Shared by the direct switch and by approving a request. */
async function setActive(userId: string, active: boolean, adminId: string, note: string | null, requestId?: string) {
  return tx(async (c) => {
    const u = (await c.query("select id, phone, is_active from users where id = $1 and role = 'customer' for update", [userId])).rows[0];
    if (!u) throw notFound('Customer not found');
    if (!active) {
      const open = await c.query(`select order_number from orders where customer_id = $1 and status in ${OPEN_STATUSES} limit 1`, [userId]);
      if (open.rows[0]) throw new HttpError(409, 'active_orders', `Order #${open.rows[0].order_number} is still in progress. Finish or cancel it before deactivating this account.`);
    }
    await c.query('update users set is_active = $2, deactivated_at = case when $2 then null else now() end, updated_at = now() where id = $1', [userId, active]);
    // A direct switch also settles a matching pending request; any other pending request no longer applies.
    await c.query(
      `update account_requests set status = case when id = $2 or kind = $3 then 'approved' else 'cancelled' end, admin_note = coalesce($4, admin_note), decided_by = $5, decided_at = now()
       where user_id = $1 and status = 'pending'`,
      [userId, requestId ?? null, active ? 'reactivate' : 'deactivate', note, adminId]);
    await notify(userId, null, active ? 'account_reactivated' : 'account_deactivated',
      active ? 'Your account is active again' : 'Your account has been deactivated',
      (active ? 'Welcome back! You can order again.' : 'You can ask the store to activate it again from the app at any time.') + (note ? ` Note from the store: ${note}` : ''), c);
    return u.phone as string;
  });
}

customersAdmin.post('/customers/:id/status', async (req, res) => {
  const b = parse(z.object({ active: z.boolean(), note: z.string().trim().max(300).optional() }), req.body);
  const phone = await setActive(req.params.id as string, b.active, req.user!.id, b.note || null);
  invalidateUser(phone);
  res.status(204).end();
});

customersAdmin.get('/account-requests', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['pending', 'all']).default('pending') }), req.query);
  const { rows } = await pool.query(
    `select r.id, r.kind, r.reason, r.details, r.status, r.admin_note, r.created_at, r.decided_at, u.id as user_id, u.name, u.phone, u.is_active
     from account_requests r join users u on u.id = r.user_id
     where ($1 = 'all' or r.status = 'pending') order by (r.status = 'pending') desc, r.created_at desc limit 100`, [q.status]);
  res.json({ requests: rows.map((r) => ({ ...accountRequestView(r), customer: { id: r.user_id, name: r.name, phone: r.phone, isActive: r.is_active } })) });
});

customersAdmin.post('/account-requests/:id/decide', async (req, res) => {
  const b = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() }), req.body);
  const r = (await pool.query("select id, user_id, kind from account_requests where id = $1 and status = 'pending'", [req.params.id])).rows[0];
  if (!r) throw notFound('This request was already handled');
  if (b.approve) {
    invalidateUser(await setActive(r.user_id, r.kind === 'reactivate', req.user!.id, b.note || null, r.id));
  } else {
    await tx(async (c) => {
      await c.query("update account_requests set status = 'rejected', admin_note = $2, decided_by = $3, decided_at = now() where id = $1", [r.id, b.note || null, req.user!.id]);
      await notify(r.user_id, null, 'account_request_rejected', r.kind === 'deactivate' ? 'Deactivation request declined' : 'Reactivation request declined',
        b.note ? `Note from the store: ${b.note}` : 'Please contact the store for details.', c);
    });
  }
  res.status(204).end();
});
