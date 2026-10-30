import { Schema, model, Types, Model } from 'mongoose';

export interface IOrderItem {
  name: string;
  quantity: number;
}

export interface IPrescription {
  url: string;
  publicId: string;
  mimeType: string;
  sizeBytes: number;
  resourceType: 'image' | 'video' | 'pdf';
}

export interface IOrder {
  _id?: Types.ObjectId;
  customerId: Types.ObjectId;
  kind: 'catalogue' | 'prescription';
  note: string | null;
  items: IOrderItem[];
  prescriptions: IPrescription[];
  addressSnapshot: {
    label: string;
    recipientName: string;
    phone: string;
    line1: string;
    line2: string | null;
    pincode: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  deliveryDate: Date | null;
  deliverySlot: string | null;
  status: 'requested' | 'quote_sent' | 'quote_rejected' | 'accepted' | 'paid' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'returned';
  idempotencyKey: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemSchema = new Schema<IOrderItem>({
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const prescriptionSchema = new Schema<IPrescription>({
  url: { type: String, required: true },
  publicId: { type: String, required: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  resourceType: { type: String, enum: ['image', 'video', 'pdf'], required: true },
}, { _id: false });

const orderSchema = new Schema<IOrder>({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['catalogue', 'prescription'], required: true },
  note: { type: String, trim: true, default: null },
  items: [itemSchema],
  prescriptions: [prescriptionSchema],
  addressSnapshot: {
    label: { type: String, trim: true },
    recipientName: { type: String, trim: true },
    phone: { type: String },
    line1: { type: String, trim: true },
    line2: { type: String, trim: true, default: null },
    pincode: { type: String },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
  },
  deliveryDate: { type: Date, default: null },
  deliverySlot: { type: String, default: null },
  status: {
    type: String,
    enum: ['requested', 'quote_sent', 'quote_rejected', 'accepted', 'paid', 'out_for_delivery', 'delivered', 'cancelled', 'returned'],
    default: 'requested',
    index: true,
  },
  idempotencyKey: { type: String, unique: true, required: true, index: true },
}, {
  timestamps: true,
  versionKey: false,
});

// Compound indexes for common queries
orderSchema.index({ customerId: 1, status: 1 });
orderSchema.index({ deliveryDate: 1, status: 1 });

export const Order: Model<IOrder> = model<IOrder>('Order', orderSchema);