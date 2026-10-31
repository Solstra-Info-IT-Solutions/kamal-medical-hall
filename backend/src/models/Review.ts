
import mongoose, {
  Schema,
  model,
  Types,
  type Model,
} from 'mongoose';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface IReviewImage {
  _id?: Types.ObjectId;
  publicId: string;
  mimeType: string;
  resourceType: 'image';
  sizeBytes: number | null;
}

export interface IReview {
  _id?: Types.ObjectId;

  orderId: Types.ObjectId;
  customerId: Types.ObjectId;

  rating: number;
  comment: string | null;

  status: ReviewStatus;
  adminNote: string | null;
  decidedAt: Date | null;
  decidedBy: Types.ObjectId | null;

  images: IReviewImage[];

  createdAt?: Date;
  updatedAt?: Date;
}

const ReviewImageSchema = new Schema<IReviewImage>(
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
      enum: ['image'],
      default: 'image',
      required: true,
    },
    sizeBytes: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    _id: true,
  },
);

const ReviewSchema = new Schema<IReview>(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer.',
      },
    },
    comment: {
      type: String,
      default: null,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
    },
    adminNote: {
      type: String,
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    decidedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    images: {
      type: [ReviewImageSchema],
      default: [],
      validate: {
        validator: (images: IReviewImage[]) => images.length <= 3,
        message: 'A review can contain a maximum of 3 images.',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'reviews',
  },
);

// One review per order.
ReviewSchema.index(
  { orderId: 1 },
  { unique: true },
);

ReviewSchema.index({ customerId: 1, createdAt: -1 });
ReviewSchema.index({ status: 1, createdAt: -1 });

export const Review: Model<IReview> =
  (mongoose.models.Review as Model<IReview>) ||
  model<IReview>('Review', ReviewSchema);

export default Review;
