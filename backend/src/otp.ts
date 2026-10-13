import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { normalisePhone, signSessionToken } from './auth.js';
import { config } from './config.js';
import { pool } from './db.js';
import { HttpError, parse } from './http.js';
import { SmsError, renderOtp, sendSms, smsSettings } from './sms.js';

/**
 * Login OTP by SMS. Two ways, chosen by AUTH_MODE:
 *  - 'sms': this server makes a 6-digit code, keeps only its hash for 5 minutes, and sends it through the SMS gateway
 *    the admin configured (PearlSMS). Wrong codes are counted; the 5th wrong try burns the code.
 *  - 'twilio': Twilio Verify generates, sends, expires and checks the code; this server only relays the request.
 * Either way this server issues its own session token once the code is confirmed.
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
const serverOtp = () => config.authMode === 'twilio' || config.authMode === 'sms';

export const OTP_TTL_MS = 5 * 60_000;
const RESEND_AFTER_MS = 30_000;
const MAX_SENDS_PER_WINDOW = 5; // per phone, per 10 minutes
const MAX_WRONG = 5;
const hashCode = (phone: string, code: string) => createHmac('sha256', config.jwtSecret).update(`otp:${phone}:${code}`).digest('hex');

/** 'sms' mode: makes, stores (hashed) and sends a new code. The row lock keeps two quick taps from sending two codes. */
async function sendOwnCode(phone: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { rows } = await pool.query(
    `insert into otp_codes as o (phone, code_hash, expires_at) values ($1, $2, now() + make_interval(secs => $3))
     on conflict (phone) do update set
       code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, last_sent_at = now(),
       sends = case when o.window_started_at < now() - interval '10 minutes' then 1 else o.sends + 1 end,
       window_started_at = case when o.window_started_at < now() - interval '10 minutes' then now() else o.window_started_at end
     where o.last_sent_at < now() - make_interval(secs => $4)
       and (o.window_started_at < now() - interval '10 minutes' or o.sends < $5)
     returning phone`,
    [phone, hashCode(phone, code), OTP_TTL_MS / 1000, RESEND_AFTER_MS / 1000, MAX_SENDS_PER_WINDOW],
  );
  if (!rows.length) throw new HttpError(429, 'otp_rate_limited', 'Please wait a moment before asking for another OTP.');
  try {
    const s = await smsSettings();
    await sendSms(phone, renderOtp(s.otpTemplate, code), s);
  } catch (e) {
    await pool.query("update otp_codes set expires_at = now(), last_sent_at = now() - interval '1 hour' where phone = $1", [phone]); // not sent: allow a retry at once
    if (e instanceof SmsError && e.reason === 'not_configured') throw new HttpError(503, 'otp_unavailable', 'OTP login is not set up yet. Please contact the store.');
    throw new HttpError(502, 'otp_unavailable', 'Could not send the OTP right now. Please try again in a moment.');
  }
}

/** 'sms' mode: true when the code matches the latest unexpired one; the code is used up on success. */
async function checkOwnCode(phone: string, code: string) {
  const { rows } = await pool.query('select code_hash, attempts, expires_at > now() as live from otp_codes where phone = $1', [phone]);
  const row = rows[0];
  if (!row || !row.live || row.attempts >= MAX_WRONG) throw new HttpError(401, 'invalid_otp', 'This OTP has expired or was already used. Please request a new one.');
  const want = Buffer.from(row.code_hash, 'hex');
  const got = Buffer.from(hashCode(phone, code), 'hex');
  if (!timingSafeEqual(want, got)) {
    const { rows: after } = await pool.query('update otp_codes set attempts = attempts + 1 where phone = $1 returning attempts', [phone]);
    if ((after[0]?.attempts ?? MAX_WRONG) >= MAX_WRONG) throw new HttpError(401, 'invalid_otp', 'Too many wrong attempts. Please request a new OTP.');
    throw new HttpError(401, 'invalid_otp', 'Incorrect OTP');
  }
  // Used up: expired now, but the row stays so the resend limits still apply.
  await pool.query('update otp_codes set expires_at = now(), attempts = $2 where phone = $1', [phone, MAX_WRONG]);
}

otpRouter.post('/send', async (req, res) => {
  if (!serverOtp()) throw new HttpError(404, 'not_found', 'Not found');
  const phone = normalisePhone(parse(phoneSchema, req.body).phone);
  if (!allowSend(phone)) throw new HttpError(429, 'otp_rate_limited', 'Too many OTP requests. Please wait a few minutes and try again.');
  if (config.authMode === 'sms') { await sendOwnCode(phone); res.status(204).end(); return; }
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
  if (!serverOtp()) throw new HttpError(404, 'not_found', 'Not found');
  const b = parse(z.object({ phone: z.string().min(10).max(15), code: z.string().regex(/^\d{4,8}$/) }), req.body);
  const phone = normalisePhone(b.phone);
  if (config.authMode === 'sms') {
    await checkOwnCode(phone, b.code);
    res.json({ token: signSessionToken(phone, 'sms') });
    return;
  }
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
