
import mongoose, { type ClientSession } from 'mongoose';
import DeliveryPartner, { type PartnerState } from './models/DeliveryPartner.js';
import Attendance from './models/Attendance.js';
import StoreClosedDay from './models/StoreClosedDay.js';
import { Order } from './models/Order.js';
import { StoreSettings } from './models/StoreSettings.js';
import { User } from './models/User.js';
import { emitPartner } from './realtime.js';
import { afterCommit } from './transactionHooks.js';

/**
 * off        – not checked in today (absent)
 * available  – on duty and free: can be assigned an order
 * reserved   – an order was assigned
 * busy       – out on a delivery
 * returning  – delivered, riding back to the shop
 * break      – on duty but on a break
 */

/** Returns the current calendar date in India as YYYY-MM-DD. */
export function getTodayISTDateKey(): string {
  return getISTDateKey(new Date());
}

/** Converts a JavaScript Date into an IST calendar date. */
function getISTDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/** Adds calendar days without applying the server's local timezone. */
function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function toObjectId(id: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) {
    throw new Error(`Invalid MongoDB partner ID: ${id}`);
  }

  return new mongoose.Types.ObjectId(id);
}

/**
 * Updates a partner's state.
 *
 * Pass the current MongoDB session when this operation is part of a transaction.
 */
export async function setPartnerState(
  session: ClientSession | undefined,
  partnerId: string,
  state: PartnerState,
): Promise<void> {
  const partner = await DeliveryPartner.findOneAndUpdate(
    { userId: toObjectId(partnerId) },
    {
      $set: {
        state,
        isAvailable: state === 'available',
      },
    },
    {
      returnDocument: 'after',
      ...(session ? { session } : {}),
    },
  );

  if (!partner) {
    throw new Error(`Delivery partner not found: ${partnerId}`);
  }

  // Note: this emits immediately. If called inside a transaction, the event
  // may be emitted before that transaction commits.
  const deliver = () => emitPartner(partnerId, state);

  if (session) {
    afterCommit(session, deliver);
  } else {
    deliver();
  }
}

/**
 * Works out a partner's state from the orders they are holding:
 * out for delivery -> busy;
 * assigned and waiting -> reserved;
 * otherwise on duty today and shop open -> available;
 * otherwise -> off.
 */
