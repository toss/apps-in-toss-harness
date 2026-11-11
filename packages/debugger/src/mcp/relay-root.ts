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
 * {@link prepareProjectKeys} resolves the project, imports and destroys legacy
 * `.ait_relay` secrets (see `relay-legacy.ts`) and returns the project's keys.
 * {@link activateRelayRoot} adds the daemon part: it installs the root as the
 * certifier of session keys (`relay-signing.ts`) and keeps a fresh session key
 * on a timer.
 *
 * SECRET-HANDLING: only public keys and expiries leave this module; nothing here
 * logs a secret.
 */

import { type AgentClient, AgentUnavailableError } from '../agent/client.js';
import { KeyStore, resolveKeyTtlMs } from '../agent/key-store.js';
import { ensureAgent } from '../agent/launcher.js';
import { AgentError, type KeyInfo } from '../agent/protocol.js';
import { type KeyProvider, LocalKeyProvider } from '../agent/provider.js';
import { relayCodeSecret } from './relay-code-secret.js';
import {
  judgeRelayKeyAge,
  RELAY_KEY_REBUILD_STEPS,
  type RelayKeyAge,
  RelayKeyExpiredError,
} from './relay-key-age.js';
import { type LegacyReport, migrateLegacyRelaySecrets } from './relay-legacy.js';
import { type ProjectInfo, resolveProject } from './relay-project.js';
import {
  activeRelayRoot,
  isRelayRootLive,
  type RootCertSigner,
  refreshRelaySession,
  setRelayRoot,
} from './relay-signing.js';

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
  /** Project directory; the nearest package.json directory at or above it is used. */
  readonly projectRoot: string;
  /** Fail instead of falling back to an in-process key (build helper, CLI). */
  readonly requireAgent: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (message: string) => void;
  /** Test seams. */
  readonly provider?: KeyProvider;
  readonly ensureAgent?: () => Promise<AgentClient>;
  readonly project?: ProjectInfo;
  readonly migrate?: typeof migrateLegacyRelaySecrets;
}

export interface ProjectKeys {
  readonly project: ProjectInfo;
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

/** Resolves the project, runs the legacy migration and returns its keys. */
export async function prepareProjectKeys(options: PrepareKeysOptions): Promise<ProjectKeys> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((m: string) => void process.stderr.write(m));
  const project = options.project ?? resolveProject(options.projectRoot);

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

  const legacy = await (options.migrate ?? migrateLegacyRelaySecrets)({
    projectId: project.id,
    dirs: project.legacyDirs,
    provider,
    destroy: holder === 'agent',
    env,
    log,
  });
  const keys = await provider.getOrCreate(project.id);
  return { project, provider, holder, keys, legacy };
}

// ---------------------------------------------------------------------------
// Daemon activation
// ---------------------------------------------------------------------------

export interface ActivationReport {
  readonly projectId: string;
  readonly publicKey: string;
  readonly notAfter: number;
  readonly holder: 'agent' | 'memory';
  /** The key differs from the one this daemon used before (bundles must be rebuilt). */
  readonly changed: boolean;
  readonly legacy: readonly LegacyReport[];
}

function certifierFor(provider: KeyProvider, projectId: string, keys: KeyInfo): RootCertSigner {
  return {
    publicKey: keys.publicKey,
    notAfter: keys.notAfter,
    async certify(sessionPublicKey, nb, na) {
      try {
        return await provider.signSessionCert(projectId, {
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

export interface ActivateOptions extends Omit<PrepareKeysOptions, 'requireAgent' | 'projectRoot'> {
  readonly projectRoot?: string | undefined;
  readonly onKeyAge?: (age: RelayKeyAge) => void;
  readonly now?: () => number;
}

/**
 * Daemon entry: makes the project's root key the certifier of session keys and
 * gets a first session key. Throws {@link RelayKeyExpiredError} when the root
 * cannot sign.
 */
export async function activateRelayRoot(options: ActivateOptions = {}): Promise<ActivationReport> {
  const log = options.log ?? ((m: string) => void process.stderr.write(m));
  const now = options.now ?? Date.now;
  const previous = activeRelayRoot();
  const prepared = await prepareProjectKeys({
    ...options,
    projectRoot: options.projectRoot ?? process.cwd(),
    requireAgent: false,
    log,
  });
  const { keys, provider, project, holder } = prepared;
  setRelayRoot(certifierFor(provider, project.id, keys));
  await refreshRelaySession(now());
  startSessionRefresher(log);

  const age = judgeRelayKeyAge(keys.notAfter, holder, now());
  try {
    options.onKeyAge?.(age);
  } catch {
    // Observability is best-effort.
  }
  const changed = previous !== null && previous.publicKey !== keys.publicKey;
  if (changed) {
    log(
      `[@apps-in-toss/debugger] relay 키가 새로 만들어졌습니다. ${RELAY_KEY_REBUILD_STEPS} 이전 번들은 이전 공개 키를 박고 있어 attach되지 않습니다.\n`,
    );
  }
  return {
    projectId: project.id,
    publicKey: keys.publicKey,
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
