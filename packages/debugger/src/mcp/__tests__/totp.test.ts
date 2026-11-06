/**
 * Unit tests for the time-stepped relay auth code in src/mcp/totp.ts.
 *
 * Coverage:
 *  - code shape (32 lowercase hex characters) and determinism per 10 s step
 *  - ±1 time-step skew acceptance
 *  - timingSafeEqual path (verified indirectly: valid code passes, invalid fails)
 *  - Edge cases: short/long/non-hex/uppercase codes, empty secret
 *  - buildRelayVerifyAuth: RELAY_VERIFY_SKEW_STEPS=6 acceptance (30-35 s window)
 *
 * NOTE: This test does NOT produce or assert on any secret value or TOTP code
 * beyond what is necessary to verify the algorithm — no code values are logged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START_ATTACH_SEGMENT_MS } from '../attach-orchestrator.js';
import {
  buildRelayVerifyAuth,
  generateTotp,
  RELAY_CODE_MAX_AGE_SECONDS,
  RELAY_CODE_MIN_AGE_SECONDS,
  RELAY_CODE_STEP_SECONDS,
  RELAY_QR_REFRESH_INTERVAL_MS,
  RELAY_VERIFY_FUTURE_SKEW_STEPS,
  RELAY_VERIFY_SKEW_STEPS,
  verifyTotp,
} from '../totp.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixture secret, hex-encoded (ASCII "12345678901234567890"). */
const RFC_SECRET = '3132333435363738393031323334353637383930';

/** One code step in ms. */
const STEP_MS = RELAY_CODE_STEP_SECONDS * 1000;

// The relay gate reads the wall clock itself. Pin it to the middle of a step so
// window-edge assertions cannot race a real step boundary between minting a
// code and verifying it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000 + STEP_MS / 2);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Fixture times (counter 5 and counter 9) with the code generated for each. */
const VECTORS: Array<{ unix: number; code: string }> = [
  // T-counter = 5: floor(59 / 10) = 5
  { unix: 59 * 1000, code: generateTotp(RFC_SECRET, 59 * 1000) },
  // T-counter = 9: floor(90 / 10) = 9
  { unix: 90 * 1000, code: generateTotp(RFC_SECRET, 90 * 1000) },
];

// Internal consistency: a code generated at time T verifies at the same T
// (round-trip), and a code from T±1 verifies within skew, while a code from
// T±2 does not.

describe('generateTotp', () => {
  it('returns 32 lowercase hex characters', () => {
    const code = generateTotp(RFC_SECRET, 1000);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
  });

  it('depends on the secret', () => {
    const t = 1_700_000_000_000;
    expect(generateTotp(RFC_SECRET, t)).not.toBe(generateTotp('ab'.repeat(20), t));
  });

  it('is deterministic — same secret + time → same code', () => {
    const t = 1_700_000_000_000;
    expect(generateTotp(RFC_SECRET, t)).toBe(generateTotp(RFC_SECRET, t));
  });

  it('produces different codes for different time steps', () => {
    const t1 = 0;
    const t2 = STEP_MS; // next step
    expect(generateTotp(RFC_SECRET, t1)).not.toBe(generateTotp(RFC_SECRET, t2));
  });

  it('produces the same code for all milliseconds within the same step', () => {
    const step = 1_620_000_000; // arbitrary step start in seconds
    const base = step * 1000;
    const code = generateTotp(RFC_SECRET, base);
    // Any ms within [base, base + STEP_MS - 1] should produce the same code.
    expect(generateTotp(RFC_SECRET, base + STEP_MS / 2)).toBe(code);
    expect(generateTotp(RFC_SECRET, base + STEP_MS - 1)).toBe(code);
  });

  it('produces a different code one step later', () => {
    const base = 1_620_000_000_000;
    const next = base + STEP_MS;
    expect(generateTotp(RFC_SECRET, base)).not.toBe(generateTotp(RFC_SECRET, next));
  });
});

describe('verifyTotp — round-trip', () => {
  it('verifies a freshly generated code (skew=0)', () => {
    const now = Date.now();
    const code = generateTotp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, 0)).toBe(true);
  });

  it('rejects a code from a different step (skew=0)', () => {
    const now = Date.now();
    const staleTime = now - STEP_MS; // previous step
    const staleCode = generateTotp(RFC_SECRET, staleTime);
    expect(verifyTotp(RFC_SECRET, staleCode, now, 0)).toBe(false);
  });
});

