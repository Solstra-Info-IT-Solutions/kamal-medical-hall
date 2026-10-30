
import { Schema, model, Model } from 'mongoose';

export interface IStoreSettings {
  isOpen: boolean;
  openingTime: string;
  closingTime: string;
  orderCutoffTime: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  latitude: number | null;
  longitude: number | null;
  upiId: string | null;
  upiName: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  termsText: string | null;
  termsUpdatedAt: Date | null;
  logoPublicId: string | null;
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// No unnecessary pre-save middleware.
// Singleton document management should be handled
// through the settings service/controller.

export const StoreSettings: Model<IStoreSettings> =
  model<IStoreSettings>(
    'StoreSettings',
    storeSettingsSchema,
    'store_settings'
  );
