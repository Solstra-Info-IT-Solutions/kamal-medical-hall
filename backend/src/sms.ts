import { pool } from './db.js';

/**
 * Text messages through the SMS gateway (PearlSMS). The admin sets the sender ID, SMS type, API key and the OTP
 * message (it must match the template approved on DLT) in the admin panel; they live in `sms_settings`.
 * The key is sent in a POST body over HTTPS, so it never appears in a URL or a proxy log.
 */
export interface SmsSettings { apiUrl: string; senderId: string; smsType: string; apiKey: string | null; otpTemplate: string; updatedAt: string }

type Fetch = typeof fetch;
let http: Fetch = (...a) => fetch(...a);
/** Tests replace the network call. */
export const setSmsFetch = (f: Fetch) => { http = f; };

let cached: { value: SmsSettings; at: number } | null = null;
export const forgetSmsSettings = () => { cached = null; };

export async function smsSettings(): Promise<SmsSettings> {
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const { rows } = await pool.query('select api_url, sender_id, sms_type, api_key, otp_template, updated_at from sms_settings where id = 1');
  const r = rows[0] ?? {};
  const value: SmsSettings = {
    apiUrl: r.api_url ?? 'https://sms.pearlsms.com/public/sms/send', senderId: r.sender_id ?? '', smsType: r.sms_type ?? 'TRANS',
    apiKey: r.api_key ?? null, otpTemplate: r.otp_template ?? 'Your OTP is {otp}.', updatedAt: r.updated_at,
  };
  cached = { value, at: Date.now() };
  return value;
}

export const renderOtp = (template: string, code: string) => template.replaceAll('{otp}', code);

export class SmsError extends Error {
  constructor(public reason: 'not_configured' | 'rejected' | 'unreachable', message: string) { super(message); }
}

/** Sends one SMS to a 10-digit Indian number. Throws SmsError with the gateway's own reason when it refuses. */
export async function sendSms(phone: string, message: string, settings?: SmsSettings): Promise<{ requestId: string | null }> {
  const s = settings ?? await smsSettings();
  if (!s.apiKey || !s.senderId) throw new SmsError('not_configured', 'SMS sender ID or API key is not set');
  let res: Response;
  try {
    res = await http(s.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ sender: s.senderId, smstype: s.smsType, numbers: phone, apikey: s.apiKey, message }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SmsError('unreachable', 'The SMS gateway could not be reached');
  }
  const text = await res.text();
  let body: { status?: string; errormsg?: string; requestid?: string | number | null } = {};
  try { body = JSON.parse(text); } catch { /* some gateways answer in plain text */ }
  const failed = !res.ok || String(body.status ?? '').toUpperCase() === 'ERROR' || (!text.trim().startsWith('{') && /error|invalid|fail/i.test(text));
  if (failed) {
    const reason = body.errormsg ?? (text.slice(0, 200) || `HTTP ${res.status}`);
    console.error(JSON.stringify({ level: 'error', msg: 'sms not sent', status: res.status, reason }));
    throw new SmsError('rejected', reason);
  }
  return { requestId: body.requestid != null ? String(body.requestid) : null };
}