describe('verifyTotp — ±1 skew (default)', () => {
  for (const { unix, code } of VECTORS) {
    it(`accepts code for step at unix=${unix / 1000}s within ±1 skew`, () => {
      // Verify within the same step.
      expect(verifyTotp(RFC_SECRET, code, unix)).toBe(true);
      // Verify one step behind (T-1).
      expect(verifyTotp(RFC_SECRET, code, unix + STEP_MS)).toBe(true);
      // Verify one step ahead (T+1).
      expect(verifyTotp(RFC_SECRET, code, unix - STEP_MS)).toBe(true);
    });

    it(`rejects code two steps away from unix=${unix / 1000}s`, () => {
      // Two steps ahead — outside ±1 window.
      expect(verifyTotp(RFC_SECRET, code, unix - 2 * STEP_MS)).toBe(false);
      // Two steps behind.
      expect(verifyTotp(RFC_SECRET, code, unix + 2 * STEP_MS)).toBe(false);
    });
  }
});

describe('verifyTotp — invalid inputs', () => {
  const now = Date.now();
  const validCode = generateTotp(RFC_SECRET, now);

  it('rejects an empty code', () => {
    expect(verifyTotp(RFC_SECRET, '', now)).toBe(false);
  });

  it('rejects a code that is too short', () => {
    expect(verifyTotp(RFC_SECRET, validCode.slice(0, 31), now)).toBe(false);
  });

  it('rejects a code that is too long', () => {
    expect(verifyTotp(RFC_SECRET, `${validCode}0`, now)).toBe(false);
  });

  it('rejects a six-digit decimal code', () => {
    expect(verifyTotp(RFC_SECRET, '123456', now, 1000)).toBe(false);
  });

  it('rejects a code with non-hex characters', () => {
    expect(verifyTotp(RFC_SECRET, 'g'.repeat(32), now)).toBe(false);
  });

  it('rejects the right code in upper case', () => {
    expect(verifyTotp(RFC_SECRET, validCode.toUpperCase(), now, 0)).toBe(false);
  });

  it('rejects a non-string code', () => {
    expect(verifyTotp(RFC_SECRET, 123456 as unknown as string, now)).toBe(false);
  });

  it('rejects a code that differs in one character', () => {
    const last = validCode[31] === '0' ? '1' : '0';
    expect(verifyTotp(RFC_SECRET, validCode.slice(0, 31) + last, now)).toBe(false);
  });

  it('rejects a valid code against the wrong secret', () => {
    const otherSecret = '0'.repeat(RFC_SECRET.length);
    expect(verifyTotp(otherSecret, validCode, now)).toBe(false);
  });
});

