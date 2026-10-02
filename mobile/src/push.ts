import { Platform } from 'react-native';
import { endpoints } from './api/endpoints';

/** Registers the FCM token with the backend. A no-op where Firebase Messaging is not built in (web / dev mode). */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const fb = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    const messaging = fb.getMessaging();
    const status = await fb.requestPermission(messaging);
    if (status === fb.AuthorizationStatus.DENIED) return;
    const token = await fb.getToken(messaging);
    if (token) await endpoints.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  } catch {
    // Firebase not configured in this build; push is optional.
  }
}
