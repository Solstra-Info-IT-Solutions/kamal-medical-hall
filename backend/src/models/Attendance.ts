
import mongoose, { Schema, type Document, type Model } from 'mongoose';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'paid_leave'
  | 'leave'
  | 'break';

export interface IAttendance extends Document {
  partnerId: mongoose.Types.ObjectId;

  /** IST calendar date in YYYY-MM-DD format */
  day: string;

  status: AttendanceStatus;

  checkedInAt: Date | null;
  checkedOutAt: Date | null;

  breakMinutes: number;
  breakStartedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    partnerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    day: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'day must use YYYY-MM-DD format'],
    },

    status: {
      type: String,
      enum: ['present', 'absent', 'paid_leave', 'leave', 'break'],
      default: 'present',
      required: true,
    },

    checkedInAt: {
      type: Date,
      default: null,
    },

    checkedOutAt: {
      type: Date,
      default: null,
    },

    breakMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    breakStartedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'attendance',
    versionKey: false,
  },
);

attendanceSchema.index(
  { partnerId: 1, day: 1 },
  { unique: true },
);

attendanceSchema.index({ day: 1, status: 1 });

const Attendance: Model<IAttendance> =
  (mongoose.models.Attendance as Model<IAttendance>) ||
  mongoose.model<IAttendance>('Attendance', attendanceSchema);

export default Attendance;
