
import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from 'mongoose';

export interface IShopProfile extends Document {
  details: Record<string, unknown>;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShopProfileSchema = new Schema<IShopProfile>(
  {
    details: {
      type: Schema.Types.Mixed,
      default: {},
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'shop_profiles',
  },
);

export const ShopProfile: Model<IShopProfile> =
  (mongoose.models.ShopProfile as Model<IShopProfile>) ||
  mongoose.model<IShopProfile>('ShopProfile', ShopProfileSchema);

export default ShopProfile;
