import { describe, expect, it } from 'vitest';
import { isRedactionEnabled, type RedactionStats, redactDeep, redactText } from '../page-redact.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz';

describe('redactText', () => {
  it('masks JWTs, Bearer tokens and token-like query values', () => {
    const stats: RedactionStats = {};
    const out = redactText(
      `jwt ${JWT} / Authorization: Bearer abcdef1234567890 / https://x.test/cb?code=1&access_token=AAA111&page=2`,
      stats,
    );
    expect(out).not.toContain(JWT);
    expect(out).not.toContain('abcdef1234567890');
    expect(out).not.toContain('AAA111');
    expect(out).toContain('page=2');
    expect(out).toContain('access_token=[REDACTED]');
    expect(stats).toEqual({ jwt: 1, bearer: 1, 'token-param': 1 });
  });

  it('masks resident registration numbers', () => {
    const stats: RedactionStats = {};
    expect(redactText('rrn 900101-1234567 ok', stats)).toBe('rrn [REDACTED:rrn] ok');
    expect(redactText('9001011234567', stats)).toBe('[REDACTED:rrn]');
    expect(stats.rrn).toBe(2);
    // Not a date, or part of a longer number.
    expect(redactText('901301-1234567')).toBe('901301-1234567');
    expect(redactText('99900101123456789')).toBe('99900101123456789');
  });

  it('masks card numbers that pass the Luhn check and leaves other digits alone', () => {
    const stats: RedactionStats = {};
    expect(redactText('card 4111 1111 1111 1111 end', stats)).toBe('card [REDACTED:card] end');
    expect(redactText('4111-1111-1111-1111', stats)).toBe('[REDACTED:card]');
    expect(redactText('order 1234 5678 9012 3456')).toBe('order 1234 5678 9012 3456');
    expect(redactText('ts 1731100000000')).toBe('ts 1731100000000');
    expect(stats.card).toBe(2);
  });

  it('leaves ordinary text alone', () => {
    const text = 'GET /api/items?page=2&sort=asc 200 in 12ms';
    expect(redactText(text)).toBe(text);
  });
});

describe('redactDeep', () => {
  it('masks nested strings and keeps the rest', () => {
    const stats: RedactionStats = {};
    const out = redactDeep(
      { n: 1, list: [{ url: `https://x.test/?token=abc123` }, JWT], ok: true, none: null },
      stats,
    );
    expect(out).toEqual({
      n: 1,
      list: [{ url: 'https://x.test/?token=[REDACTED]' }, '[REDACTED:jwt]'],
      ok: true,
      none: null,
    });
    expect(stats).toEqual({ 'token-param': 1, jwt: 1 });
  });

  it('is switched off by AIT_DEBUG_REDACT=off', () => {
    const saved = process.env.AIT_DEBUG_REDACT;
    try {
      process.env.AIT_DEBUG_REDACT = 'off';
      expect(isRedactionEnabled()).toBe(false);
      delete process.env.AIT_DEBUG_REDACT;
      expect(isRedactionEnabled()).toBe(true);
    } finally {
      if (saved !== undefined) process.env.AIT_DEBUG_REDACT = saved;
    }
  });
});
