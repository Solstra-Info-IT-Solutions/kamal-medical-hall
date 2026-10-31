
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export const NOTIFICATION_TYPES = [
  'order_status',
  'chat',
  'announcement',
  'customer_signup',
  'partner_leave',
  'store_closed',
  'store_open',
  'chat_new',
  'chat_message',
  'chat_reply',
  'account_request',
  'account_reactivated',
  'account_deactivated',
  'account_request_rejected',
  'review_new',
  'review_approved',
  'review_rejected',
  'order_requested',
  'order_cancelled',
  'ready_to_dispatch',
  'awaiting_payment',
  'payment_received',
  'payment_after_cancel',
  'quote_ready',
  'order_confirmed',
  'order_rejected',
  'assigned',
  'unassigned',
  'reassigning',
  'partner_assigned',
  'partner_accepted',
  'partner_rejected',
  'out_for_delivery',
  'delivered',
  'cash_to_collect',
  'closing_alert',
  'back_at_shop',
] as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[number];

export interface INotification {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  orderId?: Types.ObjectId | null;
  type: NotificationType;
  title: string;
  body: string;
  readAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },

    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    body: {
      type: String,
      required: true,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ createdAt: -1 });

export const Notification: Model<INotification> =
  (mongoose.models.Notification as Model<INotification>) ||
  model<INotification>('Notification', notificationSchema);

export default Notification;
