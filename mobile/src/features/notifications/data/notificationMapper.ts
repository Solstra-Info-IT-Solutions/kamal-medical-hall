import { kindOf, type Notification } from '../domain/Notification';
import type { NotificationDto } from './notificationDto';

export const toNotification = (dto: NotificationDto): Notification => ({
  id: dto.id, kind: kindOf(dto.type), type: dto.type, title: dto.title, body: dto.body, read: dto.read,
  createdAt: dto.createdAt, orderId: dto.orderId, orderNumber: dto.orderNumber,
});
