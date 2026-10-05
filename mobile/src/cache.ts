import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useCart } from './store/cart';

/** Prescription uploads kept by id so a retry does not upload the same file twice; emptied once an order is placed. */
export const uploadedFiles = new Map<string, unknown>();

/**
 * Forgets everything about the order that was just placed: the cart (in memory and on disk), the upload bookkeeping
 * and the temporary copies of the photos and documents the pickers made in the app's cache folder.
 */
export async function clearOrderCache() {
  useCart.getState().clear();
  uploadedFiles.clear();
  try { await AsyncStorage.removeItem('kmh.cart.v2'); } catch { /* storage unavailable */ }
  if (Platform.OS === 'web') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
    const base = FileSystem.cacheDirectory;
    if (!base) return;
    for (const dir of ['ImagePicker/', 'DocumentPicker/', 'Camera/']) {
      try { await FileSystem.deleteAsync(`${base}${dir}`, { idempotent: true }); } catch { /* already gone */ }
    }
  } catch { /* file system module unavailable */ }
}
