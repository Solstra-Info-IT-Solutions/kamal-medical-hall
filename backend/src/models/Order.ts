
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type OrderKind = 'catalogue' | 'prescription';

export type OrderStatus =
  | 'requested'
  | 'quoted'
  | 'accepted'
  | 'awaiting_payment'
  | 'ready_to_dispatch'
  | 'out_for_delivery'
  | 'delivered'
  | 'rejected'
  | 'cancelled';

export type OrderPaymentMethod = 'razorpay' | 'cod';

export type OrderPaymentStatus =
  | 'pending'
  | 'paid'
  | 'cod_pending'
  | 'cod_collected'
  | 'failed'
  | 'refunded';

export interface IOrderItem {
  name: string;
  quantity: number;
}

export interface IPrescription {
  url: string;
  publicId: string;
  mimeType: string;
  sizeBytes: number;
  resourceType: 'image' | 'raw' | 'video';
}

export interface IAddressSnapshot {
  label?: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface IOrderStatusHistory {
  status: OrderStatus;
  actorId: Types.ObjectId | null;
  reason: string | null;
  createdAt: Date;
}

export interface IOrder {
  _id?: Types.ObjectId;

  orderNumber: string;
  customerId: Types.ObjectId;
  partnerId: Types.ObjectId | null;

  kind: OrderKind;
  note: string | null;

  items: IOrderItem[];
  prescriptions: IPrescription[];
  addressSnapshot: IAddressSnapshot | null;

  deliveryDate: Date | null;
  deliverySlot: string | null;

  status: OrderStatus;
  statusHistory: IOrderStatusHistory[];

  quotedAmount: number | null;
  quoteExpiresAt: Date | null;

  paymentMethod: OrderPaymentMethod | null;
  paymentStatus: OrderPaymentStatus | null;

  rejectionReason: string | null;
  reviewedBy: Types.ObjectId | null;
  cancelReason: string | null;
  cancelledBy: Types.ObjectId | null;

  partnerAcceptedAt: Date | null;

  billPublicId: string | null;
  billName: string | null;
  billMime: string | null;
  billSize: number | null;
  billUploadedAt: Date | null;
  billResourceType: 'image' | 'raw' | 'video' | null;

  deliveredAt: Date | null;

  idempotencyKey: string;

  createdAt?: Date;
  updatedAt?: Date;
}

// -----------------------------------------------------------------------------
// Embedded schemas
// -----------------------------------------------------------------------------

const OrderItemSchema = new Schema<IOrderItem>(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const PrescriptionSchema = new Schema<IPrescription>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    resourceType: {
      type: String,
      enum: ['image', 'raw', 'video'],
      default: 'image',
      required: true,
    },
  },
  { _id: false },
);

