import { Router } from 'express';
import { authed, requireRole } from '../auth.js';
import { tx } from '../db.js';
import { parse } from '../http.js';
import { StoreSettings } from '../models/StoreSettings.js';
import { ShopProfile } from '../models/ShopProfile.js';
import { z } from 'zod';

/**
 * The medical shop's profile: who and where it is, how to reach it,
 * its licences and its branches.
 * Everything is optional, the admin fills in what applies.
 * Customers see everything except the PAN number.
 */

const text = (max: number) =>
  z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v.trim() === ''
          ? undefined
          : v.trim()
        : v,
    z.string().max(max).optional(),
  );

const phone = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v.trim() === ''
        ? undefined
        : v.replace(/[\s\-().]/g, '')
      : v,
  z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid phone number').optional(),
);

const pincode = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || undefined : v),
  z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional(),
);

const url = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || undefined : v),
  z
    .string()
    .max(300)
    .regex(
      /^https?:\/\/\S+$/i,
      'Enter a full link starting with http:// or https://',
    )
    .optional(),
);

const email = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() || undefined : v),
  z.string().max(120).email('Enter a valid email').optional(),
);

const upper = (re: RegExp, msg: string) =>
  z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v.replace(/\s+/g, '').toUpperCase() || undefined
        : v,
    z.string().regex(re, msg).optional(),
  );

const address = z
  .object({
    line1: text(160),
    line2: text(160),
    area: text(80),
    landmark: text(120),
    city: text(60),
    state: text(60),
    pincode,
  })
  .default({});

const branch = z.object({
  name: text(80),
  address: text(300),
  city: text(60),
  pincode,
  phone,
  hours: text(120),
  mapsUrl: url,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

export const shopSchema = z.object({
  name: text(80),
  tagline: text(120),
  about: text(1000),
  ownerName: text(80),

  establishedYear: z.preprocess(
    (v) =>
      v === '' || v === null
        ? undefined
        : typeof v === 'string'
          ? Number(v)
          : v,
    z.number().int().min(1900).max(2100).optional(),
  ),

  address,

  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  mapsUrl: url,

  phones: z
    .array(
      z.object({
        label: text(30),
        number: phone,
      }),
    )
    .max(5)
    .default([]),

  whatsapp: phone,
  email,
  website: url,
  hoursNote: text(200),

  licence: z
    .object({
      drugLicense1: text(60),
      drugLicense2: text(60),
      drugLicenseValidTill: text(20),
      gstin: upper(
        /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/,
        'GST number should be 15 characters, like 08ABCDE1234F1Z5',
      ),
      pan: upper(
        /^[A-Z]{5}\d{4}[A-Z]$/,
        'PAN should be 10 characters, like ABCDE1234F',
      ),
      fssai: text(20),
      pharmacistName: text(80),
      pharmacistRegNo: text(40),
    })
    .default({}),

  services: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  paymentModes: z.array(z.string().trim().min(1).max(30)).max(10).default([]),

  social: z
    .object({
      facebook: url,
      instagram: url,
    })
    .default({}),

  branches: z.array(branch).max(20).default([]),
});

export type ShopDetails = z.infer<typeof shopSchema>;

const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** One line the invoice and store settings can print. */
export function addressLine(d: ShopDetails) {
  const a = d.address;

  return [
    a.line1,
    a.line2,
    a.area,
    a.city,
    [a.state, a.pincode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
}

async function load() {
  const profile = await ShopProfile.findOne()
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  return {
    details: (profile?.details ?? {}) as Partial<ShopDetails>,
    updatedAt: profile?.updatedAt,
  };
}

const publicView = (d: Partial<ShopDetails>) => {
  const { licence, ...rest } = d;
  const { pan: _pan, ...safeLicence } = licence ?? {};

  return {
    ...rest,
    licence: safeLicence,
  };
};

export const shopPublic = Router();

/** Public: what the customer app shows on the "About the shop" page. */
shopPublic.get('/shop', async (_req, res) => {
  const [{ details }, store] = await Promise.all([
    load(),
    StoreSettings.findOne().lean().exec(),
  ]);

  const s = store as any;

  res.json({
    ...publicView(details),
    isOpen: s?.isOpen ?? false,
    openingTime: s?.openingTime ?? null,
    closingTime: s?.closingTime ?? null,

    // Legacy fallback so the page is never empty before the profile is filled.
    legacy: {
      address: s?.address ?? null,
      phone: s?.phone ?? null,
      email: s?.email ?? null,
      latitude: s?.latitude ?? null,
      longitude: s?.longitude ?? null,
    },
  });
});

export const shopAdmin = Router();

shopAdmin.use(authed, requireRole('admin'));

shopAdmin.get('/shop', async (_req, res) => {
  const [{ details, updatedAt }, store] = await Promise.all([
    load(),
    StoreSettings.findOne().lean().exec(),
  ]);

  const s = store as any;

  res.json({
    details,
    updatedAt,
    legacy: {
      address: s?.address ?? null,
      phone: s?.phone ?? null,
      email: s?.email ?? null,
      latitude: s?.latitude ?? null,
      longitude: s?.longitude ?? null,
    },
  });
});

shopAdmin.put('/shop', async (req, res) => {
  const d = clean(parse(shopSchema, req.body));

  await tx(async (session) => {
    await ShopProfile.findOneAndUpdate(
      {},
      {
        $set: {
          details: d,
          updatedBy: req.user!.id,
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
        runValidators: true,
        session,
        setDefaultsOnInsert: true,
      },
    ).exec();

    // Keep the legacy settings fields synchronized.
    const legacyUpdate: Record<string, unknown> = {};

    const line = addressLine(d);
    const firstPhone = d.phones?.[0]?.number;

    if (line) legacyUpdate.address = line;
    if (firstPhone) legacyUpdate.phone = firstPhone;
    if (d.email) legacyUpdate.email = d.email;
    if (d.latitude !== undefined && d.latitude !== null) {
      legacyUpdate.latitude = d.latitude;
    }
    if (d.longitude !== undefined && d.longitude !== null) {
      legacyUpdate.longitude = d.longitude;
    }

    if (Object.keys(legacyUpdate).length) {
      await StoreSettings.findOneAndUpdate(
        {},
        { $set: legacyUpdate },
        {
          returnDocument: 'after',
          runValidators: true,
          session,
        },
      ).exec();
    }
  });

  res.json({ details: d });
});