import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { authed, invalidateUser, normalisePhone, requireRole } from '../auth.js';
import { tx } from '../db.js';
import { HttpError, notFound, parse } from '../http.js';
import { notify, notifyAdmins } from '../notify.js';
import { AccountRequest } from '../models/AccountRequest.js';
import { Address } from '../models/Address.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { accountRequestView, profileSchema } from './general.js';

export const accountRouter = Router();
accountRouter.use(authed, requireRole('customer'));

const objectIdParam = (value: string): Types.ObjectId => {
  if (!isValidObjectId(value)) throw notFound('Not found');
  return new Types.ObjectId(value);
};

const requestRow = (r: any) =>
  accountRequestView({
    id: r._id.toString(),
    kind: r.kind,
    reason: r.reason,
    details: r.details ?? null,
    status: r.status,
    admin_note: r.adminNote ?? null,
    created_at: r.createdAt,
    decided_at: r.decidedAt ?? null,
  });

accountRouter.get('/requests', async (req, res) => {
  const rows = await AccountRequest.find({
    userId: new Types.ObjectId(req.user!.id),
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
    .exec();

  res.json({ requests: rows.map(requestRow) });
});

accountRouter.post('/requests', async (req, res) => {
  const b = parse(
    z.object({
      kind: z.enum(['deactivate', 'reactivate']),
      reason: z
        .string()
        .trim()
        .min(3, 'Please choose or write a reason')
        .max(120),
      details: z.string().trim().max(1000).optional(),
    }),
    req.body,
  );

  const user = req.user!;
  const active = user.is_active !== false;

  if (b.kind === 'deactivate' && !active) {
    throw new HttpError(
      409,
      'already_deactivated',
      'Your account is already deactivated.',
    );
  }

  if (b.kind === 'reactivate' && active) {
    throw new HttpError(
      409,
      'already_active',
      'Your account is already active.',
    );
  }

  let saved;

  try {
    saved = await new AccountRequest({
      userId: new Types.ObjectId(user.id),
      kind: b.kind,
      reason: b.reason,
      details: b.details || null,
    }).save();
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new HttpError(
        409,
        'request_pending',
        'You already have a request waiting for the store. You can cancel it first.',
      );
    }

    throw error;
  }

  const who = `${user.name ?? 'A customer'} (+91 ${user.phone})`;

  await notifyAdmins(
    null,
    'account_request',
    b.kind === 'deactivate'
      ? 'Account deactivation request'
      : 'Account reactivation request',
    `${who}: ${b.reason}`,
  );

  res.status(201).json({ request: requestRow(saved) });
});

accountRouter.delete('/requests/:id', async (req, res) => {
  const result = await AccountRequest.updateOne(
    {
      _id: objectIdParam(String(req.params.id)),
      userId: new Types.ObjectId(req.user!.id),
      status: 'pending',
    },
    {
      $set: {
        status: 'cancelled',
        decidedAt: new Date(),
      },
    },
  );

  if (!result.modifiedCount) {
    throw notFound('No pending request to cancel');
  }

  res.status(204).end();
});

// -----------------------------------------------------------------------------
// Admin customer management
// -----------------------------------------------------------------------------

export const customersAdmin = Router();
customersAdmin.use(authed, requireRole('admin'));

const customerView = (
  u: any,
  orderCount?: number,
  pendingKind?: string | null,
) => ({
  id: u._id.toString(),
  name: u.name ?? null,
  phone: u.phone,
  email: u.email ?? null,
  gender: u.gender ?? null,
  dateOfBirth: u.dateOfBirth
    ? new Date(u.dateOfBirth).toISOString().slice(0, 10)
    : null,
  city: u.city ?? null,
  isActive: u.isActive !== false,
  deactivatedAt: u.deactivatedAt ?? null,
  joinedAt: u.createdAt,
  signedUp: Boolean(u.signedUpAt),
  ...(orderCount === undefined ? {} : { orderCount }),
  pendingRequest: pendingKind ? { kind: pendingKind } : null,
});

const OPEN_STATUSES = [
  'requested',
  'quoted',
  'accepted',
  'awaiting_payment',
  'ready_to_dispatch',
  'out_for_delivery',
];

customersAdmin.get('/customers', async (req, res) => {
  const q = parse(
    z.object({
      search: z.string().trim().max(40).optional(),
      status: z.enum(['all', 'active', 'deactivated']).default('all'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );

  const filter: Record<string, any> = {
    role: 'customer',
    phone: { $not: /^deleted-/ },
  };

  if (q.status === 'active') filter.isActive = true;
  if (q.status === 'deactivated') filter.isActive = false;

  if (q.search) {
    const rx = new RegExp(
      q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i',
    );

    filter.$or = [
      { phone: rx },
      { name: rx },
      { email: rx },
      { city: rx },
    ];
  }

  const [users, active, deactivated, pendingRequests] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(q.offset)
      .limit(q.limit)
      .lean()
      .exec(),

    User.countDocuments({
      role: 'customer',
      phone: { $not: /^deleted-/ },
      isActive: true,
    }),

    User.countDocuments({
      role: 'customer',
      phone: { $not: /^deleted-/ },
      isActive: false,
    }),

    AccountRequest.countDocuments({ status: 'pending' }),
  ]);

  const ids = users.map((u) => u._id);

  const [orderCounts, pending] = await Promise.all([
    Order.aggregate([
      { $match: { customerId: { $in: ids } } },
      {
        $group: {
          _id: '$customerId',
          count: { $sum: 1 },
        },
      },
    ]),

    AccountRequest.find({
      userId: { $in: ids },
      status: 'pending',
    })
      .select({ userId: 1, kind: 1 })
      .lean()
      .exec(),
  ]);

  const countMap = new Map(
    orderCounts.map((x) => [x._id.toString(), x.count]),
  );

  const pendingMap = new Map(
    pending.map((x) => [x.userId.toString(), x.kind]),
  );

  res.json({
    customers: users.map((u) =>
      customerView(
        u,
        countMap.get(u._id.toString()) ?? 0,
        pendingMap.get(u._id.toString()) ?? null,
      ),
    ),
    counts: {
      active,
      deactivated,
      pendingRequests,
    },
  });
});

customersAdmin.get('/customers/:id', async (req, res) => {
  const id = objectIdParam(String(req.params.id));

  const u = await User.findOne({
    _id: id,
    role: 'customer',
  })
    .lean()
    .exec();

  if (!u) throw notFound('Customer not found');

  const [orders, totals, requests, addresses] = await Promise.all([
    Order.find({ customerId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .select({
        orderNumber: 1,
        status: 1,
        quotedAmount: 1,
        createdAt: 1,
      })
      .lean()
      .exec(),

    Order.aggregate([
      { $match: { customerId: id } },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          delivered: {
            $sum: {
              $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0],
            },
          },
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
    ]),

    AccountRequest.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec(),

    Address.find({ userId: id })
      .sort({ createdAt: 1 })
      .limit(5)
      .lean()
      .exec(),
  ]);

  const t = totals[0] ?? {
    orders: 0,
    delivered: 0,
    lifetime: 0,
  };

  res.json({
    customer: customerView(u),
    orderCount: t.orders,
    deliveredCount: t.delivered,
    lifetimeValue: Number(t.lifetime),

    orders: orders.map((o) => ({
      id: o._id.toString(),
      orderNumber: o.orderNumber,
      status: o.status,
      amount: o.quotedAmount ?? null,
      createdAt: o.createdAt,
    })),

    requests: requests.map(requestRow),

    addresses: addresses.map((a) =>
      [a.line1, a.line2, a.landmark, a.city, a.pincode]
        .filter(Boolean)
        .join(', '),
    ),
  });
});

customersAdmin.post('/customers', async (req, res) => {
  const b = parse(
    profileSchema.extend({
      phone: z.string().min(10).max(15),
    }),
    req.body,
  );

  const phone = normalisePhone(b.phone);

  try {
    const u = await User.create({
      phone,
      role: 'customer',
      name: b.name,
      email: b.email || null,
      gender: b.gender ?? null,
      dateOfBirth: b.dateOfBirth
        ? new Date(`${b.dateOfBirth}T00:00:00.000Z`)
        : null,
      city: b.city || null,
      signedUpAt: new Date(),
    });

    res.status(201).json({
      customer: customerView(u.toObject()),
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new HttpError(
        409,
        'already_registered',
        'This mobile number already has an account.',
      );
    }

    throw error;
  }
});

customersAdmin.patch('/customers/:id', async (req, res) => {
  const b = parse(profileSchema.partial(), req.body);

  const update: Record<string, unknown> = {};

  if (b.name !== undefined) update.name = b.name;
  if (b.email !== undefined) update.email = b.email || null;
  if (b.gender !== undefined) update.gender = b.gender;

  if (b.dateOfBirth !== undefined) {
    update.dateOfBirth = b.dateOfBirth
      ? new Date(`${b.dateOfBirth}T00:00:00.000Z`)
      : null;
  }

  if (b.city !== undefined) update.city = b.city || null;

  const u = await User.findOneAndUpdate(
    {
      _id: objectIdParam(String(req.params.id)),
      role: 'customer',
    },
    {
      $set: update,
    },
    {
      returnDocument: 'after',
      runValidators: true,
    },
  )
    .lean()
    .exec();

  if (!u) throw notFound('Customer not found');

  invalidateUser(u.phone);

  res.json({ customer: customerView(u) });
});

async function setActive(
  userId: string,
  active: boolean,
  adminId: string,
  note: string | null,
  requestId?: string,
): Promise<string> {
  return tx(async (session) => {
    const id = objectIdParam(userId);

    const u = await User.findOne({
      _id: id,
      role: 'customer',
    })
      .session(session)
      .lean()
      .exec();

    if (!u) throw notFound('Customer not found');

    if (!active) {
      const open = await Order.findOne({
        customerId: id,
        status: { $in: OPEN_STATUSES },
      } as any)
        .select({ orderNumber: 1 })
        .session(session)
        .lean<{ orderNumber: string }>()
        .exec();

      if (open) {
        throw new HttpError(
          409,
          'active_orders',
          `Order #${open.orderNumber} is still in progress. Finish or cancel it before deactivating this account.`,
        );
      }
    }

    await User.updateOne(
      { _id: id },
      {
        $set: {
          isActive: active,
          deactivatedAt: active ? null : new Date(),
        },
      },
      { session },
    );

    const pending = await AccountRequest.find({
      userId: id,
      status: 'pending',
    })
      .session(session)
      .exec();

    for (const r of pending) {
      r.status =
        (requestId && r._id.toString() === requestId) ||
        r.kind === (active ? 'reactivate' : 'deactivate')
          ? 'approved'
          : 'cancelled';

      if (note) r.adminNote = note;

      r.decidedBy = objectIdParam(adminId);
      r.decidedAt = new Date();

      await r.save({ session });
    }

    await notify(
      userId,
      null,
      active ? 'account_reactivated' : 'account_deactivated',
      active ? 'Your account is active again' : 'Your account has been deactivated',
      (active
        ? 'Welcome back! You can order again.'
        : 'You can ask the store to activate it again from the app at any time.') +
        (note ? ` Note from the store: ${note}` : ''),
      session,
    );

    return u.phone;
  });
}

customersAdmin.post('/customers/:id/status', async (req, res) => {
  const b = parse(
    z.object({
      active: z.boolean(),
      note: z.string().trim().max(300).optional(),
    }),
    req.body,
  );

  const phone = await setActive(
    String(req.params.id),
    b.active,
    req.user!.id,
    b.note || null,
  );

  invalidateUser(phone);

  res.status(204).end();
});

customersAdmin.get('/account-requests', async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['pending', 'all']).default('pending'),
    }),
    req.query,
  );

  const filter: Record<string, unknown> =
    q.status === 'all' ? {} : { status: 'pending' };

  const requests = await AccountRequest.find(filter as any)
    .sort({ status: 1, createdAt: -1 })
    .limit(100)
    .populate({
      path: 'userId',
      select: 'name phone isActive',
    })
    .lean()
    .exec();

  res.json({
    requests: requests.map((r: any) => ({
      ...requestRow(r),
      customer: {
        id: r.userId?._id?.toString(),
        name: r.userId?.name ?? null,
        phone: r.userId?.phone,
        isActive: r.userId?.isActive !== false,
      },
    })),
  });
});

