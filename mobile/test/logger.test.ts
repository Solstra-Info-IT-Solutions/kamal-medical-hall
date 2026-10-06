import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLogger, redact, type LogLevel } from '../src/core/logging/logger';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('logger redaction', () => {
  it('masks credentials, personal data and token-looking text', () => {
    const out = redact({
      authorization: `Bearer ${JWT}`, idToken: JWT, otp: '123456', phone: '9876543210', email: 'a@b.in', address: 'B-12',
      nested: { password: 'x', ok: 'fine', list: [{ refreshToken: 'r' }] },
      message: `failed for Bearer ${JWT} number 9876543210`,
    }) as Record<string, any>;
    assert.equal(out.authorization, '[redacted]'); assert.equal(out.idToken, '[redacted]'); assert.equal(out.otp, '[redacted]');
    assert.equal(out.phone, '[redacted]'); assert.equal(out.email, '[redacted]'); assert.equal(out.address, '[redacted]');
    assert.equal(out.nested.password, '[redacted]'); assert.equal(out.nested.ok, 'fine'); assert.equal(out.nested.list[0].refreshToken, '[redacted]');
    assert.doesNotMatch(out.message, /eyJ|9876543210/);
    assert.doesNotMatch(JSON.stringify(out), /eyJ/);
  });

  it('keeps error messages but not their secrets, and survives odd input', () => {
    const e = redact(new Error(`boom Bearer ${JWT}`)) as { message: string };
    assert.doesNotMatch(e.message, /eyJ/);
    const cyc: Record<string, unknown> = { a: 1 }; cyc.self = cyc;
    assert.doesNotThrow(() => redact(cyc));
    assert.equal(redact(null), null); assert.equal(redact(5), 5);
  });
});

describe('logger levels', () => {
  const collect = (dev: boolean) => {
    const seen: Array<[LogLevel, string, unknown]> = []; const errors: unknown[] = [];
    const log = createLogger({ dev, sink: (l, m, d) => seen.push([l, m, d]), onError: (e) => errors.push(e) });
    return { log, seen, errors };
  };
  it('prints everything in development', () => {
    const { log, seen } = collect(true);
    log.debug('a'); log.info('b'); log.warn('c'); log.error('d');
    assert.deepEqual(seen.map((s) => s[0]), ['debug', 'info', 'warn', 'error']);
  });
  it('prints only warnings and errors in production, redacted, and forwards errors to crash reporting', () => {
    const { log, seen, errors } = collect(false);
    log.debug('no'); log.info('no');
    log.warn('slow', { token: JWT, route: 'GET /orders' });
    log.error('crash', { phone: '9876543210' });
    assert.deepEqual(seen.map((s) => s[0]), ['warn', 'error']);
    assert.deepEqual(seen[0]![2], { token: '[redacted]', route: 'GET /orders' });
    assert.equal(errors.length, 1);
  });
});