const AddressSnapshotSchema = new Schema<IAddressSnapshot>(
  {
    label: String,
    recipientName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, default: null },
    landmark: { type: String, default: null },
    pincode: { type: String, required: true },
    city: { type: String, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  { _id: false },
);

const OrderStatusHistorySchema =
  new Schema<IOrderStatusHistory>(
    {
      status: {
        type: String,
        enum: [
          'requested',
          'quoted',
          'accepted',
          'awaiting_payment',
          'ready_to_dispatch',
          'out_for_delivery',
          'delivered',
          'rejected',
          'cancelled',
        ],
        required: true,
      },
      actorId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      reason: {
        type: String,
        default: null,
      },
      createdAt: {
        type: Date,
        default: Date.now,
        required: true,
      },
    },
    { _id: false },
  );

// -----------------------------------------------------------------------------
// Order schema
// -----------------------------------------------------------------------------

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },

    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    kind: {
      type: String,
      enum: ['catalogue', 'prescription'],
      required: true,
    },

    note: { type: String, default: null },

    items: {
      type: [OrderItemSchema],
      default: [],
    },

    prescriptions: {
      type: [PrescriptionSchema],
      default: [],
    },

    addressSnapshot: {
      type: AddressSnapshotSchema,
      default: null,
    },

    deliveryDate: { type: Date, default: null },
    deliverySlot: { type: String, default: null },

    status: {
      type: String,
      enum: [
        'requested',
        'quoted',
        'accepted',
        'awaiting_payment',
        'ready_to_dispatch',
        'out_for_delivery',
        'delivered',
        'rejected',
        'cancelled',
      ],
      default: 'requested',
      required: true,
    },

    statusHistory: {
      type: [OrderStatusHistorySchema],
      default: [],
    },

    quotedAmount: { type: Number, default: null, min: 0 },
    quoteExpiresAt: { type: Date, default: null },

    paymentMethod: {
      type: String,
      enum: ['razorpay', 'cod'],
      default: null,
    },

    paymentStatus: {
      type: String,
      enum: [
        'pending',
        'paid',
        'cod_pending',
        'cod_collected',
        'failed',
        'refunded',
      ],
      default: null,
    },

    rejectionReason: {
      type: String,
      default: null,
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    cancelReason: {
      type: String,
      default: null,
    },

    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    partnerAcceptedAt: { type: Date, default: null },

    billPublicId: { type: String, default: null },
    billName: { type: String, default: null },
    billMime: { type: String, default: null },
    billSize: { type: Number, default: null },
    billUploadedAt: { type: Date, default: null },

    billResourceType: {
      type: String,
      enum: ['image', 'raw', 'video'],
      default: null,
    },

    deliveredAt: { type: Date, default: null },

    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'orders',
  },
);

// An idempotency key is unique per customer.
OrderSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true },
);

OrderSchema.index({ customerId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ deliveryDate: 1, status: 1 });
OrderSchema.index({ partnerId: 1, status: 1 });

// -----------------------------------------------------------------------------
// Daily order-number counter
// -----------------------------------------------------------------------------

interface IOrderCounter {
  _id: string;
  sequence: number;
}

const OrderCounterSchema = new Schema<IOrderCounter>(
  {
    _id: { type: String, required: true },
    sequence: { type: Number, required: true, default: 0 },
  },
  {
    versionKey: false,
    collection: 'counters',
  },
);

const OrderCounter: Model<IOrderCounter> =
  (mongoose.models.OrderCounter as Model<IOrderCounter>) ||
  model<IOrderCounter>('OrderCounter', OrderCounterSchema);

/**
 * Generates order numbers in the format:
 * KMH-YYYYMMDD-0001
 *
 * Uses an atomic MongoDB increment to prevent duplicate numbers
 * when multiple orders are created simultaneously.
 */
export async function generateOrderNumber(
  date: Date = new Date(),
): Promise<string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => {
    const value = parts.find((part) => part.type === type)?.value;

    if (!value) {
      throw new Error(
        `Unable to determine order-number date part: ${type}`,
      );
    }

    return value;
  };

  const dateKey = `${get('year')}${get('month')}${get('day')}`;
  const counterId = `order:${dateKey}`;

  let counter: IOrderCounter | null;

  try {
    counter = await OrderCounter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { sequence: 1 } },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      },
    ).lean<IOrderCounter>();
  } catch (error) {
    // Concurrent first-time upserts can race on the counter's _id.
    // Retry as an ordinary atomic increment if another request created it.
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 11000
    ) {
      throw error;
    }

    counter = await OrderCounter.findOneAndUpdate(
      { _id: counterId },
      { $inc: { sequence: 1 } },
      { returnDocument: 'after' },
    ).lean<IOrderCounter>();
  }

  if (!counter) {
    throw new Error('Failed to generate order number');
  }

  return `KMH-${dateKey}-${String(counter.sequence).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------------
// Model export
// -----------------------------------------------------------------------------

export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder>) ||
  model<IOrder>('Order', OrderSchema);

export default Order;
