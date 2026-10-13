import { Router } from 'express';
import { z } from 'zod';
import { authed, normalisePhone, requireRole } from '../auth.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { HttpError, parse } from '../http.js';
import { SmsError, forgetSmsSettings, renderOtp, sendSms, smsSettings } from '../sms.js';

/**
 * Admin: the SMS gateway used for login OTPs (sender ID, SMS type, API key, message). The API key is write-only:
 * the panel shows only its last 4 characters, and leaving the field empty keeps the saved key.
 */
export const smsAdmin = Router();
smsAdmin.use(authed, requireRole('admin'));

const masked = (key: string | null) => (key ? `••••${key.slice(-4)}` : null);
const view = async () => {
  const s = await smsSettings();
  return { apiUrl: s.apiUrl, senderId: s.senderId, smsType: s.smsType, otpTemplate: s.otpTemplate, apiKeySet: Boolean(s.apiKey), apiKeyHint: masked(s.apiKey), updatedAt: s.updatedAt, inUse: config.authMode === 'sms' };
};

const trimmed = (max: number) => z.string().trim().max(max);
const schema = z.object({
  senderId: trimmed(11).regex(/^[A-Za-z0-9]{3,11}$/, 'Sender ID is 3 to 11 letters or digits, like SPPLFW').transform((v) => v.toUpperCase()),
  smsType: trimmed(20).regex(/^[A-Za-z_]{2,20}$/, 'SMS type is a word like TRANS').transform((v) => v.toUpperCase()),
  apiKey: trimmed(200).optional(), // empty or missing: keep the saved key
  otpTemplate: trimmed(480).min(8).refine((v) => v.includes('{otp}'), 'The message must contain {otp} where the code goes'),
  apiUrl: trimmed(300).regex(/^https:\/\/\S+$/i, 'The gateway address must start with https://').optional(),
});

smsAdmin.get('/sms', async (_req, res) => { res.json(await view()); });

smsAdmin.put('/sms', async (req, res) => {
  const b = parse(schema, req.body);
  await pool.query(
    `update sms_settings set sender_id = $1, sms_type = $2, otp_template = $3, api_key = coalesce($4, api_key), api_url = coalesce($5, api_url), updated_at = now(), updated_by = $6 where id = 1`,
    [b.senderId, b.smsType, b.otpTemplate, b.apiKey || null, b.apiUrl ?? null, req.user!.id],
  );
  forgetSmsSettings();
  res.json(await view());
});

/** Sends the OTP message with a sample code to a number the admin types, to check the settings end to end. */
smsAdmin.post('/sms/test', async (req, res) => {
  const phone = normalisePhone(parse(z.object({ phone: z.string().min(10).max(15) }), req.body).phone);
  forgetSmsSettings();
  const s = await smsSettings();
  try {
    const r = await sendSms(phone, renderOtp(s.otpTemplate, '123456'), s);
    res.json({ sent: true, requestId: r.requestId });
  } catch (e) {
    if (e instanceof SmsError) throw new HttpError(e.reason === 'not_configured' ? 422 : 502, `sms_${e.reason}`, e.reason === 'not_configured' ? 'Enter the sender ID and API key first.' : `The SMS gateway said: ${e.message}`);
    throw e;
  }
});
