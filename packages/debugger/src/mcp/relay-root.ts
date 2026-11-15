/**
 * Where the relay root key comes from, for the daemon, the build helper and the
 * `relay-key` command.
 *
 * All relay key material is volatile. The root signing key lives in memory in the
 * key agent (`../agent`), started on demand; nothing is written to a file or to
 * the environment. When the agent cannot be started or reached (sandbox,
 * read-only home, CI) the daemon falls back to a key in its own memory for its
 * lifetime and says that debug bundles must be rebuilt after a daemon restart.
 *
 * Scope: one key per key agent, that is one per user account on a machine. Every
 * project, worktree and debugger session of the user signs with it, so a debug
 * bundle built in any folder attaches to any debugger session of the same user.
 * The key stops a relay that is not the developer's (a bundle pins its public
 * key and checks the relay's signature); another person or another machine has
 * another agent and so another key. Telling apps apart is not the key's job:
 * the relay checks the app origin and accepts one mini-app (close 4409).
 * 0.4.2 and earlier asked the agent for a key per project id; the agent protocol
 * is unchanged and those versions keep working next to this one with their own
 * keys (their bundles do not attach here, so they are rebuilt once).
 *
 * {@link prepareRelayKeys} removes legacy `.ait_relay` secrets of the given
 * project folder (see `relay-legacy.ts`, they are not imported) and returns the
 * machine key. {@link activateRelayRoot} adds the daemon part: it installs the
 * root as the certifier of session keys (`relay-signing.ts`) and keeps a fresh
 * session key on a timer.
 *
 * SECRET-HANDLING: only public keys and expiries leave this module; nothing here
 * logs a secret.
 */

import { createHash } from 'node:crypto';
import { type AgentClient, AgentUnavailableError } from '../agent/client.js';
import { KeyStore, resolveKeyTtlMs } from '../agent/key-store.js';
import { ensureAgent } from '../agent/launcher.js';
import { AgentError, type KeyInfo } from '../agent/protocol.js';
import { type KeyProvider, LocalKeyProvider } from '../agent/provider.js';
import { keyFingerprint } from './key-fingerprint.js';
import { relayCodeSecret } from './relay-code-secret.js';
import {
  judgeRelayKeyAge,
  RELAY_KEY_REBUILD_STEPS,
  type RelayKeyAge,
  RelayKeyExpiredError,
} from './relay-key-age.js';
import { type LegacyReport, retireLegacyRelaySecrets } from './relay-legacy.js';
import { resolveProject } from './relay-project.js';
import {
  activeRelayRoot,
  isRelayRootLive,
  type RootCertSigner,
  refreshRelaySession,
  setRelayRoot,
} from './relay-signing.js';

/**
 * The id under which the key agent holds this machine's relay key. Fixed, not a
 * secret (the agent is private to the user already); it only has to differ from
 * the per-project ids 0.4.2 and earlier use in the same agent, and it fits the
 * agent's id format (16 to 64 hex characters).
 */
export const MACHINE_KEY_ID = createHash('sha256')
  .update('ait-relay-machine-v1')
  .digest('hex')
  .slice(0, 32);

/** How often the daemon checks that a fresh session key is available. */
export const SESSION_REFRESH_INTERVAL_MS = 30_000;

const FALLBACK_NOTICE =
  '[@apps-in-toss/debugger] key agent에 연결하지 못해 이 데몬의 메모리에 relay 키를 둡니다. 데몬을 재시작하면 키가 새로 만들어지므로, 재시작한 뒤에는 디버그 번들을 다시 빌드해 업로드하세요.\n';

/** The process-wide fallback store (one key set for the daemon's lifetime). */
let fallbackProvider: LocalKeyProvider | null = null;

export function getFallbackProvider(env: NodeJS.ProcessEnv = process.env): LocalKeyProvider {
  if (fallbackProvider === null) {
    fallbackProvider = new LocalKeyProvider(new KeyStore({ ttlMs: resolveKeyTtlMs(env) }));
  }
  return fallbackProvider;
}

/** Forgets the fallback store and the active root. For tests. */
export function resetRelayRootState(): void {
  fallbackProvider = null;
  stopSessionRefresher();
  setRelayRoot(null);
}

export interface PrepareKeysOptions {
  /**
   * A project folder to clear of legacy `.ait_relay` files (the nearest package.json
   * directory at or above it, and its twins in other git worktrees). It does not choose
   * the key: every folder gets the same machine key. Omitted: no folder is checked.
   */
  readonly projectRoot?: string | undefined;
  /** Fail instead of falling back to an in-process key (build helper, CLI). */
  readonly requireAgent: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (message: string) => void;
  /** Test seams. */
  readonly provider?: KeyProvider;
  readonly ensureAgent?: () => Promise<AgentClient>;
  readonly legacyDirs?: readonly string[];
  readonly retire?: typeof retireLegacyRelaySecrets;
}

export interface RelayKeys {
  readonly provider: KeyProvider;
  readonly holder: 'agent' | 'memory';
  readonly keys: KeyInfo;
  readonly legacy: readonly LegacyReport[];
}

/** Thrown when a build helper or the CLI needs the agent and cannot get it. */
export class KeyAgentRequiredError extends Error {
  constructor() {
    super(
      '[@apps-in-toss/debugger] key agent에 연결하지 못했습니다. 홈 디렉터리가 읽기 전용이거나 샌드박스·CI 환경일 수 있습니다. ' +
        '`npx debugger key-agent`를 직접 실행할 수 있는 환경에서 다시 시도하거나 AIT_DEBUGGER_KEY_AGENT_DIR로 쓰기 가능한 디렉터리를 지정하세요.',
    );
    this.name = 'KeyAgentRequiredError';
  }
}

