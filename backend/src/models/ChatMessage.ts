import { Schema, model, Types, Model } from 'mongoose';

export interface IChatMessage {
  _id?: Types.ObjectId;
  threadId: Types.ObjectId;
  senderId?: Types.ObjectId | null;
  senderRole: 'customer' | 'admin' | 'bot';
  body: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
  threadId: { type: Schema.Types.ObjectId, ref: 'ChatThread', required: true, index: true },
  senderId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  senderRole: { type: String, enum: ['customer', 'admin', 'bot'], required: true },
  body: { type: String, required: true },
}, {
  timestamps: true,
  versionKey: false,
});

// Index for thread messages
chatMessageSchema.index({ threadId: 1, createdAt: 1 });

export const ChatMessage: Model<IChatMessage> = model<IChatMessage>('ChatMessage', chatMessageSchema);