
import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { authed, requireRole } from '../auth.js';
import { tx } from '../db.js';
import { HttpError, conflict, notFound, parse } from '../http.js';
import { afterCommit } from '../transactionHooks.js';

import Announcement, {
  type IAnnouncement,
  type IAnnouncementImage,
} from '../models/Announcement.js';

import { User } from '../models/User.js';
import { Notification } from '../models/Notification.js';

import { pushToUsers } from '../notify.js';
import { emitEveryone, emitUser } from '../realtime.js';

import {
  isBlockedFile,
  jpgUrl,
  signedPrescriptionUrl,
  type ResourceType,
} from '../services.js';

/**
 * Announcements from the shop to its customers.
 *
 * - Image announcements appear as a slider on the customer home screen.
 * - Text-only announcements create/update one in-app notification per customer.
 * - An announcement can optionally expire at a specified date/time.
 * - Admins can activate, deactivate, edit, resend or delete announcements.
 */

const imageSchema = z.object({
  publicId: z.string().min(3).max(300),
  mimeType: z.string().max(100),
  resourceType: z.enum(['image', 'raw', 'video']).default('image'),
  sizeBytes: z.number().int().max(15_000_000).optional(),
});

const draftSchema = z.object({
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().max(1000).default(''),
  images: z.array(imageSchema).max(6).default([]),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});

type ImageView = {
  publicId: string;
  mimeType: string;
  resourceType: ResourceType;
};

const isExpired = (announcement: {
  expiresAt?: Date | null;
}): boolean =>
  announcement.expiresAt != null &&
  announcement.expiresAt.getTime() <= Date.now();

const isLive = (announcement: IAnnouncement): boolean =>
  Boolean(announcement.lastSentAt) &&
  announcement.isActive &&
  !isExpired(announcement);

const view = (announcement: IAnnouncement | Record<string, any>) => {
  const images = (announcement.images ?? []) as ImageView[];
  const expired = isExpired(announcement);

  return {
    id: String(announcement._id),
    title: announcement.title,
    body: announcement.body,
    expiresAt: announcement.expiresAt ?? null,
    createdAt: announcement.createdAt,
    lastSentAt: announcement.lastSentAt ?? null,
    sendCount: announcement.sendCount,
    isActive: announcement.isActive,
    active: Boolean(announcement.lastSentAt) && announcement.isActive && !expired,
    expired,
    status: expired
      ? 'expired'
      : announcement.isActive
        ? 'active'
        : 'inactive',
    hasImages: images.length > 0,
    images: images.map((image) => ({
      publicId: image.publicId,
      mimeType: image.mimeType,
      url: jpgUrl(
        image.publicId,
        image.mimeType,
        image.resourceType,
        1,
        1200,
      ),
      fullUrl: signedPrescriptionUrl(
        image.publicId,
        image.mimeType,
        image.resourceType,
      ),
    })),
  };
};

const checkImages = (
  images: { publicId: string }[],
  adminId: string,
): void => {
  if (
    images.some(
      (image) =>
        !image.publicId.startsWith(`announcements/${adminId}/`) ||
        isBlockedFile(image.publicId),
    )
  ) {
    throw new HttpError(400, 'invalid_file', 'Invalid picture.');
  }
};

const validAnnouncementId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id) &&
  new mongoose.Types.ObjectId(id).toString() === id.toLowerCase();

/**
 * Delivers an announcement to all active customer accounts.
 *
 * Text-only announcements create/update one notification per customer.
 * All notification and realtime events are emitted only after transaction
 * commit. Push notifications are sent after the database transaction.
 */
export async function deliverAnnouncement(id: string): Promise<number> {
  if (!validAnnouncementId(id)) {
    throw notFound('Announcement not found');
  }

  const customerIds = await User.find({
    role: 'customer',
    phone: { $not: /^deleted-/ },
  })
    .select('_id')
    .lean()
    .then((users) => users.map((user) => user._id));

  const customerIdStrings = customerIds.map((customerId) =>
    customerId.toString(),
  );

  const reached = await tx(async (session) => {
    const announcement = await Announcement.findById(id).session(session);

    if (!announcement) {
      throw notFound('Announcement not found');
    }

    if (isExpired(announcement)) {
      throw conflict(
        'This announcement has expired. Set a new expiry date (or remove it) before sending it again.',
        'expired',
      );
    }

    if (!announcement.isActive) {
      throw conflict(
        'This announcement is switched off. Activate it first.',
        'inactive',
      );
    }

    announcement.lastSentAt = new Date();
    announcement.sendCount += 1;

    await announcement.save({ session });

    if (announcement.images.length === 0 && customerIds.length > 0) {
      const now = new Date();

      await Notification.bulkWrite(
        customerIds.map((userId) => ({
          updateOne: {
            filter: {
              userId,
              announcementId: announcement._id,
            },
            update: {
              $set: {
                title: announcement.title,
                body: announcement.body || announcement.title,
                readAt: null,
                createdAt: now,
              },
              $setOnInsert: {
                userId,
                orderId: null,
                type: 'announcement',
                announcementId: announcement._id,
              },
            },
            upsert: true,
          },
        })),
        { session },
      );

      const notifications = await Notification.find({
        userId: { $in: customerIds },
        announcementId: announcement._id,
      })
        .session(session)
        .select('_id userId title body')
        .lean();

      afterCommit(session, () => {
        for (const notification of notifications) {
          emitUser(notification.userId.toString(), 'notification', {
            id: notification._id.toString(),
            type: 'announcement',
            title: announcement.title,
            body: announcement.body,
            orderId: null,
            announcementId: announcement._id.toString(),
          });
        }
      });
    }

    return customerIds.length;
  });

  emitEveryone('announcement:update', { id });

  const announcement = await Announcement.findById(id).lean();

  if (announcement) {
    void pushToUsers(
      customerIdStrings,
      announcement.title,
      announcement.body.slice(0, 120) ||
        (announcement.images.length
          ? 'Tap to see the details'
          : announcement.title),
      {
        type: 'announcement',
        announcementId: id,
      },
    ).catch((error) => {
      console.error('announcement push failed', error);
    });
  }

  return reached;
};

