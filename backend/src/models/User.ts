
import { Schema, model, Types, Model } from 'mongoose';

export interface IUser {
  _id?: Types.ObjectId;
  phone: string;
  role: 'customer' | 'admin' | 'delivery_partner';
  name: string | null;
  email: string | null;
  language: string | null;
  avatarPublicId: string | null;
  avatarResourceType: string | null;
  gender: string | null;
  dateOfBirth: Date | null;
  city: string | null;
  isActive: boolean;
  firebaseUid: string | null;
  signedUpAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    _id: {
      type: Schema.Types.ObjectId,
      auto: true,
    },

    phone: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      index: true,
    },

    role: {
      type: String,
      enum: ['customer', 'admin', 'delivery_partner'],
      required: true,
    },

    name: {
      type: String,
      trim: true,
      maxLength: 80,
      default: null,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxLength: 120,
      default: null,
    },

    language: {
      type: String,
      default: 'en',
    },

    avatarPublicId: {
      type: String,
      default: null,
    },

    avatarResourceType: {
      type: String,
      default: null,
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      default: null,
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    city: {
      type: String,
      trim: true,
      maxLength: 60,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },

    signedUpAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ==========================================
// PHONE NUMBER NORMALIZATION
// ==========================================

userSchema.pre('save', async function () {
  if (this.phone) {
    // Normalize Indian phone numbers.
    // Store 10 digits without the +91 country prefix.
    const digits = this.phone.toString().replace(/\D/g, '');

    if (digits.length === 12 && digits.startsWith('91')) {
      this.phone = digits.slice(2);
    }
  }
});

// ==========================================
// MODEL REGISTRATION
// ==========================================

export const User: Model<IUser> = model<IUser>(
  'User',
  userSchema
);
