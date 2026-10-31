
import mongoose, {
  Schema,
  model,
  type Model,
} from 'mongoose';

export interface IServicePincode {
  pincode: string;
  area: string | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const servicePincodeSchema = new Schema<IServicePincode>(
  {
    pincode: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{6}$/, 'Pincode must contain exactly 6 digits'],
      trim: true,
    },

    area: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },

    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'service_pincodes',
    versionKey: false,
  },
);

servicePincodeSchema.index({ active: 1, pincode: 1 });

export const ServicePincode: Model<IServicePincode> =
  (mongoose.models.ServicePincode as Model<IServicePincode>) ||
  model<IServicePincode>(
    'ServicePincode',
    servicePincodeSchema,
  );

export default ServicePincode;
