/**
 * How long the relay root key still lives, and what the daemon says about it.
 *
 * The key is volatile: the key agent (or the daemon, in fallback mode) holds it
 * in memory and drops it at `notAfter` (24 hours by default, at most 72). There
 * is no file and no date to look up; the expiry is part of the key's public
 * data, and a bundle pins the same `notAfter`.
 *
 * Status: `ok` while more than {@link RELAY_KEY_WARN_MINUTES} minutes remain,
 * `aging` below that, `expired` at or after `notAfter`.
 */

/** Minutes before `notAfter` at which the daemon starts to warn. */
export const RELAY_KEY_WARN_MINUTES = 120;

export type RelayKeyAgeStatus = 'ok' | 'aging' | 'expired';

export interface RelayKeyAge {
  readonly status: RelayKeyAgeStatus;
  /** Minutes until `notAfter` (never negative). */
  readonly remainingMinutes: number;
  /** ISO time the key expires. */
  readonly notAfter: string;
  /** Where the key lives. */
  readonly holder: 'agent' | 'memory';
}

/** Judges a key that expires at `notAfter` (unix seconds). */
export function judgeRelayKeyAge(
  notAfter: number,
  holder: 'agent' | 'memory',
  nowMs: number = Date.now(),
): RelayKeyAge {
  const remainingMs = notAfter * 1000 - nowMs;
  const remainingMinutes = Math.max(0, Math.floor(remainingMs / 60_000));
  const status: RelayKeyAgeStatus =
    remainingMs <= 0 ? 'expired' : remainingMinutes < RELAY_KEY_WARN_MINUTES ? 'aging' : 'ok';
  return { status, remainingMinutes, notAfter: new Date(notAfter * 1000).toISOString(), holder };
}

/** What to do about an expired or lost key; the same words for the log, the error and `get_status`. */
export const RELAY_KEY_REBUILD_STEPS = '디버그 번들을 다시 빌드해 업로드하세요.';

const MEMORY_NOTE =
  ' key agent에 연결하지 못해 이 데몬의 메모리에 키를 두고 있습니다. 데몬을 재시작하면 키가 바뀌므로 그때도 번들을 다시 빌드해야 합니다.';

/** One-line hint for a key that needs attention, or `null` when it does not. */
export function relayKeyHint(age: RelayKeyAge): string | null {
  const memory = age.holder === 'memory' ? MEMORY_NOTE : '';
  if (age.status === 'expired') {
    return `relay 키가 만료됐습니다. switch_environment로 relay를 다시 시작하고 ${RELAY_KEY_REBUILD_STEPS} 번들에 박힌 이전 공개 키로는 attach되지 않습니다.${memory}`;
  }
  if (age.status === 'aging') {
    return `relay 키가 ${age.remainingMinutes}분 뒤 만료됩니다(${age.notAfter}). 만료 뒤에는 ${RELAY_KEY_REBUILD_STEPS}${memory}`;
  }
  return age.holder === 'memory' ? memory.trim() : null;
}

/** The error raised when the key an operation needs is expired or gone (agent restarted). */
export class RelayKeyExpiredError extends Error {
  constructor(detail?: string) {
    super(
      `[@apps-in-toss/debugger] relay 키가 만료됐거나 key agent가 재시작돼 사라졌습니다${
        detail === undefined ? '' : ` (${detail})`
      }. ${RELAY_KEY_REBUILD_STEPS} 번들은 이전 공개 키를 박고 있어 새 키로는 attach되지 않습니다.`,
    );
    this.name = 'RelayKeyExpiredError';
  }
}
