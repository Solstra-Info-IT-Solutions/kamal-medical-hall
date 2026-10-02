import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import Razorpay from 'razorpay';
import { config } from './config.js';
import { HttpError } from './http.js';

const cld = config.cloudinary;
if (cld.cloudName) cloudinary.config({ cloud_name: cld.cloudName, api_key: cld.apiKey, api_secret: cld.apiSecret, secure: true });

export function cloudinaryConfigured() { return Boolean(cld.cloudName && cld.apiKey && cld.apiSecret); }

/** Prescriptions are uploaded with type=authenticated, so only signed URLs can read them. */
export function signUpload(userId: string) {
  if (!cloudinaryConfigured()) throw new HttpError(503, 'uploads_unavailable', 'Prescription upload is not configured yet');
  const timestamp = Math.round(Date.now() / 1000);
  const params = { folder: `prescriptions/${userId}`, timestamp, type: 'authenticated' };
  const signature = cloudinary.utils.api_sign_request(params, cld.apiSecret);
  return { cloudName: cld.cloudName, apiKey: cld.apiKey, signature, ...params };
}

export function signedPrescriptionUrl(publicId: string, mimeType: string) {
  if (!cloudinaryConfigured()) return null;
  return cloudinary.url(publicId, {
    type: 'authenticated', resource_type: 'image', sign_url: true, secure: true,
    format: mimeType === 'application/pdf' ? 'pdf' : undefined,
  });
}

let razorpay: Razorpay | undefined;
const rz = config.razorpay;
export function razorpayConfigured() { return Boolean(rz.keyId && rz.keySecret); }
export function razorpayClient() {
  if (!razorpayConfigured()) throw new HttpError(503, 'payments_unavailable', 'Online payment is not configured yet');
  razorpay ??= new Razorpay({ key_id: rz.keyId, key_secret: rz.keySecret });
  return razorpay;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const expected = crypto.createHmac('sha256', rz.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}
export function verifyWebhookSignature(rawBody: Buffer, signature: string) {
  if (!rz.webhookSecret) return false;
  return safeEqual(crypto.createHmac('sha256', rz.webhookSecret).update(rawBody).digest('hex'), signature);
}
