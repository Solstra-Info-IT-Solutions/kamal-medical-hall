
import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const OtpCodeSchema = new Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    sends: {
      type: Number,
      required: true,
      default: 1,
    },
    windowStartedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'otp_codes',
  },
);

export type IOtpCode = InferSchemaType<typeof OtpCodeSchema>;

export const OtpCode =
  (mongoose.models.OtpCode as mongoose.Model<IOtpCode>) ||
  mongoose.model<IOtpCode>('OtpCode', OtpCodeSchema);

export default OtpCode;
