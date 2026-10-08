import * as ImageManipulator from 'expo-image-manipulator';
import { Image, Platform } from 'react-native';
import { ApiError } from './client';
import type { UploadSignature } from './endpoints';
import type { PrescriptionFile } from '../store/cart';

export interface UploadedFile { publicId: string; url: string; mimeType: string; sizeBytes: number; resourceType: 'image' | 'raw' | 'video' }

/** Android's HTTP stack rejects odd characters in a multipart file name (spaces, Hindi letters, brackets), which shows up as a network error. */
const safeName = (name: string) => {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) : '';
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
  return ext ? `${base}.${ext}` : base;
};

/** Same request through XMLHttpRequest, which handles file parts more reliably than fetch on some Android builds. */
function postWithXhr(url: string, form: FormData): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 120000;
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new Error('XHR network error'));
    xhr.ontimeout = () => reject(new Error('timed out'));
    xhr.send(form);
  });
}

const MAX_SIDE = 1600;       // plenty to read a prescription or bill, a fraction of a 12 MP camera photo
const SKIP_BELOW = 350_000;  // already small: send as is

const imageSize = (uri: string) => new Promise<{ width: number; height: number }>((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));

/** Camera photos are 3-6 MB; resized and re-encoded they are ~250 KB, which is what makes uploads on mobile data fast. Falls back to the original on any problem. */
async function shrinkImage(file: PrescriptionFile): Promise<PrescriptionFile> {
  if (Platform.OS === 'web' || !/^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimeType) || (file.sizeBytes ?? Infinity) < SKIP_BELOW) return file;
  try {
    const { width, height } = await imageSize(file.uri);
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const out = await ImageManipulator.manipulateAsync(file.uri, scale < 1 ? [{ resize: width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE } }] : [], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
    return { ...file, uri: out.uri, mimeType: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '') + '.jpg', sizeBytes: undefined };
  } catch {
    return file;
  }
}

/** Direct signed upload to Cloudinary; the API secret never leaves the backend. */
export async function uploadPrescription(original: PrescriptionFile, sig: UploadSignature): Promise<UploadedFile> {
  const file = await shrinkImage(original);
  const build = async () => {
    const form = new FormData();
    if (Platform.OS === 'web') {
      form.append('file', await (await fetch(file.uri)).blob(), safeName(file.name));
    } else {
      form.append('file', { uri: file.uri, name: safeName(file.name), type: file.mimeType || 'application/octet-stream' } as unknown as Blob);
    }
    form.append('api_key', sig.apiKey.trim());
    form.append('timestamp', String(sig.timestamp));
    form.append('signature', sig.signature);
    form.append('folder', sig.folder);
    form.append('type', sig.type);
    return form;
  };
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(sig.cloudName.trim())}/auto/upload`;

  let status = 0; let text = ''; let cause = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000); // uploads get their own, longer, policy
  try {
    const res = await fetch(url, { method: 'POST', body: await build(), signal: controller.signal });
    status = res.status; text = await res.text();
  } catch (e) {
    cause = (e as Error)?.message ?? 'unknown';
    try {
      const r = await postWithXhr(url, await build()); // second attempt, different network path
      status = r.status; text = r.body; cause = '';
    } catch (e2) {
      cause = `${cause}; ${(e2 as Error)?.message ?? ''}`;
    }
  } finally {
    clearTimeout(timer);
  }
  if (cause) throw new ApiError(0, 'network', `Upload failed (${cause.slice(0, 120)}). Check your internet connection and try again.`);

  let data: { public_id?: string; secure_url?: string; bytes?: number; resource_type?: string; error?: { message?: string } } | null = null;
  try { data = JSON.parse(text); } catch { data = null; }
  if (status < 200 || status >= 300 || !data?.public_id) throw new ApiError(status, 'upload_failed', data?.error?.message ?? `Upload failed (${status}). Please try again.`);
  return { publicId: data.public_id, url: data.secure_url ?? '', mimeType: file.mimeType, sizeBytes: data.bytes ?? file.sizeBytes ?? 0, resourceType: (data.resource_type as UploadedFile['resourceType']) ?? 'image' };
}
