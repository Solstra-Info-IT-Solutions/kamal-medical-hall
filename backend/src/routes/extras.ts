import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';

import { authed, requireRole } from '../auth.js';
import { config } from '../config.js';
import { tx } from '../db.js';
import { HttpError, conflict, notFound, parse, publicBase } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import {
  isBlockedFile,
  signedPrescriptionUrl,
  type ResourceType,
} from '../services.js';
import { latencySnapshot } from '../observability.js';

import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { Review } from '../models/Review.js';
import { Payment } from '../models/Payment.js';
import Attendance from '../models/Attendance.js';

import { queueSnapshot } from './chat.js';

/** Customer side of reviews. */
export const reviewsRouter = Router();

/** Admin tools: moderation, analytics and exports. */
export const adminExtras = Router();

reviewsRouter.use(authed, requireRole('customer'));
adminExtras.use(authed, requireRole('admin'));

const objectId = (value: string) => {
  if (!isValidObjectId(value)) throw notFound('Not found');
  return new Types.ObjectId(value);
};

const IST_OFFSET_MS = 330 * 60 * 1000;

function istDay(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

function istDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+05:30`);
}

function daysAgoStart(days: number): Date {
  const now = new Date();
  const today = istDay(now);
  const start = istDayStart(today);
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}

function imageUrl(image: {
  publicId: string;
  mimeType: string;
  resourceType: string;
}) {
  return signedPrescriptionUrl(
    image.publicId,
    image.mimeType,
    image.resourceType as ResourceType,
  );
}

function reviewView(r: any) {
  return {
    id: r._id.toString(),
    orderId: r.orderId?.toString(),
    orderNumber: r.order?.orderNumber ?? null,
    rating: r.rating,
    comment: r.comment ?? null,
    status: r.status,
    adminNote: r.adminNote ?? null,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt ?? null,
    customerName: r.customer?.name ?? null,
    customerPhone: r.customer?.phone ?? null,
    images: (r.images ?? []).map((i: any) => ({
      id: i._id?.toString() ?? null,
      url: imageUrl(i),
    })),
  };
}

async function reviewRows(filter: Record<string, unknown>) {
  const rows = await Review.find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .populate({
      path: 'orderId',
      select: 'orderNumber',
    })
    .populate({
      path: 'customerId',
      select: 'name phone',
    })
    .lean()
    .exec();

  return rows.map((r: any) =>
    reviewView({
      ...r,
      order: r.orderId,
      customer: r.customerId,
    }),
  );
}

// ============================================================
// Reviews
// ============================================================

reviewsRouter.post('/', async (req, res) => {
  const b = parse(
    z.object({
      orderId: z.string().min(1),
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(500).optional(),
      images: z
        .array(
          z.object({
            publicId: z.string().min(3).max(300),
            mimeType: z.string().min(3).max(120),
            resourceType: z.enum(['image']).default('image'),
            sizeBytes: z.number().int().min(0).max(10_485_760).optional(),
          }),
        )
        .max(3)
        .default([]),
    }),
    req.body,
  );

  const customerId = objectId(req.user!.id);
  const orderId = objectId(b.orderId);

  if (
    b.images.some(
      (i) =>
        !i.publicId.startsWith(`reviews/${req.user!.id}/`) ||
        isBlockedFile(i.publicId),
    )
  ) {
    throw new HttpError(400, 'invalid_file', 'Invalid photo.');
  }

  const order = await Order.findOne({
    _id: orderId,
    customerId,
  })
    .select({ _id: 1, orderNumber: 1, status: 1 })
    .lean()
    .exec();

  if (!order) throw notFound('Order not found');

  if (order.status !== 'delivered') {
    throw conflict(
      'You can review an order after it is delivered.',
      'not_delivered',
    );
  }

  const reviewId = await tx(async (session) => {
    const exists = await Review.findOne({ orderId })
      .session(session)
      .select({ _id: 1 })
      .lean()
      .exec();

    if (exists) {
      throw conflict('You already reviewed this order.', 'already_reviewed');
    }

    const [review] = await Review.create(
      [
        {
          orderId,
          customerId,
          rating: b.rating,
          comment: b.comment || null,
          images: b.images.map((i) => ({
            publicId: i.publicId,
            mimeType: i.mimeType,
            resourceType: i.resourceType,
            sizeBytes: i.sizeBytes ?? null,
          })),
        },
      ],
      { session },
    );

    await notifyAdmins(
      orderId.toString(),
      'review_new',
      'New review to approve',
      `${req.user!.name ?? 'A customer'} rated ${order.orderNumber} ${b.rating}/5`,
      session,
    );

    return review._id.toString();
  });

  const review = (await reviewRows({ _id: objectId(reviewId) }))[0];

  res.status(201).json({ review });
});

/** Everything this customer wrote, with status. */
reviewsRouter.get('/mine', async (req, res) => {
  const reviews = await reviewRows({
    customerId: objectId(req.user!.id),
  });

  res.json({ reviews });
});

adminExtras.get('/reviews', async (req, res) => {
  const { status } = parse(
    z.object({
      status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
    }),
    req.query,
  );

  res.json({
    reviews: await reviewRows({ status }),
  });
});

adminExtras.post('/reviews/:id/decision', async (req, res) => {
  const b = parse(
    z.object({
      status: z.enum(['approved', 'rejected']),
      note: z.string().trim().max(200).optional(),
    }),
    req.body,
  );

  const id = objectId(String(req.params.id));

  const result = await tx(async (session) => {
    const review = await Review.findOneAndUpdate(
      {
        _id: id,
        status: 'pending',
      },
      {
        $set: {
          status: b.status,
          adminNote: b.note || null,
          decidedAt: new Date(),
          decidedBy: objectId(req.user!.id),
        },
      },
      {
        returnDocument: 'after',
        session,
      },
    )
      .lean()
      .exec();

    if (!review) {
      throw conflict('This review was already handled.', 'already_decided');
    }

    await notify(
      review.customerId.toString(),
      review.orderId.toString(),
      b.status === 'approved' ? 'review_approved' : 'review_rejected',
      b.status === 'approved' ? 'Your review is live' : 'Review not published',
      b.status === 'approved'
        ? 'Thank you! Your review now shows on your profile.'
        : b.note || 'The shop could not publish your review.',
      session,
    );

    return review._id;
  });

  res.json({
    review: (await reviewRows({ _id: result }))[0],
  });
});

// ============================================================
// Analytics
// ============================================================

/** Slowest endpoints first (p50 / p95 / p99 in ms). */
adminExtras.get('/metrics', (_req, res) => {
  res.json({ routes: latencySnapshot() });
});

adminExtras.get('/overview', async (_req, res) => {
  const today = istDayStart(istDay(new Date()));
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const weekStart = daysAgoStart(7);
  const monthStart = daysAgoStart(30);

  const [
    customers,
    ordersTotal,
    ordersToday,
    cancelledToday,
    pendingReviews,
    snap,
    deliveredOrders,
  ] = await Promise.all([
    User.countDocuments({
      role: 'customer',
      phone: { $not: /^deleted-/ },
    }),

    Order.countDocuments(),

    Order.countDocuments({
      createdAt: { $gte: today, $lt: tomorrow },
    }),

    Order.countDocuments({
      status: 'cancelled',
      updatedAt: { $gte: today, $lt: tomorrow },
    }),

    Review.countDocuments({ status: 'pending' }),

    queueSnapshot(),

    Order.find({
      status: 'delivered',
      'statusHistory.status': 'delivered',
    })
      .select({
        quotedAmount: 1,
        statusHistory: 1,
      })
      .lean()
      .exec(),
  ]);

  let salesToday = 0;
  let sales7d = 0;
  let sales30d = 0;
  let monthOrders = 0;

  for (const order of deliveredOrders as any[]) {
    const deliveredEvent = [...(order.statusHistory ?? [])]
      .reverse()
      .find((h: any) => h.status === 'delivered');

    if (!deliveredEvent?.createdAt) continue;

    const date = new Date(deliveredEvent.createdAt);
    const amount = Number(order.quotedAmount ?? 0);

    if (date >= today && date < tomorrow) salesToday += amount;

    if (date >= weekStart) sales7d += amount;

    if (date >= monthStart) {
      sales30d += amount;
      monthOrders += 1;
    }
  }

  res.json({
    customers,
    ordersTotal,
    ordersToday,
    cancelledToday,
    salesToday,
    sales7d,
    sales30d,
    avgOrder30d: monthOrders
      ? Math.round(sales30d / monthOrders)
      : 0,
    pendingReviews,
    chatWaiting: snap.waitingCount,
    chatOpen: snap.waitingCount + snap.activeCount,
  });
});

adminExtras.get('/revenue', async (req, res) => {
  const { days } = parse(
    z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
    }),
    req.query,
  );

  const since = daysAgoStart(days);

  const orders = await Order.find({
    status: 'delivered',
    'statusHistory.status': 'delivered',
  })
    .select({
      quotedAmount: 1,
      paymentMethod: 1,
      items: 1,
      statusHistory: 1,
    })
    .lean()
    .exec();

  const dailyMap = new Map<
    string,
    { day: string; orders: number; sales: number }
  >();

  const splitMap = new Map<
    string,
    { method: string; orders: number; sales: number }
  >();

  const itemMap = new Map<
    string,
    { name: string; quantity: number; orders: number }
  >();

  let sales = 0;
  let delivered = 0;

  for (const order of orders as any[]) {
    const deliveredEvent = [...(order.statusHistory ?? [])]
      .reverse()
      .find((h: any) => h.status === 'delivered');

    if (!deliveredEvent?.createdAt) continue;

    const date = new Date(deliveredEvent.createdAt);
    if (date < since) continue;

    const day = istDay(date);
    const amount = Number(order.quotedAmount ?? 0);
    const method = order.paymentMethod ?? 'unknown';

    sales += amount;
    delivered += 1;

    const daily = dailyMap.get(day) ?? {
      day,
      orders: 0,
      sales: 0,
    };

    daily.orders += 1;
    daily.sales += amount;
    dailyMap.set(day, daily);

    const split = splitMap.get(method) ?? {
      method,
      orders: 0,
      sales: 0,
    };

    split.orders += 1;
    split.sales += amount;
    splitMap.set(method, split);

    for (const item of order.items ?? []) {
      const name = String(item.name ?? 'Unknown');
      const entry = itemMap.get(name) ?? {
        name,
        quantity: 0,
        orders: 0,
      };

      entry.quantity += Number(item.quantity ?? 0);
      entry.orders += 1;
      itemMap.set(name, entry);
    }
  }

  const sinceForOrders = daysAgoStart(days);

  const [placed, lost] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: sinceForOrders } }),
    Order.countDocuments({
      createdAt: { $gte: sinceForOrders },
      status: { $in: ['cancelled', 'rejected'] },
    }),
  ]);

  const daily = [...dailyMap.values()].sort((a, b) =>
    a.day.localeCompare(b.day),
  );

  const paymentSplit = [...splitMap.values()];

  const topItems = [...itemMap.values()]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  res.json({
    days,
    sales,
    delivered,
    avgOrder: delivered ? Math.round(sales / delivered) : 0,
    ordersPlaced: placed,
    ordersLost: lost,
    daily,
    paymentSplit,
    topItems,
  });
});

// ============================================================
// CSV downloads
// ============================================================

const KINDS = [
  'orders',
  'revenue',
  'customers',
  'payments',
  'attendance',
  'reviews',
] as const;

type Kind = (typeof KINDS)[number];

const csvCell = (v: unknown) => {
  let s =
    v == null
      ? ''
      : v instanceof Date
        ? v.toISOString()
        : String(v);

  // Prevent spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s)
    ? `"${s.replace(/"/g, '""')}"`
    : s;
};

