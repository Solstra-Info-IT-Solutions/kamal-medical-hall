import { Router } from 'express';
import { z } from 'zod';
import { authed, normalisePhone, signDevToken, verified } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError, notFound, parse } from '../http.js';
import { SERVICE_PINCODES } from '../serviceArea.js';
import { listDeliveryDays } from '../slots.js';
import { signUpload } from '../services.js';

export const general = Router();

general.get('/health', (_req, res) => { res.json({ ok: true }); });

/** Public store/delivery configuration. Slots are computed server-side in Asia/Kolkata time. */
general.get('/config', async (_req, res) => {
  const { rows } = await pool.query('select is_open, opening_time, closing_time, address, phone, email from store_settings where id = 1');
  const s = rows[0];
  res.json({
    store: { isOpen: s.is_open, openingTime: s.opening_time, closingTime: s.closing_time, address: s.address, phone: s.phone, email: s.email },
    deliveryDays: listDeliveryDays(),
    authMode: config.authMode,
  });
});

// Development only. The route does not exist when AUTH_MODE=firebase.
if (config.authMode === 'dev') {
  general.post('/auth/dev-login', (req, res) => {
    const { phone, otp } = parse(z.object({ phone: z.string(), otp: z.string() }), req.body);
    if (otp !== '123456') throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
    res.json({ token: signDevToken(normalisePhone(phone)) });
  });
}

const userView = (u: { id: string; phone: string; role: string; name: string | null; email: string | null; language?: string }) =>
  ({ id: u.id, phone: u.phone, role: u.role, name: u.name, email: u.email, language: u.language });

/** First call after OTP: creates the customer account if needed and returns the server-assigned role. */
general.post('/auth/session', verified, async (req, res) => {
  const { uid, phone } = req.verified!;
  const { rows } = await pool.query(
    `insert into users (firebase_uid, phone) values ($1, $2)
     on conflict (phone) do update set firebase_uid = excluded.firebase_uid, updated_at = now()
     returning id, phone, role, name, email, language`,
    [uid, phone],
  );
  const user = rows[0];
  res.json({ user: userView(user), needsProfile: user.role === 'customer' && !user.name });
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
       language = coalesce($4, language), updated_at = now() where id = $1 returning id, phone, role, name, email, language`,
    [req.user!.id, body.name ?? null, body.email ?? null, body.language ?? null],
  );
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
function assertServiceable(pincode: string) {
  if (!SERVICE_PINCODES.has(pincode)) throw new HttpError(422, 'unsupported_pincode', 'Sorry, we do not deliver to this pincode yet.');
}

general.get('/addresses', authed, async (req, res) => {
  const { rows } = await pool.query('select * from addresses where user_id = $1 order by created_at', [req.user!.id]);
  res.json({ addresses: rows.map(addressView) });
});

general.post('/addresses', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);
  assertServiceable(a.pincode);
  const { rows } = await pool.query(
    `insert into addresses (user_id, label, recipient_name, phone, line1, line2, landmark, pincode, latitude, longitude)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [req.user!.id, a.label, a.recipientName, a.phone, a.line1, a.line2 ?? null, a.landmark ?? null, a.pincode, a.latitude ?? null, a.longitude ?? null],
  );
  res.status(201).json({ address: addressView(rows[0]) });
});

general.put('/addresses/:id', authed, async (req, res) => {
  const a = parse(addressSchema, req.body);
  assertServiceable(a.pincode);
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
  if (req.user!.role !== 'customer') throw new HttpError(403, 'forbidden', 'Not allowed');
  res.json(signUpload(req.user!.id));
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

general.post('/devices', authed, async (req, res) => {
  const { token, platform } = parse(z.object({ token: z.string().min(10).max(4096), platform: z.enum(['android', 'ios']).optional() }), req.body);
  await pool.query(
    `insert into device_tokens (token, user_id, platform) values ($1,$2,$3)
     on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()`,
    [token, req.user!.id, platform ?? null],
  );
  res.status(204).end();
});
