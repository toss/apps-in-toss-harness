/**
 * Time-stepped relay auth code (Node.js, node:crypto only).
 *
 * The construction follows the shape of RFC 6238 (a counter derived from the
 * wall clock, keyed by a shared secret) but is not interoperable with
 * authenticator apps: nobody types this code, it travels inside a deep-link
 * or QR, so it is as wide as it can be instead of being kept human-sized.
 *
 *   T    = floor(now / STEP)              — STEP = RELAY_CODE_STEP_SECONDS (10 s)
 *   K    = Buffer.from(secret, 'hex')     — key (raw bytes, hex-encoded); for relay
 *                                          codes the per-process key from
 *                                          relay-code-secret.ts ({@link mintRelayCode})
 *   MAC  = HMAC-SHA256(K, T as 8-byte big-endian uint64)
 *   code = first 16 bytes of MAC, lowercase hex — 32 characters (128 bits)
 *
 * Security note (keep this comment accurate):
 *   The baked-in secret in a dog-food build is extractable from the bundle by a
 *   determined reverse engineer. This mechanism raises the bar from
 *   "anyone with the URL" to "URL + bundle extraction + live code calculation".
 *   Casual URL leaks (Slack paste, QR screenshot, shoulder-surfing) are
 *   blocked; deliberate reverse engineering is not. See threat model in
 *   src/mcp/chii-relay.ts and docs/design/mcp-strategy.md.
 *
 * SECRET-HANDLING: secret values and computed codes MUST NOT appear in any
 * log, error message, or string visible outside this module. Only boolean
 * pass/fail and reason enum values are safe to surface.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { isRelayAuthCode } from '@apps-in-toss/internal-protocol/relay-auth-code';
import { relayCodeSecret } from './relay-code-secret.js';
import { isRelayRootLive } from './relay-signing.js';

/**
 * Seconds in one code step. Tuning knob: together with
 * {@link RELAY_VERIFY_SKEW_STEPS} it sets how long a freshly minted code is
 * accepted (`STEP * SKEW` to `STEP * (SKEW + 1)` seconds). Keep
 * {@link RELAY_QR_REFRESH_INTERVAL_MS} at or below one step so the QR on screen
 * changes with every new code.
 */
export const RELAY_CODE_STEP_SECONDS = 5;

const TIME_STEP = RELAY_CODE_STEP_SECONDS;

/** Bytes of the MAC kept in the code (128 bits). */
const CODE_BYTES = 16;

/**
 * Derives the relay auth code from a hex-encoded secret at the given wall-
 * clock time.
 *
 * @param secret - The shared secret as a hex string (e.g. 64 hex chars = 32
 *   bytes). Must be the output of `generateAttachToken()` or compatible.
 * @param when - Unix timestamp in milliseconds. Defaults to `Date.now()`.
 * @returns 32 lowercase hex characters (the first 128 bits of the MAC).
 */
export function generateTotp(secret: string, when: number = Date.now()): string {
  const key = Buffer.from(secret, 'hex');
  // Clamp to 0 so negative timestamps (e.g. in ±skew checks near epoch) do not
  // produce a negative counter, which would cause writeUInt32BE to throw.
  const counter = Math.max(0, Math.floor(when / 1000 / TIME_STEP));

  // Encode counter as 8-byte big-endian unsigned integer.
  const counterBuf = Buffer.alloc(8);
  // JavaScript numbers are safe integers up to 2^53; counter is ~7.5×10^10 at
  // year 9999 — well within safe range so standard bitwise ops are fine.
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  counterBuf.writeUInt32BE(hi, 0);
  counterBuf.writeUInt32BE(lo, 4);

  return createHmac('sha256', key)
    .update(counterBuf)
    .digest()
    .subarray(0, CODE_BYTES)
    .toString('hex');
}

/**
 * Mints the current relay `at` code with this process's in-memory code key
 * (see `relay-code-secret.ts`). The relay booted in this process accepts it;
 * no other process can mint or check it.
 *
 * @param when - Unix timestamp in milliseconds. Defaults to `Date.now()`.
 */
export function mintRelayCode(when: number = Date.now()): string {
  return generateTotp(relayCodeSecret(), when);
}

