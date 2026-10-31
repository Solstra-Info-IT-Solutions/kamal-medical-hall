import type { ClientSession } from 'mongoose';

import Attendance from './models/Attendance.js';
import DeliveryPartner from './models/DeliveryPartner.js';
import StoreClosedDay from './models/StoreClosedDay.js';
import { User } from './models/User.js';
import { StoreSettings } from './models/StoreSettings.js';

import { conflict } from './http.js';
import { notifyMany } from './notify.js';
import {
  getTodayISTDateKey,
  setPartnerState,
} from './partnerState.js';
import { emitAdmins } from './realtime.js';
import { afterCommit } from './transactionHooks.js';

export type DutyStatus = 'on_duty' | 'off_duty' | 'on_break' | 'leave';

/**
 * Adds the running break to accumulated break minutes.
 * The caller must clear breakStartedAt after applying this value.
 */
function calculateBreakMinutes(
  breakMinutes: number,
  breakStartedAt: Date | null,
  now: Date,
): number {
  const additionalMinutes = breakStartedAt
    ? Math.max(
        0,
        Math.floor(
          (now.getTime() - breakStartedAt.getTime()) / 60000,
        ),
      )
    : 0;

  return breakMinutes + additionalMinutes;
}

/**
 * The partner's own attendance: on duty, off duty, on break or leave.
 *
 * Pass the MongoDB session from tx() so all database changes and
 * notification records participate in the same transaction.
 */
export async function setDutyStatus(
  session: ClientSession,
  partnerId: string,
  status: DutyStatus,
  partnerName: string | null,
): Promise<void> {
  const today = getTodayISTDateKey();
  const userId = partnerId;

  const partner = await DeliveryPartner.findOne({
    userId,
  }).session(session);

  if (!partner?.active) {
    throw conflict('Your account is not active.', 'inactive');
  }

  const settings = await StoreSettings.findOne().session(session);
  const storeOpen = settings?.isOpen ?? false;

  const inOrder = ['reserved', 'busy'].includes(partner.state);
  const riding = partner.state === 'returning';

  const now = new Date();

  if (status === 'on_duty') {
    if (!storeOpen) {
      throw conflict(
        'The store is closed today. Your day is marked as paid leave.',
        'store_closed',
      );
    }

    await DeliveryPartner.updateOne(
      { _id: partner._id },
      {
        $set: {
          onDuty: true,
          onDutyDay: today,
        },
      },
      { session },
    );

    const attendance = await Attendance.findOne({
      partnerId: partner.userId,
      day: today,
    }).session(session);

    await Attendance.updateOne(
      {
        partnerId: partner.userId,
        day: today,
      },
      {
        $set: {
          status: 'present',
          checkedInAt: attendance?.checkedInAt ?? now,
          checkedOutAt: null,
          breakMinutes: calculateBreakMinutes(
            attendance?.breakMinutes ?? 0,
            attendance?.breakStartedAt ?? null,
            now,
          ),
          breakStartedAt: null,
        },
      },
      {
        upsert: true,
        session,
      },
    );

    if (['off', 'break'].includes(partner.state)) {
      await setPartnerState(session, userId, 'available');
    }

    return;
  }

  if (inOrder) {
    throw conflict(
      'Finish or hand back your current delivery first.',
      'has_active_order',
    );
  }

  if (status === 'on_break') {
    const onDutyToday =
      partner.onDuty && partner.onDutyDay === today;

    if (!onDutyToday) {
      throw conflict(
        'Start your duty before taking a break.',
        'not_on_duty',
      );
    }

    if (riding) {
      throw conflict(
        'Take your break once you are back at the shop.',
        'still_returning',
      );
    }

    if (partner.state === 'break') {
      return;
    }

    await Attendance.updateOne(
      {
        partnerId: partner.userId,
        day: today,
      },
      {
        $set: {
          breakStartedAt: now,
        },
      },
      { session },
    );

    await setPartnerState(session, userId, 'break');
    return;
  }

  if (status === 'off_duty') {
    await DeliveryPartner.updateOne(
      { _id: partner._id },
      {
        $set: {
          onDuty: false,
        },
      },
      { session },
    );

    const attendance = await Attendance.findOne({
      partnerId: partner.userId,
      day: today,
      status: 'present',
      checkedOutAt: null,
    }).session(session);

    if (attendance) {
      await Attendance.updateOne(
        { _id: attendance._id },
        {
          $set: {
            checkedOutAt: now,
            breakMinutes: calculateBreakMinutes(
              attendance.breakMinutes,
              attendance.breakStartedAt,
              now,
            ),
            breakStartedAt: null,
          },
        },
        { session },
      );
    }

    await setPartnerState(session, userId, 'off');
    return;
  }

  // Leave
  await DeliveryPartner.updateOne(
    { _id: partner._id },
    {
      $set: {
        onDuty: false,
      },
    },
    { session },
  );

  const attendance = await Attendance.findOne({
    partnerId: partner.userId,
    day: today,
  }).session(session);

  await Attendance.updateOne(
    {
      partnerId: partner.userId,
      day: today,
    },
    {
      $set: {
        status: storeOpen ? 'leave' : 'paid_leave',
        checkedOutAt:
          attendance?.checkedOutAt ??
          (attendance?.checkedInAt ? now : null),
        breakMinutes: calculateBreakMinutes(
          attendance?.breakMinutes ?? 0,
          attendance?.breakStartedAt ?? null,
          now,
        ),
        breakStartedAt: null,
      },
    },
    {
      upsert: true,
      session,
    },
  );

  await setPartnerState(session, userId, 'off');

  afterCommit(session, () => {
    emitAdmins('partner:update', {
      partnerId,
      state: 'off',
    });
  });

  const admins = await User.find({
    role: 'admin',
  })
    .select('_id')
    .session(session)
    .lean();

  await notifyMany(
    admins.map((admin) => admin._id.toString()),
    'partner_leave',
    'Leave marked',
    `${partnerName ?? 'A delivery partner'} marked leave for today`,
    session,
  );
}

