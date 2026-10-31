
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'completed';

export interface IAssignment {
  _id?: Types.ObjectId;

  orderId: Types.ObjectId;
  partnerId: Types.ObjectId;

  status: AssignmentStatus;

  assignedAt: Date;
  respondedAt: Date | null;
  completedAt: Date | null;

  reason: string | null;
}

const assignmentSchema = new Schema<IAssignment>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },

    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: [
        'pending',
        'accepted',
        'rejected',
        'cancelled',
        'completed',
      ],
      default: 'pending',
      required: true,
    },

    assignedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },

    respondedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    reason: {
      type: String,
      default: null,
    },
  },
  {
    collection: 'assignments',
    versionKey: false,
  },
);

assignmentSchema.index({ partnerId: 1, status: 1 });
assignmentSchema.index({ partnerId: 1, completedAt: -1 });

export const Assignment: Model<IAssignment> =
  (mongoose.models.Assignment as Model<IAssignment>) ||
  model<IAssignment>('Assignment', assignmentSchema);

export default Assignment;
