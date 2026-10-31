import mongoose, { type ClientSession } from 'mongoose';

import { firebaseMessaging } from './auth.js';
import { emitUser } from './realtime.js';
import { afterCommit } from './transactionHooks.js';

import {
  Notification,
  type NotificationType,
} from './models/Notification.js';

import DeviceToken from './models/DeviceToken.js';
import { User } from './models/User.js';

/**
 * Browser notifications are displayed by the site's service worker.
 */
const webpush = (title: string, body: string) => ({
  headers: {
    Urgency: 'high',
    TTL: String(24 * 3600),
  },
  notification: {
    title,
    body,
    icon: '/notification-icon.png',
    badge: '/notification-icon.png',
  },
});

/**
 * Converts a valid MongoDB ID string into an ObjectId.
 */
function toObjectId(id: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) {
    throw new Error(`Invalid MongoDB ObjectId: ${id}`);
  }

  return new mongoose.Types.ObjectId(id);
}

/**
 * Delivers a notification through realtime and Firebase.
 * This must run after the transaction commits when a session is supplied.
 */
function deliverNotification(
  userId: string,
  notificationId: string,
  orderId: string | null,
  type: NotificationType,
  title: string,
  body: string,
): void {
  emitUser(userId, 'notification', {
    id: notificationId,
    type,
    title,
    body,
    orderId,
  });

  void push(userId, title, body, orderId, type).catch((error) => {
    console.error('push failed', error);
  });
}

/**
 * Sends one notification to one user.
 *
 * When a transaction session is supplied, realtime and push delivery
 * are deferred until the transaction successfully commits.
 */
export async function notify(
  userId: string,
  orderId: string | null,
  type: NotificationType,
  title: string,
  body: string,
  session?: ClientSession,
): Promise<void> {
  const notificationData = {
    userId: toObjectId(userId),
    orderId: orderId ? toObjectId(orderId) : null,
    type,
    title,
    body,
  };

  const [notification] = session
    ? await Notification.create([notificationData], { session })
    : await Notification.create([notificationData]);

  const deliver = () => {
    deliverNotification(
      userId,
      notification._id.toString(),
      orderId,
      type,
      title,
      body,
    );
  };

  if (session) {
    afterCommit(session, deliver);
  } else {
    deliver();
  }
}

/**
 * Sends one notification to multiple users.
 * Used for store-open/store-close announcements and similar events.
 */
export async function notifyMany(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  session?: ClientSession,
): Promise<void> {
  if (!userIds.length) return;

  const uniqueRecords = userIds.map((userId) => ({
    userId: toObjectId(userId),
    orderId: null,
    type,
    title,
    body,
  }));

  const notifications = await Notification.insertMany(
    uniqueRecords,
    session ? { session } : {},
  );

  const deliver = () => {
    for (let index = 0; index < notifications.length; index++) {
      const notification = notifications[index];
      const userId = userIds[index];

      if (!notification || !userId) continue;

      deliverNotification(
        userId,
        notification._id.toString(),
        null,
        type,
        title,
        body,
      );
    }
  };

  if (session) {
    afterCommit(session, deliver);
  } else {
    deliver();
  }
}

/**
 * Sends a notification to every admin.
 */
export async function notifyAdmins(
  orderId: string | null,
  type: NotificationType,
  title: string,
  body: string,
  session?: ClientSession,
): Promise<void> {
  const admins = await User.find({ role: 'admin' })
    .select('_id')
    .lean();

  for (const admin of admins) {
    await notify(
      admin._id.toString(),
      orderId,
      type,
      title,
      body,
      session,
    );
  }
}

/**
 * Sends a phone notification through Firebase Cloud Messaging.
 *
 * Android: high priority so notifications can arrive during Doze.
 * APNs: priority 10.
 * Web: service-worker notification.
 */
async function push(
  userId: string,
  title: string,
  body: string,
  orderId: string | null,
  type = '',
): Promise<void> {
  const messaging = firebaseMessaging();

  if (!messaging) return;

  const rows = await DeviceToken.find({
    userId: toObjectId(userId),
  })
    .select('token')
    .lean();

  if (!rows.length) return;

  const tokens = rows.map((row) => row.token);

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title,
      body,
    },
    data: {
      ...(orderId ? { orderId } : {}),
      ...(type ? { type } : {}),
    },
    android: {
      priority: 'high',
      ttl: 24 * 3600 * 1000,
      notification: {
        sound: 'default',
        defaultVibrateTimings: true,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
      },
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
    webpush: webpush(title, body),
  });

  const failed = response.responses.filter(
    (result) => !result.success,
  );

  if (failed.length) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'push not delivered',
        failed: failed.length,
        of: rows.length,
        codes: [
          ...new Set(
            failed.map((result) => result.error?.code),
          ),
        ],
      }),
    );
  }

  const deadTokens: string[] = [];

  response.responses.forEach((result, index) => {
    const token = tokens[index];

    if (
      token &&
      !result.success &&
      [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ].includes(result.error?.code ?? '')
    ) {
      deadTokens.push(token);
    }
  });

  if (deadTokens.length) {
    await DeviceToken.deleteMany({
      token: { $in: deadTokens },
    });
  }
}

/**
 * Sends one push notification to multiple users.
 *
 * Device tokens are queried in bulk and sent in batches of 500,
 * respecting Firebase's multicast message limit.
 */
export async function pushToUsers(
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  const messaging = firebaseMessaging();

  if (!messaging || !userIds.length) return;

  const objectIds = userIds.map(toObjectId);

  const rows = await DeviceToken.find({
    userId: { $in: objectIds },
  })
    .select('token')
    .lean();

  const tokens = rows.map((row) => row.token);
  const deadTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 500) {
    const chunk = tokens.slice(index, index + 500);

    const response = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title,
        body,
      },
      data,
      android: {
        priority: 'high',
        ttl: 24 * 3600 * 1000,
        notification: {
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
      webpush: webpush(title, body),
    });

    response.responses.forEach((result, responseIndex) => {
      const token = chunk[responseIndex];

      if (
        token &&
        !result.success &&
        [
          'messaging/registration-token-not-registered',
          'messaging/invalid-registration-token',
        ].includes(result.error?.code ?? '')
      ) {
        deadTokens.push(token);
      }
    });
  }

  if (deadTokens.length) {
    await DeviceToken.deleteMany({
      token: { $in: deadTokens },
    });
  }
}