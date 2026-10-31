
import mongoose, {
  Schema,
  type Document,
  type Types,
} from 'mongoose';

export type ChatThreadStatus = 'open' | 'closed';

export type ChatSenderRole =
  | 'customer'
  | 'admin'
  | 'bot';

export interface IChatThread extends Document {
  customerId: Types.ObjectId;
  orderId: Types.ObjectId | null;
  subject: string;
  status: ChatThreadStatus;
  closedAt: Date | null;
  lastMessageAt: Date;
  lastAdminMsgAt: Date | null;
  adminUnread: number;
  customerUnread: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChatMessage extends Document {
  threadId: Types.ObjectId;
  senderId: Types.ObjectId | null;
  senderRole: ChatSenderRole;
  body: string;
  createdAt: Date;
}

const ChatThreadSchema = new Schema<IChatThread>(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    subject: {
      type: String,
      default: '',
      maxlength: 80,
    },
    status: {
      type: String,
      enum: ['open', 'closed'],
      default: 'open',
      required: true,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    lastAdminMsgAt: {
      type: Date,
      default: null,
    },
    adminUnread: {
      type: Number,
      default: 0,
      min: 0,
    },
    customerUnread: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'chat_threads',
  },
);

// A customer can have only one open chat at a time.
ChatThreadSchema.index(
  { customerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'open' },
  },
);

ChatThreadSchema.index({
  status: 1,
  lastMessageAt: -1,
});

ChatThreadSchema.index({
  status: 1,
  lastAdminMsgAt: -1,
});

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    threadId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatThread',
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    senderRole: {
      type: String,
      enum: ['customer', 'admin', 'bot'],
      required: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'chat_messages',
  },
);

ChatMessageSchema.index({
  threadId: 1,
  createdAt: 1,
});

export const ChatThread =
  (mongoose.models.ChatThread as mongoose.Model<IChatThread>) ||
  mongoose.model<IChatThread>('ChatThread', ChatThreadSchema);

export const ChatMessage =
  (mongoose.models.ChatMessage as mongoose.Model<IChatMessage>) ||
  mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
