
import { Types, type ClientSession } from 'mongoose';

import { Order, type IOrder, type OrderStatus } from './models/Order.js';
import { User } from './models/User.js';
import { Payment } from './models/Payment.js';
import { Review } from './models/Review.js';
import DeliveryPartner from './models/DeliveryPartner.js';
import { StoreSettings } from './models/StoreSettings.js';

import { afterCommit } from './transactionHooks.js';
import { emitOrder } from './realtime.js';
import { conflict, notFound } from './http.js';

import {
  previewUrls,
  signedBillUrl,
  signedPrescriptionUrl,
  type ResourceType,
} from './services.js';

import type { AuthUser } from './auth.js';

export type { OrderStatus };

export const CANCELLABLE: OrderStatus[] = [
  'requested',
  'quoted',
  'accepted',
  'awaiting_payment',
  'ready_to_dispatch',
];

export type TransitionResult = IOrder & {
  _id: Types.ObjectId;
  payment_status: IOrder['paymentStatus'];
  order_number: string;
  customer_id: string;
  prevPartner?: string | null;
};

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw notFound('Order not found');
  }

  return new Types.ObjectId(value);
}

function dateOnly(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function toObjectIdOrNull(
  value: unknown,
): Types.ObjectId | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Types.ObjectId) {
    return value;
  }

  if (
    typeof value === 'string' &&
    Types.ObjectId.isValid(value)
  ) {
    return new Types.ObjectId(value);
  }

  throw new Error('Invalid MongoDB ObjectId in order update.');
}

const UPDATE_FIELD_MAP: Record<string, string> = {
  quoted_amount: 'quotedAmount',
  quote_expires_at: 'quoteExpiresAt',
  reviewed_by: 'reviewedBy',

  bill_public_id: 'billPublicId',
  bill_mime: 'billMime',
  bill_resource_type: 'billResourceType',
  bill_name: 'billName',
  bill_size: 'billSize',
  bill_uploaded_at: 'billUploadedAt',

  payment_method: 'paymentMethod',
  payment_status: 'paymentStatus',

  rejection_reason: 'rejectionReason',

  cancel_reason: 'cancelReason',
  cancelled_by: 'cancelledBy',

  partner_id: 'partnerId',
  partner_accepted_at: 'partnerAcceptedAt',

  delivered_at: 'deliveredAt',
};

const OBJECT_ID_FIELDS = new Set([
  'reviewedBy',
  'cancelledBy',
  'partnerId',
]);

function mapUpdateFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    const mongoField = UPDATE_FIELD_MAP[key];

    if (!mongoField) {
      throw new Error(`Unsupported order update field: ${key}`);
    }

    mapped[mongoField] = OBJECT_ID_FIELDS.has(mongoField)
      ? toObjectIdOrNull(value)
      : value;
  }

  return mapped;
}

