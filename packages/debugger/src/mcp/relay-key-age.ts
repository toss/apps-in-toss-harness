/**
 * How old the relay key is, and what the daemon does about it.
 *
 * `.ait_relay` holds the long-lived relay secret. The auth code and the signing
 * key are both derived from it, so a leaked copy stays useful until the file is
 * replaced. The file has no room for a date (other tools write and read it as
 * a bare hex string), so the creation time lives in a small sidecar next to it,
 * `.ait_relay.meta`:
 *
 *   {"v":1,"createdAt":"<ISO time>","keyId":"<16 hex>"}
 *
 * `keyId` ties the date to one secret: a different `.ait_relay` (replaced by
 * hand, or by another tool) makes the sidecar not apply, and the age then falls
 * back to the secret file's modification time. A project that has only the bare
 * file (every file written before this existed) gets the modification time too.
 *
 * Policy: older than {@link RELAY_KEY_WARN_DAYS} days the daemon warns; older
 * than {@link RELAY_KEY_REFUSE_DAYS} days it does not start the relay at all (so
 * nothing is signed or accepted under that key) and says how to rotate. An age
 * that cannot be determined is treated as fine: no policy on a guess.
 *
 * SECRET-HANDLING: the key id is a truncated, domain-separated hash of a 256-bit
 * random secret: it identifies the secret without helping to recover it. The
 * secret itself never leaves the caller; nothing here logs.
 */

import { createHash } from 'node:crypto';

/** Sidecar file name, next to `.ait_relay`. */
export const RELAY_KEY_META_FILE_NAME = '.ait_relay.meta';

/** Age in days after which the daemon warns. */
export const RELAY_KEY_WARN_DAYS = 21;

/** Age in days after which the daemon refuses to start the relay. */
export const RELAY_KEY_REFUSE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_ID_DOMAIN = 'ait-relay-key-id-v1\n';
const KEY_ID_RE = /^[0-9a-f]{16}$/;

export type RelayKeyAgeStatus = 'ok' | 'aging' | 'expired';

export interface RelayKeyAge {
  readonly status: RelayKeyAgeStatus;
  /** Whole days since creation (never negative). */
  readonly ageDays: number;
  /** ISO time the key counts as created. */
  readonly createdAt: string;
  /** Where the date came from: the sidecar, or the secret file's modification time. */
  readonly source: 'meta' | 'mtime';
}

/** Identifier of one secret: 16 hex characters of a domain-separated SHA-256. */
export function relayKeyId(secretHex: string): string {
  return createHash('sha256')
    .update(KEY_ID_DOMAIN)
    .update(Buffer.from(secretHex, 'hex'))
    .digest('hex')
    .slice(0, 16);
}

/** The sidecar text for a secret created at `createdAtMs`. */
export function serializeRelayKeyMeta(secretHex: string, createdAtMs: number): string {
  return `${JSON.stringify({
    v: 1,
    createdAt: new Date(createdAtMs).toISOString(),
    keyId: relayKeyId(secretHex),
  })}\n`;
}

/** Parses sidecar text; `null` for anything that is not a well-formed v1 record. */
export function parseRelayKeyMeta(text: string): { createdAtMs: number; keyId: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.createdAt !== 'string' || typeof record.keyId !== 'string') return null;
  const createdAtMs = Date.parse(record.createdAt);
  if (!Number.isFinite(createdAtMs) || !KEY_ID_RE.test(record.keyId)) return null;
  return { createdAtMs, keyId: record.keyId };
}

export interface RelayKeyAgeInput {
  readonly secretHex: string;
  /** Sidecar text, when the file exists and could be read. */
  readonly metaText?: string | undefined;
  /** Modification time of the secret file in ms, when known. */
  readonly mtimeMs?: number | undefined;
  readonly nowMs: number;
}

/**
 * Judges the age of a key, or returns `null` when no date is available at all.
 * A sidecar that is for another secret, or that dates the key in the future,
 * does not count.
 */
export function judgeRelayKeyAge(input: RelayKeyAgeInput): RelayKeyAge | null {
  const { secretHex, metaText, mtimeMs, nowMs } = input;
  let createdAtMs: number | undefined;
  let source: 'meta' | 'mtime' = 'mtime';
  if (metaText !== undefined) {
    const meta = parseRelayKeyMeta(metaText);
    if (
      meta !== null &&
      meta.keyId === relayKeyId(secretHex) &&
      meta.createdAtMs <= nowMs + DAY_MS
    ) {
      createdAtMs = meta.createdAtMs;
      source = 'meta';
    }
  }
  if (createdAtMs === undefined && mtimeMs !== undefined && Number.isFinite(mtimeMs)) {
    createdAtMs = mtimeMs;
  }
  if (createdAtMs === undefined) return null;
  const ageDays = Math.max(0, Math.floor((nowMs - createdAtMs) / DAY_MS));
  const status: RelayKeyAgeStatus =
    ageDays >= RELAY_KEY_REFUSE_DAYS ? 'expired' : ageDays >= RELAY_KEY_WARN_DAYS ? 'aging' : 'ok';
  return { status, ageDays, createdAt: new Date(createdAtMs).toISOString(), source };
}

/** What to do about it; the same words for the log, the error and `get_debug_status`. */
export const RELAY_KEY_ROTATE_STEPS =
  '`npx debugger relay-key --rotate`로 키를 새로 만들고, 출력된 공개 키를 번들의 relayPublicKeys 배열에 추가한 뒤 번들을 다시 빌드하세요. 이전 테스트 번들이 남아 있는 동안은 이전 공개 키도 배열에 둡니다.';

/** One-line hint for a key that needs attention, or `null` when it does not. */
export function relayKeyHint(age: RelayKeyAge): string | null {
  if (age.status === 'ok') return null;
  if (age.status === 'aging') {
    return `relay 키가 ${age.ageDays}일 지났습니다(${RELAY_KEY_WARN_DAYS}일 넘으면 경고, ${RELAY_KEY_REFUSE_DAYS}일 넘으면 relay를 시작하지 않습니다). ${RELAY_KEY_ROTATE_STEPS}`;
  }
  return `relay 키가 ${age.ageDays}일 지나 relay를 시작하지 않습니다(${RELAY_KEY_REFUSE_DAYS}일 한도). ${RELAY_KEY_ROTATE_STEPS}`;
}

/** The error the daemon stops with for an expired key. */
export class RelayKeyExpiredError extends Error {
  readonly age: RelayKeyAge;
  constructor(age: RelayKeyAge) {
    super(`[@apps-in-toss/debugger] ${relayKeyHint(age) ?? 'relay 키가 만료됐습니다.'}`);
    this.name = 'RelayKeyExpiredError';
    this.age = age;
  }
}
