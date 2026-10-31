
import mongoose, {
  Schema,
  type Model,
} from 'mongoose';

export interface IStoreSettings {
  isOpen: boolean;
  openingTime: string;
  closingTime: string;
  orderCutoffTime: string;

  // Date on which the closing alert was last claimed (YYYY-MM-DD, IST).
  closingAlertDay: string | null;

  address: string | null;
  phone: string | null;
  email: string | null;

  latitude: number | null;
  longitude: number | null;

  // Geofence radius in metres. Null means not configured.
  geofenceM: number | null;

  upiId: string | null;
  upiName: string | null;

  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;

  termsText: string | null;
  termsUpdatedAt: Date | null;

  logoPublicId: string | null;

  createdAt?: Date;
  updatedAt?: Date;

  customerAcceptRequired: boolean;
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    isOpen: {
      type: Boolean,
      default: true,
    },

    openingTime: {
      type: String,
      default: '09:00',
    },

    closingTime: {
      type: String,
      default: '21:00',
    },

    orderCutoffTime: {
      type: String,
      default: '01:00:00',
    },

    closingAlertDay: {
      type: String,
      default: null,
    },

    address: {
      type: String,
      trim: true,
      default: null,
    },

    phone: {
      type: String,
      trim: true,
      default: null,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },

    geofenceM: {
      type: Number,
      min: 0,
      default: null,
    },

    upiId: {
      type: String,
      trim: true,
      default: null,
    },

    upiName: {
      type: String,
      trim: true,
      default: null,
    },

    bankName: {
      type: String,
      trim: true,
      default: null,
    },

    bankAccountName: {
      type: String,
      trim: true,
      default: null,
    },

    bankAccountNumber: {
      type: String,
      trim: true,
      default: null,
    },

    bankIfsc: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },

    termsText: {
      type: String,
      default: null,
    },

    termsUpdatedAt: {
      type: Date,
      default: null,
    },

    logoPublicId: {
      type: String,
      default: null,
    },

    customerAcceptRequired: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'store_settings',
  },
);

export const StoreSettings: Model<IStoreSettings> =
  (mongoose.models.StoreSettings as Model<IStoreSettings>) ||
  mongoose.model<IStoreSettings>(
    'StoreSettings',
    storeSettingsSchema,
    'store_settings',
  );

export default StoreSettings;
