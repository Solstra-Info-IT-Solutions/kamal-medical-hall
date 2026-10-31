
import mongoose, { Schema, model, Types, type Model } from 'mongoose';

export type AccountRequestKind = 'deactivate' | 'reactivate';
export type AccountRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface IAccountRequest {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  kind: AccountRequestKind;
  reason: string;
  details: string | null;
  status: AccountRequestStatus;
  adminNote: string | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const AccountRequestSchema = new Schema<IAccountRequest>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      enum: ['deactivate', 'reactivate'],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    details: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      required: true,
    },
    adminNote: {
      type: String,
      default: null,
      maxlength: 300,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'account_requests',
  }
);

// At most one outstanding request per customer.
AccountRequestSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

AccountRequestSchema.index({ status: 1, createdAt: -1 });

export const AccountRequest: Model<IAccountRequest> =
  (mongoose.models.AccountRequest as Model<IAccountRequest>) ||
  model<IAccountRequest>('AccountRequest', AccountRequestSchema);
