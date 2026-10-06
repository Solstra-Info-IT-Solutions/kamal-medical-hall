import { Router } from 'express';
import { z } from 'zod';
import { authed, deleteFirebaseUser, invalidateUser, normalisePhone, signDevToken, verified } from '../auth.js';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { HttpError, notFound, parse } from '../http.js';
import { isServiceable, servicePincodes } from '../pincodes.js';
import { listDeliveryDays } from '../slots.js';
import { deletePrescriptionFiles, isBlockedFile, signUpload, signedPrescriptionUrl, type ResourceType } from '../services.js';

export const general = Router();

general.get('/health', (_req, res) => { res.json({ ok: true }); });

/** Public store/delivery configuration. Slots are computed server-side in Asia/Kolkata time. */
general.get('/config', async (_req, res) => {
  const { rows } = await pool.query('select is_open, opening_time, closing_time, address, phone, email, latitude, longitude from store_settings where id = 1');
  const s = rows[0];
  res.json({
    store: { isOpen: s.is_open, openingTime: s.opening_time, closingTime: s.closing_time, address: s.address, phone: s.phone, email: s.email, latitude: s.latitude, longitude: s.longitude },
    deliveryDays: listDeliveryDays(),
    authMode: config.authMode,
  });
});

/** Public terms & conditions text, edited by the store admin. */
general.get('/terms', async (_req, res) => {
  const { rows } = await pool.query('select terms_text, terms_updated_at from store_settings where id = 1');
  res.json({ text: rows[0]?.terms_text ?? '', updatedAt: rows[0]?.terms_updated_at ?? null });
});

// Development only. The route does not exist when AUTH_MODE=firebase.
if (config.authMode === 'dev') {
  general.post('/auth/dev-login', (req, res) => {
    const { phone, otp } = parse(z.object({ phone: z.string(), otp: z.string() }), req.body);
    if (otp !== '123456') throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
    res.json({ token: signDevToken(normalisePhone(phone)) });
  });
}

type UserRow = { id: string; phone: string; role: string; name: string | null; email: string | null; language?: string; avatar_public_id?: string | null; avatar_resource_type?: string | null };
const userView = (u: UserRow) => ({
  id: u.id, phone: u.phone, role: u.role, name: u.name, email: u.email, language: u.language,
  avatarUrl: u.avatar_public_id ? signedPrescriptionUrl(u.avatar_public_id, 'image/jpeg', (u.avatar_resource_type ?? 'image') as ResourceType) : null,
});

/** First call after OTP: creates the customer account if needed and returns the server-assigned role. */
general.post('/auth/session', verified, async (req, res) => {
  const { uid, phone } = req.verified!;
  const { rows } = await pool.query(
    `insert into users (firebase_uid, phone) values ($1, $2)
     on conflict (phone) do update set firebase_uid = excluded.firebase_uid, updated_at = now()
     returning id, phone, role, name, email, language, avatar_public_id, avatar_resource_type`,
    [uid, phone],
  );
  const user = rows[0];
  res.json({ user: userView(user), needsProfile: user.role === 'customer' && !user.name });
});

/** Public list of pincodes we currently deliver to (managed by the store admin). */
general.get('/pincodes', async (_req, res) => {
  res.json({ pincodes: [...(await servicePincodes())].sort() });
});

general.get('/me', authed, (req, res) => { res.json({ user: userView(req.user!) }); });

general.patch('/me', authed, async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    email: z.union([z.string().trim().email().max(120), z.literal('')]).optional(),
    language: z.enum(['en', 'hi']).optional(),
  }), req.body);
  const { rows } = await pool.query(
    `update users set name = coalesce($2, name), email = case when $3::text is null then email else nullif($3, '') end,
       language = coalesce($4, language), updated_at = now() where id = $1 returning id, phone, role, name, email, language, avatar_public_id, avatar_resource_type`,
    [req.user!.id, body.name ?? null, body.email ?? null, body.language ?? null],
  );
  invalidateUser(req.user!.phone);
  res.json({ user: userView(rows[0]) });
});

