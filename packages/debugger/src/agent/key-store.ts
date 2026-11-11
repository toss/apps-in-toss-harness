/**
 * In-memory store of relay root keys, one set per project id.
 *
 * The key agent (`./server.ts`) keeps one of these for its whole life; the
 * daemon keeps one for itself when no agent can be reached (fallback mode, see
 * `../mcp/relay-root.ts`). Nothing here touches a file, the environment or a log.
 *
 * Lifetime: a key lives {@link DEFAULT_KEY_TTL_HOURS} hours from creation or
 * import (`AIT_DEBUG_RELAY_KEY_TTL_HOURS`, at most {@link MAX_KEY_TTL_HOURS}).
 * After its `notAfter` it never signs again and is dropped.
 *
 * A project can hold a few keys at once (the newest is the primary): importing a
 * legacy secret next to a freshly created key keeps bundles built with either
 * attachable until their TTL.
 *
 * SECRET-HANDLING: private keys stay inside {@link RootKey} closures; only public
 * keys and certificates are returned.
 */

import {
  isRelayPublicKey,
  RELAY_CERT_MAX_LIFETIME_SECONDS,
  type RelayCertJson,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { isValidRelayAuthSecret } from '../mcp/totp.js';
import { AgentError, type AgentStatus, type KeyInfo, type PublicKeyInfo } from './protocol.js';
import { createRootKey, deriveRootKey, type RootKey } from './root-key.js';

export const DEFAULT_KEY_TTL_HOURS = 24;
export const MAX_KEY_TTL_HOURS = 72;

/** Most projects and most keys per project one store holds. */
export const MAX_PROJECTS = 64;
export const MAX_KEYS_PER_PROJECT = 4;

const PROJECT_ID_RE = /^[0-9a-f]{16,64}$/;

/** Reads `AIT_DEBUG_RELAY_KEY_TTL_HOURS`: default 24, at most 72, never zero or negative. */
export function resolveKeyTtlMs(env: NodeJS.ProcessEnv): number {
  const raw = env.AIT_DEBUG_RELAY_KEY_TTL_HOURS;
  let hours = DEFAULT_KEY_TTL_HOURS;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) hours = Math.min(parsed, MAX_KEY_TTL_HOURS);
  }
  return Math.round(hours * 3_600_000);
}

interface Entry {
  readonly key: RootKey;
  readonly createdAtMs: number;
  readonly notAfterMs: number;
}

export interface KeyStoreOptions {
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_RE.test(value);
}

export class KeyStore {
  private readonly projects = new Map<string, Entry[]>();
  /** Public keys that expired here (public data), so a late request gets `expired`, not `no-key`. */
  private readonly expired = new Set<string>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  readonly startedAt: number;

  constructor(options: KeyStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_KEY_TTL_HOURS * 3_600_000;
    this.startedAt = this.now();
  }

  /** Drops expired keys; returns how many live keys remain. */
  purgeExpired(): number {
    const nowMs = this.now();
    let live = 0;
    for (const [id, entries] of this.projects) {
      const kept = entries.filter((e) => e.notAfterMs > nowMs);
      for (const e of entries) {
        if (e.notAfterMs > nowMs) continue;
        this.expired.add(e.key.publicKey);
        if (this.expired.size > 256)
          this.expired.delete(this.expired.values().next().value as string);
      }
      if (kept.length === 0) this.projects.delete(id);
      else this.projects.set(id, kept);
      live += kept.length;
    }
    return live;
  }

  liveKeyCount(): number {
    return this.purgeExpired();
  }

  status(pid: number): AgentStatus {
    const keys = this.purgeExpired();
    return {
      pid,
      startedAt: Math.floor(this.startedAt / 1000),
      projects: this.projects.size,
      keys,
    };
  }

  private live(projectId: string): Entry[] {
    this.purgeExpired();
    return this.projects.get(projectId) ?? [];
  }

  private info(projectId: string): KeyInfo {
    // Newest first.
    const entries = [...this.live(projectId)].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const keys: PublicKeyInfo[] = entries.map((e) => ({
      publicKey: e.key.publicKey,
      notAfter: Math.floor(e.notAfterMs / 1000),
    }));
    const primary = keys[0];
    if (primary === undefined) throw new AgentError('no-key', 'no live key');
    return { publicKey: primary.publicKey, notAfter: primary.notAfter, keys };
  }