// ------------------------------------------------------------------
// Customers
// ------------------------------------------------------------------

export const announcementsPublic = Router();

/** Announcements that are live now, newest first. */
announcementsPublic.get(
  '/announcements',
  authed,
  async (_req, res) => {
    const announcements = await Announcement.find({
      lastSentAt: { $ne: null },
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    })
      .sort({ lastSentAt: -1 })
      .limit(20);

    res.json({
      announcements: announcements.map(view),
    });
  },
);

announcementsPublic.get(
  '/announcements/:id',
  authed,
  async (req, res) => {
    const id = String(req.params.id);

    if (!validAnnouncementId(id)) {
      throw notFound('Announcement not found');
    }

    const announcement = await Announcement.findOne({
      _id: id,
      lastSentAt: { $ne: null },
      isActive: true,
    });

    if (!announcement || isExpired(announcement)) {
      throw notFound('Announcement not found');
    }

    res.json({
      announcement: view(announcement),
    });
  },
);

// ------------------------------------------------------------------
// Admin
// ------------------------------------------------------------------

export const announcementsAdmin = Router();

announcementsAdmin.use(authed, requireRole('admin'));

announcementsAdmin.get('/announcements', async (_req, res) => {
  const announcements = await Announcement.find()
    .sort({ lastSentAt: -1, createdAt: -1 })
    .limit(200);

  res.json({
    announcements: announcements.map(view),
  });
});

/** Creates a batch of announcements and sends them. */
announcementsAdmin.post('/announcements', async (req, res) => {
  const body = parse(
    z.object({
      items: z.array(draftSchema).min(1).max(10),
    }),
    req.body,
  );

  for (const draft of body.items) {
    checkImages(draft.images, req.user!.id);

    if (
      draft.expiresAt &&
      new Date(draft.expiresAt).getTime() <= Date.now()
    ) {
      throw new HttpError(
        422,
        'expiry_in_past',
        'The expiry date must be in the future.',
      );
    }
  }

  const ids = await tx(async (session) => {
    const created = await Announcement.create(
      body.items.map((draft) => ({
        title: draft.title,
        body: draft.body,
        images: draft.images,
        expiresAt: draft.expiresAt
          ? new Date(draft.expiresAt)
          : null,
        createdBy: new mongoose.Types.ObjectId(req.user!.id),
        lastSentAt: null,
        sendCount: 0,
        isActive: true,
      })),
      { session },
    );

    return created.map((announcement) =>
      announcement._id.toString(),
    );
  });

  let reached = 0;

  for (const id of ids) {
    reached = await deliverAnnouncement(id);
  }

  res.status(201).json({
    ids,
    sentTo: reached,
  });
});

/** Edit text, pictures, expiry date or activation status. */
announcementsAdmin.patch(
  '/announcements/:id',
  async (req, res) => {
    const id = String(req.params.id);

    if (!validAnnouncementId(id)) {
      throw notFound('Announcement not found');
    }

    const body = parse(
      z.object({
        title: z.string().trim().min(2).max(80).optional(),
        body: z.string().trim().max(1000).optional(),
        images: z.array(imageSchema).max(6).optional(),
        expiresAt: z
          .string()
          .datetime({ offset: true })
          .nullable()
          .optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );

    if (body.images) {
      checkImages(body.images, req.user!.id);
    }

    if (
      body.expiresAt &&
      new Date(body.expiresAt).getTime() <= Date.now()
    ) {
      throw new HttpError(
        422,
        'expiry_in_past',
        'The expiry date must be in the future.',
      );
    }

    const update: Record<string, unknown> = {};

    if (body.title !== undefined) update.title = body.title;
    if (body.body !== undefined) update.body = body.body;

    if (body.images !== undefined) {
      update.images = body.images;
    }

    if (body.expiresAt !== undefined) {
      update.expiresAt = body.expiresAt
        ? new Date(body.expiresAt)
        : null;
    }

    if (body.isActive !== undefined) {
      update.isActive = body.isActive;
    }

    const announcement = await Announcement.findByIdAndUpdate(
      id,
      { $set: update },
      {
        returnDocument: 'after',
        runValidators: true,
      },
    );

    if (!announcement) {
      throw notFound('Announcement not found');
    }

    emitEveryone('announcement:update', { id });

    res.json({
      announcement: view(announcement),
    });
  },
);

/** Resend an announcement to all customers. */
announcementsAdmin.post(
  '/announcements/:id/send',
  async (req, res) => {
    const id = String(req.params.id);
    const sentTo = await deliverAnnouncement(id);

    const announcement = await Announcement.findById(id);

    if (!announcement) {
      throw notFound('Announcement not found');
    }

    res.json({
      sentTo,
      announcement: view(announcement),
    });
  },
);

announcementsAdmin.delete(
  '/announcements/:id',
  async (req, res) => {
    const id = String(req.params.id);

    if (!validAnnouncementId(id)) {
      throw notFound('Announcement not found');
    }

    const deleted = await Announcement.findByIdAndDelete(id);

    if (!deleted) {
      throw notFound('Announcement not found');
    }

    emitEveryone('announcement:update', {
      id,
      deleted: true,
    });

    res.status(204).end();
  },
);
