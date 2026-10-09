import { Router } from 'express';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { pool, tx } from '../db.js';
import { HttpError, conflict, notFound, parse } from '../http.js';
import { pushToUsers } from '../notify.js';
import { emitEveryone, emitUser } from '../realtime.js';
import { isBlockedFile, jpgUrl, signedPrescriptionUrl, type ResourceType } from '../services.js';

/**
 * Announcements from the shop to its customers.
 *  - With pictures: shown as a slider at the top of the customer's home screen while active.
 *  - Text only: delivered as an in-app notification (one entry per customer, however many times it is sent).
 * Title is the only required field. An expiry date is optional: with one, the announcement expires by itself at the end of
 * that day; without one it stays live until the admin deactivates it. A push reminder can be sent while it is active.
 */
const imageSchema = z.object({ publicId: z.string().min(3).max(300), mimeType: z.string().max(100), resourceType: z.enum(['image', 'raw', 'video']).default('image'), sizeBytes: z.number().int().max(15_000_000).optional() });
const draftSchema = z.object({
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().max(1000).default(''),
  images: z.array(imageSchema).max(6).default([]),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});

type Row = { id: string; title: string; body: string; images: { publicId: string; mimeType: string; resourceType: ResourceType }[]; expires_at: Date | null; created_at: Date; last_sent_at: Date | null; send_count: number; is_active: boolean };

const isExpired = (r: Row) => r.expires_at !== null && r.expires_at.getTime() <= Date.now();
/** Live = sent, switched on by the admin, and not past its expiry date (no expiry date means it never expires). */
const isLive = (r: Row) => Boolean(r.last_sent_at) && r.is_active && !isExpired(r);
const view = (r: Row) => ({
  id: r.id, title: r.title, body: r.body, expiresAt: r.expires_at, createdAt: r.created_at, lastSentAt: r.last_sent_at, sendCount: r.send_count,
  isActive: r.is_active, active: isLive(r), expired: isExpired(r), status: isExpired(r) ? 'expired' : r.is_active ? 'active' : 'inactive', hasImages: r.images.length > 0,
  images: r.images.map((i) => ({ publicId: i.publicId, mimeType: i.mimeType, url: jpgUrl(i.publicId, i.mimeType, i.resourceType, 1, 1200), fullUrl: signedPrescriptionUrl(i.publicId, i.mimeType, i.resourceType) })),
});
const checkImages = (images: { publicId: string }[], adminId: string) => {
  if (images.some((i) => !i.publicId.startsWith(`announcements/${adminId}/`) || isBlockedFile(i.publicId))) throw new HttpError(400, 'invalid_file', 'Invalid picture.');
};

/** Gives the announcement to every customer. Text-only ones replace any earlier copy in each customer's notifications. */
export async function deliverAnnouncement(id: string) {
  const { rows } = await pool.query('select * from announcements where id = $1', [id]);
  const a = rows[0] as Row | undefined;
  if (!a) throw notFound('Announcement not found');
  if (isExpired(a)) throw conflict('This announcement has expired. Set a new expiry date (or remove it) before sending it again.', 'expired');
  if (!a.is_active) throw conflict('This announcement is switched off. Activate it first.', 'inactive');
  const customers = (await pool.query("select id from users where role = 'customer' and phone not like 'deleted-%'")).rows.map((r) => r.id as string);
  await pool.query('update announcements set last_sent_at = now(), send_count = send_count + 1 where id = $1', [id]);
  if (a.images.length === 0 && customers.length) {
    const up = await pool.query(
      `insert into notifications (user_id, order_id, type, title, body, announcement_id)
       select u, null, 'announcement', $2, $3, $4 from unnest($1::uuid[]) as u
       on conflict (user_id, announcement_id) where announcement_id is not null
       do update set title = excluded.title, body = excluded.body, read_at = null, created_at = now()
       returning id, user_id`, [customers, a.title, a.body || a.title, id]);
    for (const r of up.rows) emitUser(r.user_id, 'notification', { id: r.id, type: 'announcement', title: a.title, body: a.body, orderId: null, announcementId: id });
  }
  emitEveryone('announcement:update', { id });
  void pushToUsers(customers, a.title, a.body.slice(0, 120) || (a.images.length ? 'Tap to see the details' : a.title), { type: 'announcement', announcementId: id }).catch((e) => console.error('announcement push failed', e));
  return customers.length;
}