export async function loadOrder(
  id: string,
  viewer: AuthUser,
  session?: ClientSession,
) {
  const isObjectId = /^[0-9a-f]{24}$/i.test(id);

  const filter = isObjectId
    ? { _id: new Types.ObjectId(id) }
    : { orderNumber: id };

  let orderQuery = Order.findOne(filter);

  if (session) {
    orderQuery = orderQuery.session(session);
  }

  const order = await orderQuery;

  if (!order) {
    throw notFound('Order not found');
  }

  const orderId = order._id.toString();
  const customerId = order.customerId.toString();
  const partnerId = order.partnerId?.toString() ?? null;

  const allowed =
    viewer.role === 'admin' ||
    (viewer.role === 'customer' && customerId === viewer.id) ||
    (viewer.role === 'delivery_partner' && partnerId === viewer.id);

  if (!allowed) {
    throw notFound('Order not found');
  }

  const staffView = viewer.role !== 'customer';

  const [
    customer,
    partner,
    store,
    review,
    partnerSettings,
    payment,
  ] = await Promise.all([
    User.findById(order.customerId)
      .select('name phone')
      .session(session ?? null)
      .lean(),

    order.partnerId
      ? User.findById(order.partnerId)
          .select('name phone')
          .session(session ?? null)
          .lean()
      : Promise.resolve(null),

    StoreSettings.findOne({})
      .select('address phone')
      .session(session ?? null)
      .lean(),

    viewer.role === 'delivery_partner'
      ? Promise.resolve(null)
      : Review.findOne({ orderId: order._id })
          .select('rating status')
          .session(session ?? null)
          .lean(),

    viewer.role === 'delivery_partner'
      ? DeliveryPartner.findOne({
          userId: new Types.ObjectId(viewer.id),
        })
          .select('canCallCustomer')
          .session(session ?? null)
          .lean()
      : Promise.resolve(null),

    viewer.role === 'customer'
      ? Promise.resolve(null)
      : Payment.findOne({
          orderId: order._id,
          collectedVia: { $ne: null },
        })
          .session(session ?? null)
          .lean(),
  ]);

  const phoneVisible =
    viewer.role === 'admin' ||
    (
      viewer.role === 'delivery_partner' &&
      Boolean(partnerSettings?.canCallCustomer) &&
      Boolean(order.partnerAcceptedAt)
    );

  const canCallCustomer =
    viewer.role === 'admin' ||
    (
      viewer.role === 'delivery_partner' &&
      Boolean(partnerSettings?.canCallCustomer)
    );

  const address =
    phoneVisible || viewer.role === 'customer'
      ? order.addressSnapshot
      : order.addressSnapshot
        ? {
            ...order.addressSnapshot,
            phone: null,
          }
        : null;

  const prescriptions =
    viewer.role === 'delivery_partner'
      ? []
      : (order.prescriptions ?? []).map((prescription) => ({
          id: prescription.publicId,
          mimeType: prescription.mimeType,
          sizeBytes: prescription.sizeBytes,
          name: prescription.publicId.split('/').pop(),

          url: signedPrescriptionUrl(
            prescription.publicId,
            prescription.mimeType,
            prescription.resourceType,
          ),

          previewUrls: previewUrls(
            prescription.publicId,
            prescription.mimeType,
            prescription.resourceType as ResourceType,
          ),
        }));

  const history = (order.statusHistory ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() -
        new Date(b.createdAt).getTime(),
    )
    .map((entry) => ({
      status: entry.status,
      reason: entry.reason,
      created_at: entry.createdAt,
    }));

  const deliveredHistory = [...(order.statusHistory ?? [])]
    .reverse()
    .find((entry) => entry.status === 'delivered');

  const deliveredAt =
    order.deliveredAt ??
    deliveredHistory?.createdAt ??
    null;

  const bill =
    order.billPublicId &&
    order.billMime &&
    order.billResourceType &&
    viewer.role !== 'delivery_partner'
      ? {
          name: order.billName ?? `Bill-${order.orderNumber}`,
          mimeType: order.billMime,
          sizeBytes: order.billSize,
          uploadedAt: order.billUploadedAt,

          viewUrl: signedBillUrl(
            order.billPublicId,
            order.billMime,
            order.billResourceType,
            false,
            `Bill-${order.orderNumber}`,
          ),

          previewUrls: previewUrls(
            order.billPublicId,
            order.billMime,
            order.billResourceType,
          ),

          downloadUrl: signedBillUrl(
            order.billPublicId,
            order.billMime,
            order.billResourceType,
            true,
            order.billName?.replace(/\.[^.]+$/, '') ||
              `Bill-${order.orderNumber}`,
          ),
        }
      : null;

  let collection: Record<string, unknown> | null = null;

  if (payment?.collectedVia) {
    const collector = payment.collectedBy
      ? await User.findById(payment.collectedBy)
          .select('name')
          .session(session ?? null)
          .lean()
      : null;

    collection = {
      via: payment.collectedVia,
      reference: payment.collectionRef,
      collectedAt: payment.collectedAt,
      collectedBy: collector?.name ?? null,
      cashSettledAt: payment.cashSettledAt,

      proof: payment.proofPublicId
        ? {
            url: signedPrescriptionUrl(
              payment.proofPublicId,
              payment.proofMime ?? 'application/octet-stream',
              payment.proofResourceType === 'video' ||
payment.proofResourceType === 'raw'
  ? payment.proofResourceType
  : 'image',
            ),
            mimeType: payment.proofMime,
          }
        : null,
    };
  }

  const reviewResult = review
    ? {
        id: review._id.toString(),
        rating: review.rating,
        status: review.status,
      }
    : null;

  return {
    id: orderId,
    orderNumber: order.orderNumber,
    kind: order.kind,
    status: order.status,
    note: order.note,

    address,
    partnerAccepted: Boolean(order.partnerAcceptedAt),
    canCallCustomer,

    deliveryDate: dateOnly(order.deliveryDate),
    deliverySlot: order.deliverySlot,

    quotedAmount:
      order.quotedAmount === null
        ? null
        : Number(order.quotedAmount),

    quoteExpiresAt: order.quoteExpiresAt,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,

    rejectionReason: order.rejectionReason,
    cancelReason: order.cancelReason,
    createdAt: order.createdAt,

    items: (order.items ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((item) => ({
        name: item.name,
        quantity: item.quantity,
      })),

    prescriptions,
    collection,
    history,
    deliveredAt,
    bill,
    review: reviewResult,

    store: {
      name: 'Kamal Medical Hall',
      address: store?.address ?? null,
      phone: store?.phone ?? null,
    },

    reviewedBy: staffView
      ? order.reviewedBy?.toString() ?? null
      : undefined,

    customer: staffView
      ? {
          id: customerId,
          name: customer?.name ?? null,
          phone: phoneVisible ? customer?.phone ?? null : null,
        }
      : undefined,

    partner:
      order.partnerId && viewer.role !== 'customer'
        ? {
            id: partnerId,
            name: partner?.name ?? null,
            phone: partner?.phone ?? null,
          }
        : order.partnerId && order.partnerAcceptedAt
          ? {
              id: partnerId,
              name: partner?.name ?? null,
            }
          : null,
  };
}

export async function transition(
  session: ClientSession,
  orderId: string,
  from: OrderStatus[],
  to: OrderStatus,
  actorId: string | null,
  set: Record<string, unknown> = {},
  reason?: string,
): Promise<TransitionResult> {
  if (!session.inTransaction()) {
    throw new Error(
      'Order transitions must run inside an active MongoDB transaction.',
    );
  }

  const updateFields = mapUpdateFields(set);

  if (
    to === 'delivered' &&
    updateFields.deliveredAt === undefined
  ) {
    updateFields.deliveredAt = new Date();
  }

  const historyEntry = {
    status: to,
    actorId: toObjectIdOrNull(actorId),
    reason: reason ?? null,
    createdAt: new Date(),
  };

  const updated = await Order.findOneAndUpdate(
    {
      _id: objectId(orderId),
      status: { $in: from },
    },
    {
      $set: {
        status: to,
        ...updateFields,
      },
      $push: {
        statusHistory: historyEntry,
      },
    },
    {
      returnDocument: 'after',
      session,
      runValidators: true,
    },
  );

  if (!updated) {
    throw conflict(
      'This order can no longer be changed this way. Please refresh.',
      'invalid_state',
    );
  }

  afterCommit(session, () => {
    emitOrder({
      id: updated._id.toString(),
      order_number: updated.orderNumber,
      status: updated.status,
      customer_id: updated.customerId.toString(),
      partner_id: updated.partnerId?.toString() ?? null,
    });
  });

const result: TransitionResult = {
  ...updated.toObject(),
  _id: updated._id,
  payment_status: updated.paymentStatus,
  order_number: updated.orderNumber,
  customer_id: updated.customerId.toString(),
};

  // Compatibility aliases for existing route code.
  // These are response properties, not MongoDB schema fields.
  result.payment_status = updated.paymentStatus;
  result.order_number = updated.orderNumber;
  result.customer_id = updated.customerId.toString();

  return result;
}
