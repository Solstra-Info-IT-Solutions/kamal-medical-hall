import { Schema, model, Types, Model } from 'mongoose';

export type NotificationType = 'order_status' | 'chat' | 'announcement' | 'customer_signup';

export interface INotification {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  orderId?: Types.ObjectId | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const notificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  type: { type: String, enum: ['order_status', 'chat', 'announcement', 'customer_signup'], required: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  readAt: { type: Date, default: null },
}, {
  timestamps: true,
  versionKey: false,
});

// Indexes for common queries
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ createdAt: -1 });

export const Notification: Model<INotification> = model<INotification>('Notification', notificationSchema);