describe('verifyTotp — constant-time comparison (timingSafeEqual path)', () => {
  // We can only observe that the function returns the correct boolean. The
  // constant-time guarantee is enforced by the Node.js `crypto.timingSafeEqual`
  // implementation; we trust its correctness and only verify that the right
  // return value flows through.
  it('returns true for the correct code (timingSafeEqual passes)', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, 0)).toBe(true);
  });

  it('returns false for an incorrect code (timingSafeEqual fails)', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, now);
    // Mutate the first character to something different.
    const wrong = (code[0] === '0' ? '1' : '0') + code.slice(1);
    expect(verifyTotp(RFC_SECRET, wrong, now, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RELAY_VERIFY_SKEW_STEPS constant
// ---------------------------------------------------------------------------

describe('RELAY_VERIFY_SKEW_STEPS', () => {
  it('equals 6', () => {
    expect(RELAY_VERIFY_SKEW_STEPS).toBe(6);
  });

  it('keeps a fresh code accepted for 30 to 35 s, never longer', () => {
    expect(RELAY_CODE_STEP_SECONDS).toBe(5);
    expect(RELAY_CODE_MIN_AGE_SECONDS).toBe(30);
    expect(RELAY_CODE_MAX_AGE_SECONDS).toBe(35);
  });

  it('re-issues the QR once per step and a shown QR keeps at least 25 s of validity', () => {
    expect(RELAY_QR_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(RELAY_CODE_STEP_SECONDS * 1000);
    expect(START_ATTACH_SEGMENT_MS).toBeLessThanOrEqual(RELAY_CODE_STEP_SECONDS * 1000);
    const guaranteedMs = RELAY_CODE_MIN_AGE_SECONDS * 1000;
    // A QR is replaced at most one refresh interval after the step rolled over,
    // for the dashboard push and for the start_attach segment alike.
    const oldestShownMs = Math.max(RELAY_QR_REFRESH_INTERVAL_MS, START_ATTACH_SEGMENT_MS);
    expect(RELAY_QR_REFRESH_INTERVAL_MS).toBe(5_000);
    expect(guaranteedMs - oldestShownMs).toBeGreaterThanOrEqual(25_000);
  });
});

// ---------------------------------------------------------------------------
// buildRelayVerifyAuth — T-3..T relay gate
//
// SECRET-HANDLING: test fixture secret is an obvious dummy (hex-encoded
// constant with no operational significance). No code values are logged.
// ---------------------------------------------------------------------------

/**
 * Dummy hex secret for relay-gate tests.
 * 64 hex chars = 32 bytes, satisfying MIN_SECRET_HEX_CHARS=32.
 * Value is a recognisable test fixture with no operational significance.
 */
const RELAY_TEST_SECRET = 'deadbeef'.repeat(8); // 64 hex chars

/** Build a minimal IncomingMessage stub for the upgrade-gate predicate. */
function makeReq(atCode: string): import('node:http').IncomingMessage {
  return {
    url: `/client/id?target=t1&at=${encodeURIComponent(atCode)}`,
  } as import('node:http').IncomingMessage;
}

describe('buildRelayVerifyAuth — RELAY_VERIFY_SKEW_STEPS window (#490)', () => {
  it('refuses every code when the env var is not set', () => {
    const predicate = buildRelayVerifyAuth({});
    expect(predicate(makeReq(generateTotp(RELAY_TEST_SECRET)))).toBe(false);
  });

  it('accepts a code issued at the current time step', () => {
    const now = Date.now();
    const code = generateTotp(RELAY_TEST_SECRET, now);
    const predicate = buildRelayVerifyAuth(
      { AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET },
      RELAY_TEST_SECRET,
    );
    // Use a fake req; the predicate reads `at=` from req.url.
    expect(predicate(makeReq(code))).toBe(true);
  });

  it('accepts a code issued one step ago', () => {
    const issuanceTime = Date.now() - STEP_MS; // exactly one step back
    const code = generateTotp(RELAY_TEST_SECRET, issuanceTime);
    const predicate = buildRelayVerifyAuth(
      { AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET },
      RELAY_TEST_SECRET,
    );
    expect(predicate(makeReq(code))).toBe(true);
  });

  it('rejects a code issued 70 s ago (outside the window)', () => {
    const issuanceTime = Date.now() - 70_000; // 70 s ago = at least 2 steps back
    const code = generateTotp(RELAY_TEST_SECRET, issuanceTime);
    const predicate = buildRelayVerifyAuth(
      { AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET },
      RELAY_TEST_SECRET,
    );
    expect(predicate(makeReq(code))).toBe(false);
  });

  it('rejects a missing at= code', () => {
    const predicate = buildRelayVerifyAuth(
      { AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET },
      RELAY_TEST_SECRET,
    );
    const reqNoAt = { url: '/client/id?target=t1' } as import('node:http').IncomingMessage;
    expect(predicate(reqNoAt)).toBe(false);
  });
});

describe('verifyTotp — default skew=1 unchanged after #490', () => {
  it('still rejects a code 2 steps old with default skew=1', () => {
    const now = Date.now();
    const twoStepsAgo = now - 2 * STEP_MS;
    const oldCode = generateTotp(RFC_SECRET, twoStepsAgo);
    expect(verifyTotp(RFC_SECRET, oldCode, now)).toBe(false);
  });

  it('still accepts a code 1 step old with default skew=1', () => {
    const now = Date.now();
    const oneStepAgo = now - STEP_MS;
    const code = generateTotp(RFC_SECRET, oneStepAgo);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
  });
});

describe('buildRelayVerifyAuth — asymmetric window', () => {
  const verify = buildRelayVerifyAuth(
    { AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET },
    RELAY_TEST_SECRET,
  );
  const STEP = STEP_MS;
  const at = (steps: number) => makeReq(generateTotp(RELAY_TEST_SECRET, Date.now() + steps * STEP));

  it('keeps the backwards window a freshly shown QR needs', () => {
    expect(verify?.(at(-1))).toBe(true);
  });

  it('accepts the current step and the RELAY_VERIFY_SKEW_STEPS before it', () => {
    for (let k = 0; k <= RELAY_VERIFY_SKEW_STEPS; k++) expect(verify?.(at(-k))).toBe(true);
    expect(verify?.(at(-(RELAY_VERIFY_SKEW_STEPS + 1)))).toBe(false);
    expect(verify?.(at(-(RELAY_VERIFY_SKEW_STEPS + 2)))).toBe(false);
  });

  it('accepts no future step', () => {
    expect(RELAY_VERIFY_FUTURE_SKEW_STEPS).toBe(0);
    expect(verify?.(at(1))).toBe(false);
    expect(verify?.(at(3))).toBe(false);
  });
});