/**
 * Verifies a relay auth code against the secret, accepting ±`skew` time steps
 * to tolerate clock drift between the relay host and the client device.
 *
 * Uses `timingSafeEqual` for constant-time comparison to prevent timing
 * side-channel attacks. A code that is not exactly 32 lowercase hex characters
 * is rejected without being compared.
 *
 * @param secret - Hex-encoded shared secret.
 * @param code - The 32-character hex code to verify.
 * @param when - Unix timestamp in milliseconds. Defaults to `Date.now()`.
 * @param skew - Number of adjacent steps to accept in the past, and in the
 *   future unless `futureSkew` says otherwise. Default 1 (accepts T-1, T, T+1).
 * @param futureSkew - Steps to accept in the future. Defaults to `skew`.
 * @returns `true` if the code matches any accepted step, `false` otherwise.
 */
export function verifyTotp(
  secret: string,
  code: string,
  when: number = Date.now(),
  skew: number = 1,
  futureSkew: number = skew,
): boolean {
  if (!isRelayAuthCode(code)) {
    return false;
  }

  const candidateBuf = Buffer.from(code, 'utf8');

  for (let delta = -skew; delta <= futureSkew; delta++) {
    const stepWhen = when + delta * TIME_STEP * 1000;
    const expected = generateTotp(secret, stepWhen);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (timingSafeEqual(expectedBuf, candidateBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * Minimum length (in hex characters) accepted for `AIT_DEBUG_TOTP_SECRET`.
 *
 * The secret is hex-encoded (see {@link generateTotp} — `Buffer.from(secret,
 * 'hex')`). 32 hex chars = 16 bytes = 128 bits, the floor for an HMAC-SHA1 key
 * we are willing to gate a public relay behind. `generateAttachToken()` emits
 * 64 hex chars (32 bytes), comfortably above this bar.
 */
const MIN_SECRET_HEX_CHARS = 32;

/** Hex string: one or more hex digits, case-insensitive (RFC 4648 base16). */
const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Human-facing guidance printed when {@link assertRelayAuthConfigured} fails.
 *
 * SECRET-HANDLING: this message states only the REQUIREMENT (≥32 hex chars) and
 * how to mint one. It NEVER echoes the configured value, its length, or any
 * fragment derived from it — see {@link assertRelayAuthConfigured}.
 *
 * Note on encoding: the secret is hex (base16), not base32 — `generateTotp`
 * decodes it with `Buffer.from(secret, 'hex')`. A base32 string would be
 * silently mis-decoded and every TOTP code would fail to match, so the minting
 * command emits hex.
 */
export const RELAY_AUTH_SECRET_MISSING_MESSAGE = [
  '[ait-debugger] relay 키가 준비되지 않았습니다. relay 환경은 코드 인증이 필수입니다.',
  '데몬은 switch_environment의 projectRoot 인자로 받은 프로젝트의 relay 키를 key agent(메모리)에서 받아옵니다. switch_environment를 projectRoot와 함께 다시 호출하세요.',
  '예전 .ait_relay 파일이나 AIT_DEBUG_TOTP_SECRET(32자 이상 16진수, 예: openssl rand -hex 32)이 남아 있으면 첫 호출 때 자동으로 가져온 뒤 파일을 삭제합니다.',
  '키는 기본 24시간(최대 72시간) 뒤 만료됩니다. 만료나 key agent 재시작 뒤에는 디버그 번들을 다시 빌드해 업로드하세요.',
  '자세히: docs MCP(ait-docs)의 searchDocumentation으로 "relay auth totp" 조회.',
].join('\n');

/**
 * Whether `secret` is a well-formed relay-auth TOTP secret: a hex string of at
 * least {@link MIN_SECRET_HEX_CHARS} characters with an even length (an odd
 * length would have its trailing nibble silently dropped by `Buffer.from(...,
 * 'hex')`, weakening the key without warning).
 *
 * Pure predicate so callers can test the validation independently of the
 * fail-fast side effect in {@link assertRelayAuthConfigured}.
 *
 * SECRET-HANDLING: returns only a boolean — the input value is never returned,
 * logged, or echoed.
 */
export function isValidRelayAuthSecret(secret: string | undefined): secret is string {
  if (secret === undefined || secret === '') return false;
  if (secret.length < MIN_SECRET_HEX_CHARS) return false;
  if (secret.length % 2 !== 0) return false;
  return HEX_RE.test(secret);
}

/**
 * Fail-fast guard enforcing that a relay-auth TOTP secret is configured before
 * a public-internet-exposed relay is booted (issue #250).
 *
 * Relay-auth (the §4 Layer C TOTP gate) is the only fail-fast layer that closes
 * the real gap: a leaked `wss://…trycloudflare.com` URL otherwise lets a third
 * party attach a debugger to a dog-food/live mini-app. Without a secret the relay
 * comes up unauthenticated, so this guard is called at the relay-boot site
 * (`bootRelayFamily`, the intoss relay). Local-only sessions never boot a relay
 * and so never reach this guard, matching the issue's exemption for non-relay
 * debugging.
 *
 * Throws when the secret is unset, empty, too short, or not a valid hex string.
 * The thrown message is the bin entry's fatal stderr (see `cli.ts` `main().catch`)
 * — the daemon refuses to come up rather than booting an unauthenticated relay.
 *
 * SECRET-HANDLING: the env value is read once, passed ONLY to the boolean
 * predicate, and never logged. The thrown message names the requirement, never
 * the value, its length, or any derived fragment.
 *
 * @param env - Environment to read from. Defaults to `process.env`; injectable
 *   for tests so they never mutate the real process environment.
 */
export function assertRelayAuthConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!isRelayRootLive() && !isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    throw new Error(RELAY_AUTH_SECRET_MISSING_MESSAGE);
  }
}

/** The step counter a code minted at `when` belongs to. Equal counters mean equal codes. */
export function relayCodeStep(when: number = Date.now()): number {
  return Math.max(0, Math.floor(when / 1000 / TIME_STEP));
}

/**
 * Gate-specific past skew for the relay WebSocket upgrade TOTP check. Tuning
 * knob, together with {@link RELAY_CODE_STEP_SECONDS}.
 *
 * Rationale (why 24: a code is good for 120 to 125 seconds, no longer):
 *   - Each step is {@link RELAY_CODE_STEP_SECONDS} (5 s), so 24 past steps =
 *     120-125 s of backwards acceptance. A code is valid from the moment it is
 *     minted until 25 step boundaries later, so it is guaranteed usable for
 *     at least 120 s after it was minted and never for more than 125 s.
 *   - The window must cover the cold start of the mini-app after a scan (about
 *     20 s measured on a device) AND the person reading the consent dialog:
 *     debugger-client 0.3.2 sends nothing to the relay before "연결" is tapped,
 *     so the consent time counts against the code. 30 s proved too short on a
 *     real device; 120 s leaves room to read the dialog.
 *   - A longer window is acceptable because the link is signed (`sig` + `arc`),
 *     the person approves the connection on the phone, and the attach window
 *     is claimed by the first device, so a second device with the same code is
 *     refused.
 *   - The code is checked when the phone requests `target.js` and again at the
 *     WebSocket upgrade, both a few seconds apart and after the app has
 *     cold-loaded. Time that counts against the window is therefore the
 *     scan-to-request gap plus the app's cold start, not the time the QR sat on
 *     the desktop: the dashboard re-pushes the QR every
 *     {@link RELAY_QR_REFRESH_INTERVAL_MS} (5 s) and `start_attach` re-mints
 *     at the same pace (one new code per step), so a QR on screen is at most
 *     5 s old and still has at least 115 s left when it is scanned.
 *   - A static terminal QR (headless path) cannot be refreshed, so it has the
 *     120-125 s from the moment it printed; the tool result says to scan it
 *     right away. `start_attach` sends a new text QR whenever the code changes.
 *   - Once a phone has attached, its code is bound to that session (see
 *     `chii-relay.ts`): a reload or a reconnect after lock/unlock keeps working
 *     with the aged code for the bound target, so this window only has to cover
 *     the first scan, not the whole debugging session.
 *   - Online guessing is bounded separately by the failure backoff in
 *     relay-auth-throttle.ts, and the code is 128 bits, so a wider or
 *     narrower window changes the exposure of a leaked URL (how long it works),
 *     not the odds of a blind guess.
 *
 * `verifyTotp`'s own default (skew=1) is a generic default and is not used by
 * the relay gate, which always passes this value.
 */
export const RELAY_VERIFY_SKEW_STEPS = 24;

/** Longest a freshly minted code stays accepted (it is minted at the very start of a step). */
export const RELAY_CODE_MAX_AGE_SECONDS = (RELAY_VERIFY_SKEW_STEPS + 1) * TIME_STEP;

/** Shortest a freshly minted code stays accepted (it is minted at the very end of a step). */
export const RELAY_CODE_MIN_AGE_SECONDS = RELAY_VERIFY_SKEW_STEPS * TIME_STEP;

/**
 * How often the daemon re-pushes the attach QR to an open dashboard and re-mints
 * the link during `start_attach`. A shown QR is never older than this plus the
 * rest of its step, so it keeps at least
 * `RELAY_CODE_MIN_AGE_SECONDS - RELAY_QR_REFRESH_INTERVAL_MS / 1000` seconds.
 */
export const RELAY_QR_REFRESH_INTERVAL_MS = 5_000;

/**
 * Future steps the relay gate accepts: none.
 *
 * Clock skew between devices does not apply here. Every code the relay checks
 * is minted by the daemon (or by a process on the same host) and only checked
 * by the relay on that same host and clock. The phone never computes a code, it
 * carries one it was handed, so a code can be old when it arrives but never
 * ahead of the host clock. Accepting only T-1..T gives 2 valid codes instead of
 * 3 (or 5 with two future steps).
 *
 * The phone-side gate in `@apps-in-toss/debugger-client` may run its own
 * `verifyTotpCode` on the device clock; that is a separate fail-fast check and
 * the relay stays authoritative.
 */
export const RELAY_VERIFY_FUTURE_SKEW_STEPS = 0;

/**
 * Builds the `verifyAuth` predicate for the Chii relay's HTTP and WebSocket
 * upgrade gate. `AIT_DEBUG_TOTP_SECRET` (the relay secret) must be configured:
 * without it the predicate rejects every request. Codes are
 * checked against this process's in-memory code key ({@link mintRelayCode}),
 * not against the relay secret; `codeSecret` overrides that key for tests.
 *
 * The predicate checks the `at` query parameter against the current step and
 * the {@link RELAY_VERIFY_SKEW_STEPS} before it (no future steps, see
 * {@link RELAY_VERIFY_FUTURE_SKEW_STEPS}), using {@link verifyTotp}. This gives the issued code a validity of 30 to 35 s,
 * enough for the QR-scan → attach flow including an app cold load, given the
 * QR is re-minted every {@link RELAY_QR_REFRESH_INTERVAL_MS} while `start_attach`
 * waits.
 *
 * Fail-closed: when the env var is not set the predicate rejects everything.
 * There is no relay without a code check. Since issue #250 the secret is also
 * MANDATORY at every relay-boot site (enforced by
 * {@link assertRelayAuthConfigured} BEFORE the relay starts), so this is a
 * second line of defence.
 *
 * Lives here (not in the MCP server) so the unplugin's relay can wire the same
 * gate without importing the heavy MCP server module graph.
 *
 * SECRET-HANDLING: The code key is captured in a closure and
 * is NEVER written to any log, error message, or process output.
 */
export function buildRelayVerifyAuth(
  env: NodeJS.ProcessEnv = process.env,
  codeSecret: string = relayCodeSecret(),
): (req: import('node:http').IncomingMessage) => boolean {
  // The relay secret is the switch; the codes themselves use the process key.
  if (!env.AIT_DEBUG_TOTP_SECRET && !isRelayRootLive()) return () => false;
  const secret = codeSecret;

  return (req) => {
    // Parse the `at` query param from the upgrade request URL.
    // req.url is the raw request path + query, e.g. `/client/id?target=…&at=<code>`
    const rawUrl = req.url ?? '';
    const qIndex = rawUrl.indexOf('?');
    const queryStr = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
    const params = new URLSearchParams(queryStr);
    const code = params.get('at') ?? '';

    // Do NOT log `code`, `secret`, or any derived value here.
    // 30-35 s backwards acceptance, no future steps.
    return verifyTotp(
      secret,
      code,
      undefined,
      RELAY_VERIFY_SKEW_STEPS,
      RELAY_VERIFY_FUTURE_SKEW_STEPS,
    );
  };
}