// ---- Addresses -------------------------------------------------------------
const addressSchema = z.object({
  label: z.enum(['home', 'office', 'other']).default('home'),
  recipientName: z.string().trim().min(2).max(80),
  phone: z.string().transform(normalisePhone),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
const addressView = (a: Record<string, unknown>) => ({
  id: a.id, label: a.label, recipientName: a.recipient_name, phone: a.phone, line1: a.line1, line2: a.line2,
  landmark: a.landmark, pincode: a.pincode, city: a.city, latitude: a.latitude, longitude: a.longitude,
});
async function assertServiceable(pincode: string) {
  if (!(await isServiceable(pincode))) throw new HttpError(422, 'unsupported_pincode', 'Sorry, we do not deliver to this pincode yet.');
}

general.get('/addresses', authed, async (req, res) => {
  const { rows } = await pool.query('select * from addresses where user_id = $1 order by created_at', [req.user!.id]);
  res.json({ addresses: rows.map(addressView) });
});

general.post('/addresses', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);
  await assertServiceable(a.pincode);
  const { rows } = await pool.query(
    `insert into addresses (user_id, label, recipient_name, phone, line1, line2, landmark, pincode, latitude, longitude)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.user!.id, a.label, a.recipientName, a.phone, a.line1, a.line2 ?? null, a.landmark ?? null, a.pincode, a.latitude ?? null, a.longitude ?? null],
  );
  res.status(201).json({ address: addressView(rows[0]) });
});

general.put('/addresses/:id', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);
  await assertServiceable(a.pincode);
  const { rows } = await pool.query(
    `update addresses set label=$3, recipient_name=$4, phone=$5, line1=$6, line2=$7, landmark=$8, pincode=$9, latitude=$10, longitude=$11
     where id = $1 and user_id = $2 returning *`,
    [req.params.id, req.user!.id, a.label, a.recipientName, a.phone, a.line1, a.line2 ?? null, a.landmark ?? null, a.pincode, a.latitude ?? null, a.longitude ?? null],
  );
  if (!rows[0]) throw notFound('Address not found');
  res.json({ address: addressView(rows[0]) });
});

general.delete('/addresses/:id', authed, async (req, res) => {
  const { rowCount } = await pool.query('delete from addresses where id = $1 and user_id = $2', [req.params.id, req.user!.id]);
  if (!rowCount) throw notFound('Address not found');
  res.status(204).end();
});

// ---- Uploads, notifications, devices ---------------------------------------
general.post('/uploads/sign', authed, (req, res) => {
  const { purpose } = parse(z.object({ purpose: z.enum(['prescription', 'bill', 'avatar', 'review']).default('prescription') }), req.body ?? {});
  // Customers upload prescriptions and review photos, only the store admin uploads bills, anyone can set a profile picture.
  const role = req.user!.role;
  const allowed = purpose === 'bill' ? role === 'admin' : purpose === 'avatar' ? true : role === 'customer';
  if (!allowed) throw new HttpError(403, 'forbidden', 'Not allowed');
  res.json(signUpload(req.user!.id, purpose));
});

/** Profile picture: the client uploads to Cloudinary with a signed request, then tells us which file it is. */
general.put('/me/avatar', authed, async (req, res) => {
  const b = parse(z.object({ publicId: z.string().min(3).max(300), resourceType: z.enum(['image']).default('image') }), req.body);
  if (!b.publicId.startsWith(`avatars/${req.user!.id}/`) || isBlockedFile(b.publicId)) throw new HttpError(400, 'invalid_file', 'Invalid picture.');
  const { rows } = await pool.query(
    'update users set avatar_public_id = $2, avatar_resource_type = $3, updated_at = now() where id = $1 returning id, phone, role, name, email, language, avatar_public_id, avatar_resource_type',
    [req.user!.id, b.publicId, b.resourceType]);
  invalidateUser(req.user!.phone);
  res.json({ user: userView(rows[0]) });
});
general.delete('/me/avatar', authed, async (req, res) => {
  const { rows } = await pool.query(
    'update users set avatar_public_id = null, updated_at = now() where id = $1 returning id, phone, role, name, email, language, avatar_public_id, avatar_resource_type', [req.user!.id]);
  invalidateUser(req.user!.phone);
  res.json({ user: userView(rows[0]) });
});

general.get('/notifications', authed, async (req, res) => {
  const { rows } = await pool.query(
    `select n.id, n.type, n.title, n.body, n.read_at, n.created_at, n.order_id, o.order_number
     from notifications n left join orders o on o.id = n.order_id where n.user_id = $1 order by n.created_at desc limit 100`,
    [req.user!.id],
  );
  res.json({ notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: Boolean(n.read_at), createdAt: n.created_at, orderId: n.order_id, orderNumber: n.order_number })) });
});

general.post('/notifications/read-all', authed, async (req, res) => {
  await pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [req.user!.id]);
  res.status(204).end();
});

/** Marks just this one notification as read. */
general.post('/notifications/:id/read', authed, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) throw new HttpError(404, 'not_found', 'Not found');
  await pool.query('update notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

/** Removes every notification of the signed-in user. */
general.delete('/notifications', authed, async (req, res) => {
  await pool.query('delete from notifications where user_id = $1', [req.user!.id]);
  res.status(204).end();
});

/** Removes one notification. */
general.delete('/notifications/:id', authed, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) throw new HttpError(404, 'not_found', 'Not found');
  await pool.query('delete from notifications where id = $1 and user_id = $2', [req.params.id, req.user!.id]);
  res.status(204).end();
});

general.post('/devices', authed, async (req, res) => {
  const { token, platform } = parse(z.object({ token: z.string().min(10).max(4096), platform: z.enum(['android', 'ios']).optional() }), req.body);
  await pool.query(
    `insert into device_tokens (token, user_id, platform) values ($1,$2,$3)
     on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()`,
    [token, req.user!.id, platform ?? null],
  );
  res.status(204).end();
});

// ---- Account deletion ------------------------------------------------------
const OPEN_STATUSES = "('requested','quoted','accepted','awaiting_payment','ready_to_dispatch','out_for_delivery')";

/**
 * Customer self-service account deletion. Personal data (profile, addresses, device tokens, notifications,
 * prescriptions, typed medicines, notes) is removed; completed order rows are kept in anonymised form
 * (amounts and dates only) for the store's accounting. Blocked while an order is still in progress.
 */
general.delete('/me', authed, async (req, res) => {
  const user = req.user!;
  if (user.role !== 'customer') throw new HttpError(403, 'not_allowed', 'Staff accounts are removed by the store admin.');
  const open = await pool.query(`select 1 from orders where customer_id = $1 and status in ${OPEN_STATUSES} limit 1`, [user.id]);
  if (open.rows[0]) throw new HttpError(409, 'active_orders', 'You have an order in progress. Please wait until it is delivered or cancel it first.');

  const uid = (await pool.query('select firebase_uid from users where id = $1', [user.id])).rows[0]?.firebase_uid ?? null;
  const files = (await pool.query('select p.public_id from prescriptions p join orders o on o.id = p.order_id where o.customer_id = $1', [user.id])).rows.map((r) => r.public_id as string);
  await tx(async (c) => {
    await c.query('delete from prescriptions where order_id in (select id from orders where customer_id = $1)', [user.id]);
    await c.query('delete from order_items where order_id in (select id from orders where customer_id = $1)', [user.id]);
    await c.query(`update orders set note = null, address_snapshot = jsonb_build_object('redacted', true, 'pincode', address_snapshot->>'pincode') where customer_id = $1`, [user.id]);
    await c.query('delete from addresses where user_id = $1', [user.id]);
    await c.query('delete from device_tokens where user_id = $1', [user.id]);
    await c.query('delete from notifications where user_id = $1', [user.id]);
    await c.query(`update users set name = null, email = null, firebase_uid = null, phone = 'deleted-' || id::text, updated_at = now() where id = $1`, [user.id]);
  });
  invalidateUser(user.phone);
  await deletePrescriptionFiles(files);
  await deleteFirebaseUser(uid);
  res.status(204).end();
});
