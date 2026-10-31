
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export interface IChatMessage {
  _id?: Types.ObjectId;
  threadId: Types.ObjectId;
  senderId?: Types.ObjectId | null;
  senderRole: 'customer' | 'admin' | 'bot';
  body: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    threadId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatThread',
      required: true,
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
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Efficient chronological message retrieval within a chat thread.
chatMessageSchema.index({
  threadId: 1,
  createdAt: 1,
});

// Reuse existing model if already registered.
export const ChatMessage: Model<IChatMessage> =
  (mongoose.models.ChatMessage as Model<IChatMessage>) ||
  model<IChatMessage>('ChatMessage', chatMessageSchema);

export default ChatMessage;
