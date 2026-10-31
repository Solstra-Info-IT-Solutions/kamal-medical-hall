
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export interface IChatThread {
  _id?: Types.ObjectId;
  customerId: Types.ObjectId;
  orderId?: Types.ObjectId | null;
  subject: string | null;
  status: 'open' | 'closed';
  createdAt?: Date;
  updatedAt?: Date;
  closedAt?: Date | null;
}

const chatThreadSchema = new Schema<IChatThread>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
      index: true,
    },

    subject: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
    },

    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      index: true,
    },

    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const ChatThread: Model<IChatThread> =
  (mongoose.models.ChatThread as Model<IChatThread>) ||
  model<IChatThread>('ChatThread', chatThreadSchema);

export default ChatThread;