const toCsv = (headers: string[], rows: unknown[][]) =>
  '\uFEFF' +
  [headers, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n') +
  '\r\n';

async function buildExport(kind: Kind, days: number) {
  const since = daysAgoStart(days);

  if (kind === 'orders') {
    const orders = await Order.find({
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .populate({ path: 'customerId', select: 'name phone' })
      .populate({ path: 'partnerId', select: 'name' })
      .lean()
      .exec();

    return toCsv(
      [
        'Order',
        'Date',
        'Customer',
        'Phone',
        'Status',
        'Amount',
        'Payment method',
        'Payment status',
        'Slot',
        'Delivery partner',
        'Items',
      ],
      (orders as any[]).map((o) => [
        o.orderNumber,
        istDay(new Date(o.createdAt)),
        o.customerId?.name,
        o.customerId?.phone,
        o.status,
        o.quotedAmount,
        o.paymentMethod,
        o.paymentStatus,
        o.deliverySlot,
        o.partnerId?.name,
        (o.items ?? [])
          .map((i: any) => `${i.name} x${i.quantity}`)
          .join('; '),
      ]),
    );
  }

  if (kind === 'revenue') {
    const orders = await Order.find({
      status: 'delivered',
      'statusHistory.status': 'delivered',
    })
      .select({
        quotedAmount: 1,
        paymentMethod: 1,
        statusHistory: 1,
      })
      .lean()
      .exec();

    const map = new Map<
      string,
      { day: string; orders: number; sales: number; cod: number; online: number }
    >();

    for (const o of orders as any[]) {
      const event = [...(o.statusHistory ?? [])]
        .reverse()
        .find((h: any) => h.status === 'delivered');

      if (!event?.createdAt || new Date(event.createdAt) < since) continue;

      const day = istDay(new Date(event.createdAt));
      const amount = Number(o.quotedAmount ?? 0);

      const row = map.get(day) ?? {
        day,
        orders: 0,
        sales: 0,
        cod: 0,
        online: 0,
      };

      row.orders += 1;
      row.sales += amount;

      if (o.paymentMethod === 'cod') row.cod += amount;
      if (o.paymentMethod === 'razorpay') row.online += amount;

      map.set(day, row);
    }

    return toCsv(
      ['Date', 'Delivered orders', 'Sales', 'Cash on delivery', 'Online'],
      [...map.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => [r.day, r.orders, r.sales, r.cod, r.online]),
    );
  }

  if (kind === 'customers') {
    const customers = await User.find({
      role: 'customer',
      phone: { $not: /^deleted-/ },
    })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const ids = customers.map((u) => u._id);

    const totals = await Order.aggregate([
      { $match: { customerId: { $in: ids } } },
      {
        $group: {
          _id: '$customerId',
          orders: { $sum: 1 },
          lifetime: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'delivered'] },
                { $ifNull: ['$quotedAmount', 0] },
                0,
              ],
            },
          },
        },
      },
    ]);

    const map = new Map(
      totals.map((r: any) => [
        r._id.toString(),
        { orders: r.orders, lifetime: r.lifetime },
      ]),
    );

    return toCsv(
      ['Name', 'Phone', 'Email', 'Joined', 'Orders', 'Lifetime value'],
      (customers as any[]).map((u) => {
        const total = map.get(u._id.toString()) ?? {
          orders: 0,
          lifetime: 0,
        };

        return [
          u.name,
          u.phone,
          u.email,
          u.createdAt ? istDay(new Date(u.createdAt)) : '',
          total.orders,
          total.lifetime,
        ];
      }),
    );
  }

  if (kind === 'payments') {
    const payments = await Payment.find({
      collectedAt: { $ne: null, $gte: since },
    })
      .sort({ collectedAt: -1 })
      .populate({
        path: 'orderId',
        select: 'orderNumber quotedAmount partnerId customerId',
        populate: [
          { path: 'customerId', select: 'name' },
          { path: 'partnerId', select: 'name' },
        ],
      })
      .lean()
      .exec();

    return toCsv(
      [
        'Order',
        'Date',
        'Customer',
        'Collected by',
        'Mode',
        'Reference',
        'Amount',
      ],
      (payments as any[]).map((p) => [
        p.orderId?.orderNumber,
        p.collectedAt ? istDay(new Date(p.collectedAt)) : '',
        p.orderId?.customerId?.name,
        p.orderId?.partnerId?.name,
        p.collectedVia,
        p.collectionRef,
        p.orderId?.quotedAmount ?? p.amount,
      ]),
    );
  }

  if (kind === 'attendance') {
    const attendance = await Attendance.find({
      day: { $gte: istDay(since) },
    })
      .sort({ day: -1 })
      .populate({ path: 'partnerId', select: 'name phone' })
      .lean()
      .exec();

    return toCsv(
      [
        'Date',
        'Partner',
        'Phone',
        'Status',
        'Check-in',
        'Check-out',
        'Break minutes',
      ],
      (attendance as any[]).map((a) => [
        a.day,
        a.partnerId?.name,
        a.partnerId?.phone,
        a.status,
        a.checkedInAt,
        a.checkedOutAt,
        a.breakMinutes,
      ]),
    );
  }

  const reviews = await Review.find({
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .populate({ path: 'orderId', select: 'orderNumber' })
    .populate({ path: 'customerId', select: 'name' })
    .lean()
    .exec();

  return toCsv(
    ['Order', 'Date', 'Customer', 'Rating', 'Comment', 'Status'],
    (reviews as any[]).map((r) => [
      r.orderId?.orderNumber,
      r.createdAt ? istDay(new Date(r.createdAt)) : '',
      r.customerId?.name,
      r.rating,
      r.comment,
      r.status,
    ]),
  );
}

/** Short-lived link so the phone's browser can download the file. */
adminExtras.get('/export-link', (req, res) => {
  const { kind, days } = parse(
    z.object({
      kind: z.enum(KINDS),
      days: z.coerce.number().int().min(1).max(365).default(30),
    }),
    req.query,
  );

  const token = jwt.sign(
    { purpose: 'export', kind, days },
    config.jwtSecret,
    { expiresIn: '10m' },
  );

  res.json({
    url: `${publicBase(req)}/export/${kind}.csv?t=${encodeURIComponent(token)}`,
  });
});

/** Mounted outside the admin guard: the signed token is the credential. */
export const exportDownload = Router();

exportDownload.get('/:kind.csv', async (req, res) => {
  let payload: {
    purpose?: string;
    kind?: string;
    days?: number;
  };

  try {
    payload = jwt.verify(
      String(req.query.t ?? ''),
      config.jwtSecret,
    ) as typeof payload;
  } catch {
    throw new HttpError(
      401,
      'invalid_link',
      'This download link has expired. Please open it again from the app.',
    );
  }

  if (
    payload.purpose !== 'export' ||
    payload.kind !== req.params.kind ||
    !KINDS.includes(payload.kind as Kind)
  ) {
    throw new HttpError(401, 'invalid_link', 'This download link is not valid.');
  }

  const csv = await buildExport(
    payload.kind as Kind,
    Math.min(365, Math.max(1, Number(payload.days) || 30)),
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="kamal-medical-${payload.kind}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(csv);
});