/**
 * Unit tests for src/mcp/log.ts — JSON-line logger + allowlist redact.
 *
 * Redact matrix:
 *   Input value                  | Expected output
 *   -----------------------------|----------------
 *   32-hex relay auth code       | "***"
 *   "aitcc_abc123" (Deploy Key)  | "***"
 *   "AITCC_XYZ" (Deploy Key)     | "***"
 *   "session=abc; path=/"        | "***"  (cookie-like value)
 *   "wss://foo.trycloudflare.com"| "***"  (relay WSS URL)
 *   "hello world" (plain msg)    | "hello world"  (pass-through)
 *   42 (number)                  | 42  (pass-through)
 *   true (boolean)               | true  (pass-through)
 *
 * Logger output contract:
 *   - Each call writes exactly one '\n'-terminated JSON line to stderr.
 *   - Parsed JSON contains: ts (ISO-8601), level, event.
 *   - Unknown field keys are dropped.
 *   - Secret values under allowed keys are replaced with "***".
 *
 * NOTE: No secret values appear in test assertions — only structural checks
 * and the expected "***" sentinel are asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logError, logInfo, logWarn, redact } from '../log.js';
import { generateTotp } from '../totp.js';

/** Fixture secret (64 hex characters) with no operational meaning. */
const SECRET = 'cafebabe'.repeat(8);

// ---------------------------------------------------------------------------
// stderr capture helper
// ---------------------------------------------------------------------------

let stderrLines: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrLines = [];
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    if (typeof chunk === 'string') {
      stderrLines.push(chunk);
    }
    return true;
  });
});

afterEach(() => {
  stderrSpy.mockRestore();
});