export async function releasePartner(
  session: ClientSession | undefined,
  partnerId: string,
): Promise<void> {
  const userId = toObjectId(partnerId);

  const [partner, storeSettings, outCount, pendingCount] = await Promise.all([
    DeliveryPartner.findOne({ userId }).session(session ?? null),
    StoreSettings.findOne().session(session ?? null),
    Order.countDocuments({
      partnerId: userId,
      status: 'out_for_delivery',
    }).session(session ?? null),
    Order.countDocuments({
      partnerId: userId,
      status: {
        $in: ['quoted', 'awaiting_payment', 'ready_to_dispatch'],
      },
    }).session(session ?? null),
  ]);

  const today = getTodayISTDateKey();

  const state: PartnerState =
    outCount > 0
      ? 'busy'
      : pendingCount > 0
        ? 'reserved'
        : partner?.onDuty &&
            partner.onDutyDay === today &&
            storeSettings?.isOpen
          ? 'available'
          : 'off';

  await setPartnerState(session, partnerId, state);
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const rad = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rough scooter ETA at about 20 km/h plus handover time. */
export const etaMinutes = (metres: number): number =>
  Math.max(1, Math.round((metres / 1000 / 20) * 60) + 2);

/**
 * Returns the configured store location, if available.
 *
 * Returns null if coordinates or geofence radius are not configured.
 * No default geofence radius is assumed.
 */
export async function storeLocation(
  session?: ClientSession,
): Promise<{
  lat: number;
  lng: number;
  geofenceM: number;
} | null> {
  const settings = await StoreSettings.findOne().session(session ?? null);

  if (
    settings?.latitude == null ||
    settings.longitude == null ||
    settings.geofenceM == null
  ) {
    return null;
  }

  return {
    lat: settings.latitude,
    lng: settings.longitude,
    geofenceM: settings.geofenceM,
  };
}

/**
 * Ends previous days' duty for partners who forgot to check out.
 *
 * Also records absences for active partners on working days without attendance.
 * Looks back seven days so a sleeping server can catch up.
 */
export async function sweepDuty(): Promise<void> {
  const today = getTodayISTDateKey();
  const now = new Date();

  // 1. End previous days' duty for partners in states that can be safely reset.
  const expiredPartners = await DeliveryPartner.find({
    onDuty: true,
    onDutyDay: { $lt: today },
    state: { $in: ['available', 'returning', 'break'] },
  }).select({ userId: 1 });

  await DeliveryPartner.updateMany(
    {
      onDuty: true,
      onDutyDay: { $lt: today },
      state: { $in: ['available', 'returning', 'break'] },
    },
    {
      $set: {
        onDuty: false,
        state: 'off',
        isAvailable: false,
      },
    },
  );

  // 2. Close old attendance records and account for unfinished breaks.
  const unfinishedAttendance = await Attendance.find({
    day: { $lt: today },
    checkedInAt: { $ne: null },
    $or: [
      { checkedOutAt: null },
      { breakStartedAt: { $ne: null } },
    ],
  });

  for (const attendance of unfinishedAttendance) {
    const additionalBreakMinutes = attendance.breakStartedAt
      ? Math.max(
          0,
          Math.floor(
            (now.getTime() - attendance.breakStartedAt.getTime()) / 60000,
          ),
        )
      : 0;

    attendance.checkedOutAt ??= now;
    attendance.breakMinutes =
      (attendance.breakMinutes ?? 0) + additionalBreakMinutes;
    attendance.breakStartedAt = null;

    await attendance.save();
  }

  // 3. Identify active partners and their account creation dates.
  const partners = await DeliveryPartner.find({ active: true })
    .select({ userId: 1 })
    .lean();

  const partnerIds = partners.map((partner) => partner.userId);

  if (partnerIds.length === 0) {
    for (const partner of expiredPartners) {
      emitPartner(partner.userId.toString(), 'off');
    }

    return;
  }

  const users = await User.find({
    _id: { $in: partnerIds },
  })
    .select({ _id: 1, createdAt: 1 })
    .lean();

  const userCreatedDates = new Map<string, string>();

  for (const user of users) {
    if (user.createdAt) {
      userCreatedDates.set(
        user._id.toString(),
        getISTDateKey(user.createdAt),
      );
    }
  }

  // 4. Skip store-closed days.
  const pastDays = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(today, -(index + 1)),
  );

  const closedDays = await StoreClosedDay.find({
    day: { $in: pastDays },
  })
    .select({ day: 1 })
    .lean();

  const closedDaySet = new Set(
    closedDays.map((record) => record.day),
  );

  // 5. Insert absences only when no attendance record exists.
  // The unique partnerId + day index prevents duplicate records.
  for (const partner of partners) {
    const partnerId = partner.userId;
    const createdDate = userCreatedDates.get(partnerId.toString());

    if (!createdDate) continue;

    for (const day of pastDays) {
      if (day < createdDate || closedDaySet.has(day)) {
        continue;
      }

      await Attendance.updateOne(
        {
          partnerId,
          day,
        },
        {
          $setOnInsert: {
            partnerId,
            day,
            status: 'absent',
            checkedInAt: null,
            checkedOutAt: null,
            breakMinutes: 0,
            breakStartedAt: null,
          },
        },
        { upsert: true },
      );
    }
  }

  // 6. Notify connected clients about partners whose duty ended.
  for (const partner of expiredPartners) {
    emitPartner(partner.userId.toString(), 'off');
  }
}
