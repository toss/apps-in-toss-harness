/**
 * Masks credentials and personal numbers in text that came from the page.
 *
 * Applied to console messages, exceptions, network URLs and `get_page` before they
 * reach the agent: JWTs, `Bearer` tokens, the values of token-like query parameters,
 * resident registration numbers and card numbers (Luhn-checked). The result reports how
 * many of each were masked (`meta.redactions`). The developer turns it off with
 * `AIT_DEBUG_REDACT=off`.
 *
 * Limits: DOM, snapshots, screenshots and `run_script` results are not masked. This
 * reduces accidental exposure; it does not stop someone who is trying to extract data.
 *
 * SECRET-HANDLING: matched values are replaced, never counted by content or logged.
 */

export type RedactionKind = 'jwt' | 'bearer' | 'token-param' | 'rrn' | 'card';

export type RedactionStats = Partial<Record<RedactionKind, number>>;

export function isRedactionEnabled(): boolean {
  return process.env.AIT_DEBUG_REDACT?.trim().toLowerCase() !== 'off';
}

function bump(stats: RedactionStats | undefined, kind: RedactionKind): void {
  if (stats !== undefined) stats[kind] = (stats[kind] ?? 0) + 1;
}

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const TOKEN_PARAM =
  /([?&;])([^=&#\s;]*(?:token|secret|passw|auth|api[_-]?key|apikey|sess|signature|jwt|credential)[^=&#\s;]*)=([^&#\s"';]+)/gi;
const RRN = /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-?[1-4]\d{6}(?!\d)/g;
const CARD = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

/** Masks one string. Pass `stats` to count what was masked. */
export function redactText(text: string, stats?: RedactionStats): string {
  if (text === '') return text;
  let out = text.replace(JWT, () => {
    bump(stats, 'jwt');
    return '[REDACTED:jwt]';
  });
  out = out.replace(BEARER, (_m, scheme: string) => {
    bump(stats, 'bearer');
    return `${scheme} [REDACTED]`;
  });
  out = out.replace(TOKEN_PARAM, (_m, sep: string, name: string) => {
    bump(stats, 'token-param');
    return `${sep}${name}=[REDACTED]`;
  });
  out = out.replace(RRN, () => {
    bump(stats, 'rrn');
    return '[REDACTED:rrn]';
  });
  out = out.replace(CARD, (m) => {
    const digits = m.replace(/[ -]/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    bump(stats, 'card');
    return '[REDACTED:card]';
  });
  return out;
}

const MAX_DEPTH = 8;

/** Masks every string inside `value` (objects and arrays are copied, keys kept). */
export function redactDeep<T>(value: T, stats?: RedactionStats, depth = 0): T {
  if (typeof value === 'string') return redactText(value, stats) as unknown as T;
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, stats, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactDeep(v, stats, depth + 1);
  }
  return out as T;
}

/** Total number of masked values. */
export function totalRedactions(stats: RedactionStats): number {
  return Object.values(stats).reduce((a, b) => a + (b ?? 0), 0);
}
