
import mongoose, {
  Schema,
  type Document,
  type Model,
} from 'mongoose';

export type DevicePlatform = 'android' | 'ios' | 'web';

export interface IDeviceToken extends Document {
  token: string;
  userId: mongoose.Types.ObjectId;
  platform: DevicePlatform | null;
  createdAt: Date;
  updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    token: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'device_tokens',
  },
);

deviceTokenSchema.index({ userId: 1 });

const DeviceToken: Model<IDeviceToken> =
  (mongoose.models.DeviceToken as Model<IDeviceToken>) ||
  mongoose.model<IDeviceToken>('DeviceToken', deviceTokenSchema);

export default DeviceToken;
