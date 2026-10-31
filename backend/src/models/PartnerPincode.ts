
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export interface IPartnerPincode {
  partnerId: Types.ObjectId;
  pincode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const partnerPincodeSchema = new Schema<IPartnerPincode>(
  {
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    pincode: {
      type: String,
      required: true,
      match: [/^\d{6}$/, 'Pincode must contain exactly 6 digits'],
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'partner_pincodes',
    versionKey: false,
  },
);

// Preserve the original composite unique index.
partnerPincodeSchema.index(
  { partnerId: 1, pincode: 1 },
  { unique: true },
);

partnerPincodeSchema.index({ pincode: 1 });

export const PartnerPincode: Model<IPartnerPincode> =
  (mongoose.models.PartnerPincode as Model<IPartnerPincode>) ||
  model<IPartnerPincode>(
    'PartnerPincode',
    partnerPincodeSchema,
  );

export default PartnerPincode;
