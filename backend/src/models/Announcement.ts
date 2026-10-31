
import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IAnnouncementImage {
  publicId: string;
  mimeType: string;
  resourceType: 'image' | 'raw' | 'video';
  sizeBytes?: number;
}

export interface IAnnouncement extends Document {
  title: string;
  body: string;
  images: IAnnouncementImage[];
  expiresAt: Date | null;
  createdBy: Types.ObjectId;
  lastSentAt: Date | null;
  sendCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AnnouncementImageSchema = new Schema<IAnnouncementImage>(
  {
    publicId: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    resourceType: {
      type: String,
      enum: ['image', 'raw', 'video'],
      default: 'image',
    },
    sizeBytes: {
      type: Number,
    },
  },
  { _id: false },
);

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    body: {
      type: String,
      default: '',
      maxlength: 1000,
    },
    images: {
      type: [AnnouncementImageSchema],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    sendCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'announcements',
  },
);

AnnouncementSchema.index({ lastSentAt: -1, isActive: 1 });
AnnouncementSchema.index({ expiresAt: 1 });

export const Announcement =
  (mongoose.models.Announcement as mongoose.Model<IAnnouncement>) ||
  mongoose.model<IAnnouncement>('Announcement', AnnouncementSchema);

export default Announcement;