  private add(projectId: string, key: RootKey): void {
    const existing = this.projects.get(projectId);
    if (existing === undefined && this.projects.size >= MAX_PROJECTS) {
      throw new AgentError('limit', 'too many projects');
    }
    const createdAtMs = this.now();
    const entries = [
      ...(existing ?? []),
      { key, createdAtMs, notAfterMs: createdAtMs + this.ttlMs },
    ]
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, MAX_KEYS_PER_PROJECT);
    this.projects.set(projectId, entries);
  }

  private checkId(projectId: unknown): asserts projectId is string {
    if (!isProjectId(projectId)) throw new AgentError('bad-request', 'invalid project id');
  }

  /** The project's primary key, created when it has none live. */
  getOrCreate(projectId: string): KeyInfo {
    this.checkId(projectId);
    if (this.live(projectId).length === 0) this.add(projectId, createRootKey());
    return this.info(projectId);
  }

  /**
   * Imports a legacy relay secret as a root key. The key it derives is the one a
   * 0.3.1 bundle pins. Importing a secret whose key the project already holds
   * changes nothing (`created: false`, the TTL is not extended).
   */
  importLegacy(projectId: string, secretHex: string): KeyInfo & { created: boolean } {
    this.checkId(projectId);
    if (!isValidRelayAuthSecret(secretHex)) throw new AgentError('bad-request', 'invalid secret');
    const key = deriveRootKey(secretHex);
    const known = this.live(projectId).some((e) => e.key.publicKey === key.publicKey);
    if (!known) this.add(projectId, key);
    return { ...this.info(projectId), created: !known, ...this.pick(projectId, key.publicKey) };
  }

  /** The info for one key as the top-level fields (the key an import produced). */
  private pick(projectId: string, publicKey: string): PublicKeyInfo {
    const entry = this.live(projectId).find((e) => e.key.publicKey === publicKey);
    if (entry === undefined) throw new AgentError('no-key', 'no live key');
    return { publicKey, notAfter: Math.floor(entry.notAfterMs / 1000) };
  }

  /** Drops every key of the project and makes a new one. */
  rotate(projectId: string): KeyInfo {
    this.checkId(projectId);
    this.projects.delete(projectId);
    return this.getOrCreate(projectId);
  }

  /**
   * Certifies a session key. The root private key never leaves the store.
   *
   * @param request.publicKey - The root key the caller expects. A different or
   *   missing key (the agent restarted, the key expired) is an error, never a
   *   silent switch to another key.
   */
  signSessionCert(
    projectId: string,
    request: { sessionPublicKey: string; nb: number; na: number; publicKey?: string | undefined },
  ): RelayCertJson {
    this.checkId(projectId);
    const { sessionPublicKey, nb, na } = request;
    if (!isRelayPublicKey(sessionPublicKey)) {
      throw new AgentError('bad-request', 'invalid session key');
    }
    if (!Number.isSafeInteger(nb) || !Number.isSafeInteger(na) || na <= nb) {
      throw new AgentError('bad-request', 'invalid validity');
    }
    if (na - nb > RELAY_CERT_MAX_LIFETIME_SECONDS) {
      throw new AgentError('bad-request', 'validity too long');
    }
    const nowSeconds = Math.floor(this.now() / 1000);
    if (Math.abs(nb - nowSeconds) > 3600)
      throw new AgentError('bad-request', 'validity not current');

    const entries = this.live(projectId);
    const wanted = request.publicKey;
    const sorted = [...entries].sort((a, b) => b.createdAtMs - a.createdAtMs);
    const entry = wanted === undefined ? sorted[0] : sorted.find((e) => e.key.publicKey === wanted);
    if (entry === undefined) {
      if (wanted !== undefined && this.expired.has(wanted)) {
        throw new AgentError('expired', 'key expired');
      }
      throw new AgentError(
        entries.length === 0 ? 'no-key' : 'key-mismatch',
        'no matching live key',
      );
    }
    const notAfter = Math.floor(entry.notAfterMs / 1000);
    if (notAfter <= nowSeconds) throw new AgentError('expired', 'key expired');
    // A certificate never outlives its root key.
    const cappedNa = Math.min(na, notAfter);
    if (cappedNa <= nb) throw new AgentError('expired', 'key expired');
    return entry.key.signCert(sessionPublicKey, nb, cappedNa);
  }
}
