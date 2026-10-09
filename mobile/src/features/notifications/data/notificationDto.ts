import { z } from 'zod';

/** The shape the API promises. Anything else is rejected before it can reach the UI. */
export const notificationDtoSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
  orderId: z.string().nullable(),
  orderNumber: z.string().nullable(),
  announcementId: z.string().nullable().optional(),
});
export const notificationsResponseSchema = z.object({ notifications: z.array(notificationDtoSchema) });
export type NotificationDto = z.infer<typeof notificationDtoSchema>;
