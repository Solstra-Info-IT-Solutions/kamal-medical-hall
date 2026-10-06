import { api } from '../../api/client';
import { NotificationRemoteDataSource, NotificationRepositoryImpl } from './data/NotificationRepositoryImpl';
import { createNotificationUseCases } from './domain/useCases';

/** Composition root of the feature: the only place that wires the real network to the domain. */
export const notificationUseCases = createNotificationUseCases(new NotificationRepositoryImpl(new NotificationRemoteDataSource(api)));
