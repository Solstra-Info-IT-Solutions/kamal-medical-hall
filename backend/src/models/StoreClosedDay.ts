
import mongoose, {
  Schema,
  type Document,
  type Model,
} from 'mongoose';

export interface IStoreClosedDay extends Document {
  /** IST calendar date in YYYY-MM-DD format */
  day: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeClosedDaySchema = new Schema<IStoreClosedDay>(
  {
    day: {
      type: String,
      required: true,
      unique: true,
      match: [
        /^\d{4}-\d{2}-\d{2}$/,
        'day must use YYYY-MM-DD format',
      ],
    },
  },
  {
    timestamps: true,
    collection: 'store_closed_days',
    versionKey: false,
  },
);

const StoreClosedDay: Model<IStoreClosedDay> =
  (mongoose.models.StoreClosedDay as Model<IStoreClosedDay>) ||
  mongoose.model<IStoreClosedDay>(
    'StoreClosedDay',
    storeClosedDaySchema,
  );

export default StoreClosedDay;