/** Parses the last stderr line as JSON. Throws if not valid JSON. */
function lastLine(): Record<string, unknown> {
  const line = stderrLines.at(-1) ?? '';
  return JSON.parse(line) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// redact() — pure function tests (no I/O)
// ---------------------------------------------------------------------------

describe('redact()', () => {
  it('redacts a relay auth code (whole string)', () => {
    expect(redact(generateTotp(SECRET, 1_700_000_000_000))).toBe('***');
  });

  it('redacts a relay auth code embedded in a longer string', () => {
    const code = generateTotp(SECRET, 1_700_000_000_000);
    expect(redact(`dial failed for /at/${code}/target/x`)).toBe('***');
    expect(redact(`https://h.example/p?debug=1&at=${code}`)).toBe('***');
    expect(redact(`at=${code}`)).toBe('***');
  });

  it('redacts a relay endpoint signature carried in a query', () => {
    expect(redact(`https://h.example/p?debug=1&sig=${'S'.repeat(86)}`)).toBe('***');
    expect(redact('https://h.example/p?design=1')).toBe('https://h.example/p?design=1');
  });

  it('redacts the secret itself', () => {
    expect(redact(SECRET)).toBe('***');
  });

  it('redacts a hex code regardless of case', () => {
    expect(redact(generateTotp(SECRET, 1_700_000_000_000).toUpperCase())).toBe('***');
  });

  it('keeps writing a freshly generated code as "***" in a log line', () => {
    logInfo('tool.call', { msg: generateTotp(SECRET, Date.now()) });
    expect(lastLine().msg).toBe('***');
  });

  it('redacts an AITCC_API_KEY (aitcc_ prefix, case-insensitive)', () => {
    expect(redact('aitcc_abc123secret')).toBe('***');
    expect(redact('AITCC_ABC123SECRET')).toBe('***');
  });

  it('redacts a cookie-like value', () => {
    // "name=value" pattern of sufficient length triggers redact.
    expect(redact('session=abc123xyz')).toBe('***');
  });

  it('redacts a WSS relay URL', () => {
    expect(redact('wss://foo.trycloudflare.com')).toBe('***');
  });

  it('passes through a plain message string', () => {
    expect(redact('hello world')).toBe('hello world');
  });

  it('passes through a short debug label', () => {
    expect(redact('relay-mode')).toBe('relay-mode');
  });

  it('passes through a number', () => {
    expect(redact(42)).toBe(42);
  });

  it('passes through a boolean', () => {
    expect(redact(true)).toBe(true);
    expect(redact(false)).toBe(false);
  });

  it('passes through null', () => {
    expect(redact(null)).toBe(null);
  });

  it('does not redact a short number-like string', () => {
    expect(redact('12345')).toBe('12345');
    expect(redact('123456')).toBe('123456');
  });

  it('does not redact a uuid', () => {
    expect(redact('3f2b8c1e-7a4d-4e0b-9c55-1a2b3c4d5e6f')).toBe(
      '3f2b8c1e-7a4d-4e0b-9c55-1a2b3c4d5e6f',
    );
  });
});

// ---------------------------------------------------------------------------
// logInfo / logWarn / logError — JSON-line output tests
// ---------------------------------------------------------------------------

describe('logInfo()', () => {
  it('writes a single JSON line to stderr', () => {
    logInfo('server.start', { port: 9222 });
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]).toMatch(/\n$/);
  });

  it('emits level=info', () => {
    logInfo('server.start', { port: 9222 });
    expect(lastLine().level).toBe('info');
  });

  it('emits the correct event', () => {
    logInfo('tunnel.up', {});
    expect(lastLine().event).toBe('tunnel.up');
  });

  it('emits an ISO-8601 ts field', () => {
    logInfo('server.start', {});
    const { ts } = lastLine();
    expect(typeof ts).toBe('string');
    expect(() => new Date(ts as string).toISOString()).not.toThrow();
  });

  it('includes allowed fields', () => {
    logInfo('server.start', { port: 9222, totpEnabled: true });
    const line = lastLine();
    expect(line.port).toBe(9222);
    expect(line.totpEnabled).toBe(true);
  });

  it('drops unknown field keys (allowlist)', () => {
    logInfo('server.start', { port: 9222, secretThing: 'should-be-dropped' } as Record<
      string,
      unknown
    >);
    const line = lastLine();
    expect('secretThing' in line).toBe(false);
  });

  it('redacts a secret string under an allowed key', () => {
    // "msg" is an allowed key — its value must still be redact-scanned.
    // We use a string shaped like a relay auth code.
    logInfo('tool.call', { msg: 'ab'.repeat(16) });
    expect(lastLine().msg).toBe('***');
  });
});

describe('logWarn()', () => {
  it('emits level=warn', () => {
    logWarn('tunnel.down', { msg: 'tunnel failed' });
    expect(lastLine().level).toBe('warn');
  });
});

describe('logError()', () => {
  it('emits level=error', () => {
    logError('tool.error', { tool: 'get_page', errorKind: 'disconnect' });
    expect(lastLine().level).toBe('error');
  });

  it('includes tool and errorKind fields', () => {
    logError('tool.error', { tool: 'take_screenshot', errorKind: 'timeout' });
    const line = lastLine();
    expect(line.tool).toBe('take_screenshot');
    expect(line.errorKind).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Full event-category smoke tests
// ---------------------------------------------------------------------------

describe('event categories', () => {
  const events = [
    'server.start',
    'tunnel.up',
    'tunnel.down',
    'page.attached',
    'page.detached',
    'page.crashed',
    'stage.changed',
    'tool.call',
    'tool.error',
  ] as const;

  for (const ev of events) {
    it(`emits event=${ev} as valid JSON`, () => {
      logInfo(ev, {});
      expect(lastLine().event).toBe(ev);
    });
  }
});

describe('stage.changed event', () => {
  it('keeps stage/result/attempt and drops everything else', () => {
    logInfo('stage.changed', {
      stage: 'device-handshake',
      result: 'ok',
      attempt: 2,
      url: 'wss://relay.example/at/abcdef/target/x',
    });
    const line = lastLine();
    expect(line.stage).toBe('device-handshake');
    expect(line.result).toBe('ok');
    expect(line.attempt).toBe(2);
    expect('url' in line).toBe(false);
  });
});
