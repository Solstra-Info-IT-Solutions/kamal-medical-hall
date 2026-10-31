
import mongoose, {
  Schema,
  type Document,
  type Model,
} from 'mongoose';

export type PartnerState =
  | 'off'
  | 'available'
  | 'reserved'
  | 'busy'
  | 'returning'
  | 'break';

export interface IDeliveryPartner extends Document {
  userId: mongoose.Types.ObjectId;

  active: boolean;
  canCallCustomer: boolean;

  state: PartnerState;
  isAvailable: boolean;

  onDuty: boolean;
  /** IST date in YYYY-MM-DD format */
  onDutyDay: string | null;

  lastSeen: Date | null;
  lastLat: number | null;
  lastLng: number | null;

  createdAt: Date;
  updatedAt: Date;
}

const deliveryPartnerSchema = new Schema<IDeliveryPartner>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    active: {
      type: Boolean,
      default: true,
    },

    canCallCustomer: {
      type: Boolean,
      default: true,
    },

    state: {
      type: String,
      enum: [
        'off',
        'available',
        'reserved',
        'busy',
        'returning',
        'break',
      ],
      default: 'off',
      required: true,
    },

    isAvailable: {
      type: Boolean,
      default: false,
    },

    onDuty: {
      type: Boolean,
      default: false,
    },

    onDutyDay: {
      type: String,
      default: null,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'onDutyDay must use YYYY-MM-DD format'],
    },

    lastSeen: {
      type: Date,
      default: null,
    },

    lastLat: {
      type: Number,
      default: null,
      min: -90,
      max: 90,
    },

    lastLng: {
      type: Number,
      default: null,
      min: -180,
      max: 180,
    },
  },
  {
    timestamps: true,
    collection: 'delivery_partners',
    versionKey: false,
  },
);

deliveryPartnerSchema.index({ active: 1, state: 1 });
deliveryPartnerSchema.index({ onDuty: 1, onDutyDay: 1 });
deliveryPartnerSchema.index({ isAvailable: 1, active: 1 });

const DeliveryPartner: Model<IDeliveryPartner> =
  (mongoose.models.DeliveryPartner as Model<IDeliveryPartner>) ||
  mongoose.model<IDeliveryPartner>(
    'DeliveryPartner',
    deliveryPartnerSchema,
  );

export default DeliveryPartner;
