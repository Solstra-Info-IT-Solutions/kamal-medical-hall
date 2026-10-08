import { Router } from 'express';
import { z } from 'zod';
import { authed, requireRole } from '../auth.js';
import { pool, tx } from '../db.js';
import { parse } from '../http.js';

/**
 * The medical shop's profile: who and where it is, how to reach it, its licences and its branches.
 * Everything is optional, the admin fills in what applies. Customers see everything except the PAN number.
 */
const text = (max: number) => z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v), z.string().max(max).optional());
const phone = z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.replace(/[\s\-().]/g, '')) : v), z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid phone number').optional());
const pincode = z.preprocess((v) => (typeof v === 'string' ? (v.trim() || undefined) : v), z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional());
const url = z.preprocess((v) => (typeof v === 'string' ? (v.trim() || undefined) : v), z.string().max(300).regex(/^https?:\/\/\S+$/i, 'Enter a full link starting with http:// or https://').optional());
const email = z.preprocess((v) => (typeof v === 'string' ? (v.trim() || undefined) : v), z.string().max(120).email('Enter a valid email').optional());
const upper = (re: RegExp, msg: string) => z.preprocess((v) => (typeof v === 'string' ? (v.replace(/\s+/g, '').toUpperCase() || undefined) : v), z.string().regex(re, msg).optional());

const address = z.object({ line1: text(160), line2: text(160), area: text(80), landmark: text(120), city: text(60), state: text(60), pincode }).default({});
const branch = z.object({
  name: text(80), address: text(300), city: text(60), pincode, phone, hours: text(120), mapsUrl: url,
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const shopSchema = z.object({
  name: text(80), tagline: text(120), about: text(1000), ownerName: text(80), establishedYear: z.preprocess((v) => (v === '' || v === null ? undefined : typeof v === 'string' ? Number(v) : v), z.number().int().min(1900).max(2100).optional()),
  address,
  latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(), mapsUrl: url,
  phones: z.array(z.object({ label: text(30), number: phone })).max(5).default([]),
  whatsapp: phone, email, website: url, hoursNote: text(200),
  licence: z.object({
    drugLicense1: text(60), drugLicense2: text(60), drugLicenseValidTill: text(20),
    gstin: upper(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'GST number should be 15 characters, like 08ABCDE1234F1Z5'),
    pan: upper(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN should be 10 characters, like ABCDE1234F'),
    fssai: text(20), pharmacistName: text(80), pharmacistRegNo: text(40),
  }).default({}),
  services: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  paymentModes: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  social: z.object({ facebook: url, instagram: url }).default({}),
  branches: z.array(branch).max(20).default([]),
});
export type ShopDetails = z.infer<typeof shopSchema>;

const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)); // drops undefined

/** One line the invoice and store settings can print. */
export function addressLine(d: ShopDetails) {
  const a = d.address;
  return [a.line1, a.line2, a.area, a.city, [a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

async function load(db = pool) {
  const { rows } = await db.query('select details, updated_at from shop_profile where id = 1');
  return { details: (rows[0]?.details ?? {}) as Partial<ShopDetails>, updatedAt: rows[0]?.updated_at as string | undefined };
}

const publicView = (d: Partial<ShopDetails>) => {
  const { licence, ...rest } = d;
  const { pan: _pan, ...safeLicence } = licence ?? {};
  return { ...rest, licence: safeLicence };
};

export const shopPublic = Router();
/** Public: what the customer app shows on the "About the shop" page. */
shopPublic.get('/shop', async (_req, res) => {
  const [{ details }, store] = await Promise.all([load(), pool.query('select is_open, opening_time, closing_time, address, phone, email, latitude, longitude from store_settings where id = 1')]);
  const s = store.rows[0];
  res.json({ ...publicView(details), isOpen: s.is_open, openingTime: s.opening_time, closingTime: s.closing_time,
    // Falls back to the older settings so the page is never empty before the admin fills the profile in.
    legacy: { address: s.address, phone: s.phone, email: s.email, latitude: s.latitude, longitude: s.longitude } });
});

export const shopAdmin = Router();
shopAdmin.use(authed, requireRole('admin'));
shopAdmin.get('/shop', async (_req, res) => {
  const [{ details, updatedAt }, store] = await Promise.all([load(), pool.query('select address, phone, email, latitude, longitude from store_settings where id = 1')]);
  res.json({ details, updatedAt, legacy: store.rows[0] });
});
shopAdmin.put('/shop', async (req, res) => {
  const d = clean(parse(shopSchema, req.body));
  await tx(async (c) => {
    await c.query('update shop_profile set details = $1, updated_at = now(), updated_by = $2 where id = 1', [JSON.stringify(d), req.user!.id]);
    // The invoice, the older settings screen and /config read these three fields, so they follow the profile.
    await c.query('update store_settings set address = coalesce($1, address), phone = coalesce($2, phone), email = coalesce($3, email), latitude = coalesce($4, latitude), longitude = coalesce($5, longitude) where id = 1',
      [addressLine(d) || null, d.phones?.[0]?.number ?? null, d.email ?? null, d.latitude ?? null, d.longitude ?? null]);
  });
  res.json({ details: d });
});