// ------------------------------------------------------------------ customers
export const announcementsPublic = Router();
/** The announcements that are live now (sent and not yet expired), newest first. */
announcementsPublic.get('/announcements', authed, async (_req, res) => {
  const { rows } = await pool.query('select * from announcements where last_sent_at is not null and is_active and (expires_at is null or expires_at > now()) order by last_sent_at desc limit 20');
  res.json({ announcements: (rows as Row[]).map(view) });
});
announcementsPublic.get('/announcements/:id', authed, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id))) throw notFound('Announcement not found');
  const { rows } = await pool.query('select * from announcements where id = $1 and last_sent_at is not null and is_active', [req.params.id]);
  if (!rows[0]) throw notFound('Announcement not found');
  res.json({ announcement: view(rows[0] as Row) });
});

// ------------------------------------------------------------------ admin
export const announcementsAdmin = Router();
announcementsAdmin.use(authed, requireRole('admin'));
announcementsAdmin.get('/announcements', async (_req, res) => {
  const { rows } = await pool.query('select * from announcements order by coalesce(last_sent_at, created_at) desc limit 200');
  res.json({ announcements: (rows as Row[]).map(view) });
});

/** Creates and sends several announcements at once (the admin prepares a batch, then pushes it). */
announcementsAdmin.post('/announcements', async (req, res) => {
  const b = parse(z.object({ items: z.array(draftSchema).min(1).max(10) }), req.body);
  for (const d of b.items) {
    checkImages(d.images, req.user!.id);
    if (d.expiresAt && new Date(d.expiresAt).getTime() <= Date.now()) throw new HttpError(422, 'expiry_in_past', 'The expiry date must be in the future.');
  }
  const ids = await tx(async (c) => {
    const out: string[] = [];
    for (const d of b.items) {
      const r = await c.query('insert into announcements (title, body, images, expires_at, created_by) values ($1,$2,$3,$4,$5) returning id', [d.title, d.body, JSON.stringify(d.images), d.expiresAt ?? null, req.user!.id]);
      out.push(r.rows[0].id as string);
    }
    return out;
  });
  let reached = 0;
  for (const id of ids) reached = await deliverAnnouncement(id);
  res.status(201).json({ ids, sentTo: reached });
});

/** Edit text, pictures, the expiry date (null removes it) or switch the announcement on or off. */
announcementsAdmin.patch('/announcements/:id', async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(2).max(80).optional(), body: z.string().trim().max(1000).optional(), images: z.array(imageSchema).max(6).optional(), expiresAt: z.string().datetime({ offset: true }).nullable().optional(), isActive: z.boolean().optional() }), req.body);
  if (b.images) checkImages(b.images, req.user!.id);
  if (b.expiresAt && new Date(b.expiresAt).getTime() <= Date.now()) throw new HttpError(422, 'expiry_in_past', 'The expiry date must be in the future.');
  const r = await pool.query(`update announcements set title = coalesce($2, title), body = coalesce($3, body), images = coalesce($4, images),
      expires_at = case when $6::boolean then $5::timestamptz else expires_at end, is_active = coalesce($7, is_active), updated_at = now() where id = $1 returning *`,
    [req.params.id, b.title ?? null, b.body ?? null, b.images ? JSON.stringify(b.images) : null, b.expiresAt ?? null, b.expiresAt !== undefined, b.isActive ?? null]);
  if (!r.rows[0]) throw notFound('Announcement not found');
  emitEveryone('announcement:update', { id: req.params.id });
  res.json({ announcement: view(r.rows[0] as Row) });
});

/** Push reminder: sends it again to every customer. Refused when expired or switched off. */
announcementsAdmin.post('/announcements/:id/send', async (req, res) => {
  const sentTo = await deliverAnnouncement(String(req.params.id));
  res.json({ sentTo, announcement: view((await pool.query('select * from announcements where id = $1', [req.params.id])).rows[0] as Row) });
});

announcementsAdmin.delete('/announcements/:id', async (req, res) => {
  const r = await pool.query('delete from announcements where id = $1 returning id', [req.params.id]);
  if (!r.rows[0]) throw notFound('Announcement not found');
  emitEveryone('announcement:update', { id: req.params.id, deleted: true });
  res.status(204).end();
});