customersAdmin.post('/account-requests/:id/decide', async (req, res) => {
  const b = parse(
    z.object({
      approve: z.boolean(),
      note: z.string().trim().max(300).optional(),
    }),
    req.body,
  );

  const r = await AccountRequest.findOne({
    _id: objectIdParam(String(req.params.id)),
    status: 'pending',
  })
    .lean()
    .exec();

  if (!r) throw notFound('This request was already handled');

  if (b.approve) {
    invalidateUser(
      await setActive(
        r.userId.toString(),
        r.kind === 'reactivate',
        req.user!.id,
        b.note || null,
        r._id!.toString(),
      ),
    );
  } else {
    await tx(async (session) => {
      const updated = await AccountRequest.updateOne(
        {
          _id: r._id,
          status: 'pending',
        },
        {
          $set: {
            status: 'rejected',
            adminNote: b.note || null,
            decidedBy: objectIdParam(req.user!.id),
            decidedAt: new Date(),
          },
        },
        { session },
      );

      if (!updated.modifiedCount) {
        throw notFound('This request was already handled');
      }

      await notify(
        r.userId.toString(),
        null,
        'account_request_rejected',
        r.kind === 'deactivate'
          ? 'Deactivation request declined'
          : 'Reactivation request declined',
        b.note
          ? `Note from the store: ${b.note}`
          : 'Please contact the store for details.',
        session,
      );
    });
  }

  res.status(204).end();
});