function agentDisabled(env: NodeJS.ProcessEnv): boolean {
  return env.AIT_DEBUGGER_KEY_AGENT === 'off';
}

/** Removes legacy secrets of `projectRoot` (if given) and returns this machine's relay key. */
export async function prepareRelayKeys(options: PrepareKeysOptions): Promise<RelayKeys> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((m: string) => void process.stderr.write(m));

  let provider: KeyProvider | undefined = options.provider;
  if (provider === undefined) {
    if (options.ensureAgent !== undefined || !agentDisabled(env)) {
      try {
        provider = await (options.ensureAgent ?? (() => ensureAgent({ env })))();
      } catch (error) {
        if (!(error instanceof AgentUnavailableError)) throw error;
      }
    }
    if (provider === undefined) {
      if (options.requireAgent) throw new KeyAgentRequiredError();
      provider = getFallbackProvider(env);
      log(FALLBACK_NOTICE);
    }
  }
  const holder = provider.kind === 'agent' ? 'agent' : 'memory';

  const dirs =
    options.legacyDirs ??
    (options.projectRoot === undefined ? [] : resolveProject(options.projectRoot).legacyDirs);
  const legacy = await (options.retire ?? retireLegacyRelaySecrets)({ dirs, env, log });
  const keys = await provider.getOrCreate(MACHINE_KEY_ID);
  return { provider, holder, keys, legacy };
}

// ---------------------------------------------------------------------------
// Daemon activation
// ---------------------------------------------------------------------------

export interface ActivationReport {
  readonly publicKey: string;
  /** {@link keyFingerprint} of `publicKey`. */
  readonly keyFingerprint: string;
  readonly notAfter: number;
  readonly holder: 'agent' | 'memory';
  /** The key differs from the one this daemon used before (bundles must be rebuilt). */
  readonly changed: boolean;
  readonly legacy: readonly LegacyReport[];
}

function certifierFor(provider: KeyProvider, keys: KeyInfo): RootCertSigner {
  return {
    publicKey: keys.publicKey,
    notAfter: keys.notAfter,
    async certify(sessionPublicKey, nb, na) {
      try {
        return await provider.signSessionCert(MACHINE_KEY_ID, {
          sessionPublicKey,
          nb,
          na,
          publicKey: keys.publicKey,
        });
      } catch (error) {
        if (error instanceof AgentError) {
          if (
            error.code === 'expired' ||
            error.code === 'no-key' ||
            error.code === 'key-mismatch'
          ) {
            throw new RelayKeyExpiredError(error.code);
          }
          throw new Error(
            `[@apps-in-toss/debugger] key agent가 서명을 거부했습니다(${error.code}).`,
          );
        }
        throw new Error(
          `[@apps-in-toss/debugger] key agent에 연결하지 못해 relay 키로 서명할 수 없습니다. ${RELAY_KEY_REBUILD_STEPS}`,
        );
      }
    },
  };
}

let refresher: ReturnType<typeof setInterval> | null = null;

export function stopSessionRefresher(): void {
  if (refresher !== null) clearInterval(refresher);
  refresher = null;
}

function startSessionRefresher(log: (message: string) => void): void {
  stopSessionRefresher();
  let lastError = '';
  refresher = setInterval(() => {
    refreshRelaySession().then(
      () => {
        lastError = '';
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : 'relay 세션 키 갱신 실패';
        if (message === lastError) return;
        lastError = message;
        log(`${message}\n`);
      },
    );
  }, SESSION_REFRESH_INTERVAL_MS);
  refresher.unref();
}

export interface ActivateOptions extends Omit<PrepareKeysOptions, 'requireAgent'> {
  readonly onKeyAge?: (age: RelayKeyAge) => void;
  readonly now?: () => number;
}

/**
 * Daemon entry: makes this machine's root key the certifier of session keys and
 * gets a first session key. Throws {@link RelayKeyExpiredError} when the root
 * cannot sign.
 */
export async function activateRelayRoot(options: ActivateOptions = {}): Promise<ActivationReport> {
  const log = options.log ?? ((m: string) => void process.stderr.write(m));
  const now = options.now ?? Date.now;
  const previous = activeRelayRoot();
  const prepared = await prepareRelayKeys({
    ...options,
    projectRoot: options.projectRoot ?? process.cwd(),
    requireAgent: false,
    log,
  });
  const { keys, provider, holder } = prepared;
  const fingerprint = keyFingerprint(keys.publicKey);
  setRelayRoot(certifierFor(provider, keys));
  await refreshRelaySession(now());
  startSessionRefresher(log);

  const age = { ...judgeRelayKeyAge(keys.notAfter, holder, now()), keyFingerprint: fingerprint };
  try {
    options.onKeyAge?.(age);
  } catch {
    // Observability is best-effort.
  }
  const changed = previous !== null && previous.publicKey !== keys.publicKey;
  if (changed) {
    log(
      `[@apps-in-toss/debugger] relay 키가 바뀌었습니다(지문 ${fingerprint}). ${RELAY_KEY_REBUILD_STEPS} 이전 번들은 이전 공개 키를 박고 있어 attach되지 않습니다.\n`,
    );
  }
  return {
    publicKey: keys.publicKey,
    keyFingerprint: fingerprint,
    notAfter: keys.notAfter,
    holder,
    changed,
    legacy: prepared.legacy,
  };
}

/**
 * The value callers pass where a "relay secret" used to be: a non-empty string
 * while a live root is active (the switch for code auth, link signing and run
 * ids), `undefined` otherwise. It is this process's random `at`-code key, not
 * derived from the root key and not persisted.
 */
export function relayAuthSwitch(nowMs: number = Date.now()): string | undefined {
  return isRelayRootLive(nowMs) ? relayCodeSecret() : undefined;
}
