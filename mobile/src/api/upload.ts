import { Platform } from 'react-native';
import { ApiError } from './client';
import type { UploadSignature } from './endpoints';
import type { PrescriptionFile } from '../store/cart';

export interface UploadedFile { publicId: string; url: string; mimeType: string; sizeBytes: number; resourceType: 'image' | 'raw' | 'video' }

/** Direct signed upload to Cloudinary; the API secret never leaves the backend. */
export async function uploadPrescription(file: PrescriptionFile, sig: UploadSignature): Promise<UploadedFile> {
  const form = new FormData();
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(file.uri)).blob(), file.name);
  } else {
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('signature', sig.signature);
  form.append('folder', sig.folder);
  form.append('type', sig.type);
  let res: Response;
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'network', 'Upload failed. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.public_id) throw new ApiError(res.status, 'upload_failed', data?.error?.message ?? 'Upload failed. Please try again.');
  return { publicId: data.public_id, url: data.secure_url, mimeType: file.mimeType, sizeBytes: data.bytes ?? file.sizeBytes ?? 0, resourceType: (data.resource_type as UploadedFile['resourceType']) ?? 'image' };
}
