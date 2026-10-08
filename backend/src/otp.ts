import { Router } from 'express';
import { z } from 'zod';
import { normalisePhone, signSessionToken } from './auth.js';
import { config } from './config.js';
import { HttpError, parse } from './http.js';

/**
 * SMS OTP through Twilio Verify (AUTH_MODE=twilio). Twilio generates, sends, expires and checks the code; this server
 * only relays the request, limits abuse, and issues its own session token once Twilio says "approved".
 */
export const otpRouter = Router();

type Fetch = typeof fetch;
let http: Fetch = (...a) => fetch(...a);
/** Tests replace the network call. */
export const setTwilioFetch = (f: Fetch) => { http = f; };

const base = () => `https://verify.twilio.com/v2/Services/${config.twilio.verifyServiceSid}`;
const authHeader = () => `Basic ${Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64')}`;

async function twilio(path: string, form: Record<string, string>) {
  const res = await http(`${base()}${path}`, { method: 'POST', headers: { authorization: authHeader(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({})) as { status?: string; code?: number; message?: string };
  return { status: res.status, body };
}

/** Simple in-memory limits (per phone number); the general per-IP limit also applies. */
const sends = new Map<string, number[]>();
const fails = new Map<string, { n: number; until: number }>();
function allowSend(phone: string) {
  const now = Date.now();
  const recent = (sends.get(phone) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 5) return false;
  sends.set(phone, [...recent, now]);
  return true;
}

const phoneSchema = z.object({ phone: z.string().min(10).max(15) });

otpRouter.post('/send', async (req, res) => {
  if (config.authMode !== 'twilio') throw new HttpError(404, 'not_found', 'Not found');
  const phone = normalisePhone(parse(phoneSchema, req.body).phone);
  if (!allowSend(phone)) throw new HttpError(429, 'otp_rate_limited', 'Too many OTP requests. Please wait a few minutes and try again.');
  const r = await twilio('/Verifications', { To: `+91${phone}`, Channel: 'sms' });
  if (r.status >= 400) {
    console.error(JSON.stringify({ level: 'error', msg: 'twilio send failed', status: r.status, twilioCode: r.body.code }));
    // 60203 = max send attempts reached, 60410 = number blocked/fraud guard, 21608 = trial account: number not verified
    if (r.body.code === 60203) throw new HttpError(429, 'otp_rate_limited', 'Too many OTP requests. Please wait a few minutes and try again.');
    if (r.body.code === 60200 || r.body.code === 21211) throw new HttpError(422, 'invalid_phone', 'Enter a valid 10-digit Indian mobile number');
    throw new HttpError(502, 'otp_unavailable', 'Could not send the OTP right now. Please try again in a moment.');
  }
  res.status(204).end();
});

otpRouter.post('/verify', async (req, res) => {
  if (config.authMode !== 'twilio') throw new HttpError(404, 'not_found', 'Not found');
  const b = parse(z.object({ phone: z.string().min(10).max(15), code: z.string().regex(/^\d{4,8}$/) }), req.body);
  const phone = normalisePhone(b.phone);
  const f = fails.get(phone);
  if (f && f.n >= 5 && f.until > Date.now()) throw new HttpError(429, 'otp_rate_limited', 'Too many wrong attempts. Please request a new OTP in a few minutes.');
  const r = await twilio('/VerificationCheck', { To: `+91${phone}`, Code: b.code });
  if (r.status >= 500) throw new HttpError(502, 'otp_unavailable', 'Could not verify the OTP right now. Please try again in a moment.');
  if (r.status === 404) throw new HttpError(401, 'invalid_otp', 'This OTP has expired or was already used. Please request a new one.'); // Twilio: no pending verification
  if (r.body.status !== 'approved') {
    fails.set(phone, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
  }
  fails.delete(phone);
  res.json({ token: signSessionToken(phone) });
});