/**
 * The store closes for the day.
 *
 * Partners with active deliveries are allowed to finish them.
 * Other partners are checked out or marked as paid leave.
 */
export async function closeStore(
  session: ClientSession,
): Promise<void> {
  const today = getTodayISTDateKey();

  await StoreClosedDay.updateOne(
    { day: today },
    {
      $setOnInsert: {
        day: today,
      },
    },
    {
      upsert: true,
      session,
    },
  );

  const partners = await DeliveryPartner.find({
    active: true,
  })
    .select('userId state')
    .session(session)
    .lean();

  const free = partners.filter(
    (partner) =>
      !['reserved', 'busy', 'returning'].includes(partner.state),
  );

  const paid: string[] = [];

  for (const partner of free) {
    const partnerId = partner.userId;

    const attendance = await Attendance.findOne({
      partnerId,
      day: today,
    }).session(session);

    const worked =
      attendance?.status === 'present' &&
      attendance.checkedInAt != null;

    const now = new Date();

    if (worked && attendance) {
      await Attendance.updateOne(
        { _id: attendance._id },
        {
          $set: {
            checkedOutAt: attendance.checkedOutAt ?? now,
            breakMinutes: calculateBreakMinutes(
              attendance.breakMinutes,
              attendance.breakStartedAt,
              now,
            ),
            breakStartedAt: null,
          },
        },
        { session },
      );
    } else {
      await Attendance.updateOne(
        {
          partnerId,
          day: today,
        },
        {
          $set: {
            status: 'paid_leave',
          },
          $setOnInsert: {
            partnerId,
            day: today,
            checkedInAt: null,
            checkedOutAt: null,
            breakMinutes: 0,
            breakStartedAt: null,
          },
        },
        {
          upsert: true,
          session,
        },
      );

      paid.push(partnerId.toString());
    }

    await DeliveryPartner.updateOne(
      { userId: partnerId },
      {
        $set: {
          onDuty: false,
        },
      },
      { session },
    );

    await setPartnerState(
      session,
      partnerId.toString(),
      'off',
    );
  }

  const customers = await User.find({
    role: 'customer',
  })
    .select('_id')
    .session(session)
    .lean();

  await notifyMany(
    customers.map((customer) => customer._id.toString()),
    'store_closed',
    'Store closed',
    'Kamal Medical Hall is closed right now and is not taking new orders. We will let you know when we reopen.',
    session,
  );

  await notifyMany(
    paid,
    'store_closed',
    'Store closed today',
    'The store is closed today. Your day is marked as paid leave.',
    session,
  );

  const workedPartners = partners
    .map((partner) => partner.userId.toString())
    .filter((id) => !paid.includes(id));

  await notifyMany(
    workedPartners,
    'store_closed',
    'Store closed',
    'The store is closed. Your duty for today has ended.',
    session,
  );
}

/**
 * Reopens the store on the same day.
 * Removes today's paid-leave records so partners can check in again.
 */
export async function reopenStore(
  session: ClientSession,
): Promise<void> {
  const today = getTodayISTDateKey();

  await StoreClosedDay.deleteOne(
    { day: today },
    { session },
  );

  const paidAttendance = await Attendance.find({
    day: today,
    status: 'paid_leave',
  })
    .select('partnerId')
    .session(session)
    .lean();

  const back = paidAttendance.map(
    (attendance) => attendance.partnerId.toString(),
  );

  await Attendance.deleteMany(
    {
      day: today,
      status: 'paid_leave',
    },
    { session },
  );

  const partners = await DeliveryPartner.find({
    active: true,
  })
    .select('userId')
    .session(session)
    .lean();

  const customers = await User.find({
    role: 'customer',
  })
    .select('_id')
    .session(session)
    .lean();

  await notifyMany(
    customers.map((customer) => customer._id.toString()),
    'store_open',
    'We are open',
    'Kamal Medical Hall is open again. You can place your order now.',
    session,
  );

  await notifyMany(
    partners.map((partner) => partner.userId.toString()),
    'store_open',
    'Store reopened',
    back.length
      ? 'The store is open again. Start your duty to receive deliveries.'
      : 'The store is open again.',
    session,
  );

  afterCommit(session, () => {
    emitAdmins('partner:update', {});
  });
} 