/**
 * The key operations, as a caller sees them. Two implementations: the agent
 * client (`./client.ts`) and an in-process store ({@link LocalKeyProvider}) for
 * fallback mode and for tests.
 */

import type { RelayCertJson } from '@apps-in-toss/internal-protocol/relay-signature';
import type { KeyStore } from './key-store.js';
import type { AgentStatus, KeyInfo } from './protocol.js';

export interface SignCertRequest {
  readonly sessionPublicKey: string;
  /** Validity, unix seconds. */
  readonly nb: number;
  readonly na: number;
  /** The root key the caller expects; a different key is an error. */
  readonly publicKey?: string | undefined;
}

export interface KeyProvider {
  readonly kind: 'agent' | 'memory';
  status(): Promise<AgentStatus>;
  getOrCreate(projectId: string): Promise<KeyInfo>;
  importLegacy(projectId: string, secret: string): Promise<KeyInfo & { created: boolean }>;
  rotate(projectId: string): Promise<KeyInfo>;
  signSessionCert(projectId: string, request: SignCertRequest): Promise<RelayCertJson>;
}

/** A provider over an in-process {@link KeyStore}. */
export class LocalKeyProvider implements KeyProvider {
  readonly kind = 'memory' as const;
  constructor(readonly store: KeyStore) {}
  async status(): Promise<AgentStatus> {
    return this.store.status(process.pid);
  }
  async getOrCreate(projectId: string): Promise<KeyInfo> {
    return this.store.getOrCreate(projectId);
  }
  async importLegacy(projectId: string, secret: string): Promise<KeyInfo & { created: boolean }> {
    return this.store.importLegacy(projectId, secret);
  }
  async rotate(projectId: string): Promise<KeyInfo> {
    return this.store.rotate(projectId);
  }
  async signSessionCert(projectId: string, request: SignCertRequest): Promise<RelayCertJson> {
    return this.store.signSessionCert(projectId, request);
  }
}
