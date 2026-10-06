/**
 * Environment-aware logging with redaction.
 *  - Development: everything is printed.
 *  - Production: only warnings and errors, and only after sensitive values were masked.
 * Nothing in here depends on React Native, so it can be unit-tested with plain Node.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Keys whose values are never printed. */
const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|passcode|otp|code|token|idtoken|accesstoken|refreshtoken|secret|signature|apikey|api_key|phone|email|address|line1|line2|body|note|comment)$/i;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{6,}\b/g;
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi;
const LONG_DIGITS = /\b\d{10,}\b/g;

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [redacted]').replace(JWT, '[token]').replace(LONG_DIGITS, '[number]');
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[deep]';
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

export interface LogSink { (level: LogLevel, message: string, data?: unknown): void }
export interface LoggerOptions { dev: boolean; sink?: LogSink; onError?: (error: unknown, context?: Record<string, unknown>) => void }

const consoleSink: LogSink = (level, message, data) => {
  const fn = level === 'debug' || level === 'info' ? console.log : level === 'warn' ? console.warn : console.error; // eslint-disable-line no-console
  if (data === undefined) fn(message); else fn(message, data);
};

export function createLogger({ dev, sink = consoleSink, onError }: LoggerOptions) {
  const min = dev ? RANK.debug : RANK.warn;
  const emit = (level: LogLevel, message: string, data?: unknown) => {
    if (RANK[level] < min) return;
    sink(level, redact(message) as string, dev ? data : redact(data));
  };
  return {
    debug: (m: string, d?: unknown) => emit('debug', m, d),
    info: (m: string, d?: unknown) => emit('info', m, d),
    warn: (m: string, d?: unknown) => emit('warn', m, d),
    /** Errors are also forwarded (redacted) to crash reporting. */
    error: (m: string, d?: unknown) => { emit('error', m, d); onError?.(d instanceof Error ? d : new Error(String(redact(m))), d && typeof d === 'object' ? (redact(d) as Record<string, unknown>) : undefined); },
  };
}
export type Logger = ReturnType<typeof createLogger>;
