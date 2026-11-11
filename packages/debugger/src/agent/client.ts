/**
 * Client of the relay key agent: one connection per request, framed JSON (see
 * `./protocol.ts`), the auth token read from the user-private token file.
 *
 * SECRET-HANDLING: `importLegacy` sends a legacy secret to the agent over the
 * private socket; the client never logs a request or a response body, and
 * errors carry fixed texts.
 */

import { createConnection } from 'node:net';
import type { RelayCertJson } from '@apps-in-toss/internal-protocol/relay-signature';
import type { AgentPaths } from './paths.js';
import {
  AGENT_PROTOCOL_VERSION,
  AgentError,
  type AgentErrorCode,
  type AgentStatus,
  encodeFrame,
  FrameReader,
  type KeyInfo,
} from './protocol.js';
import type { KeyProvider, SignCertRequest } from './provider.js';
import { readAgentToken } from './secure-dir.js';

export const DEFAULT_CLIENT_TIMEOUT_MS = 5_000;

/** The agent cannot be reached (not running, no token, timeout). */
export class AgentUnavailableError extends Error {
  constructor(reason: string) {
    super(`key agent unavailable: ${reason}`);
    this.name = 'AgentUnavailableError';
  }
}

export interface AgentClientOptions {
  readonly timeoutMs?: number;
  /** Token source; defaults to the token file of `paths`. */
  readonly readToken?: () => string | undefined;
}

/** Sends one request and returns the response body without the envelope. */
function exchange(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    const socket = createConnection(endpoint);
    const reader = new FrameReader();
    socket.setTimeout(timeoutMs, () => done(() => reject(new AgentUnavailableError('timeout'))));
    socket.on('error', (error: NodeJS.ErrnoException) =>
      done(() => reject(new AgentUnavailableError(error.code ?? 'connection error'))),
    );
    socket.on('connect', () => {
      try {
        socket.write(encodeFrame({ v: AGENT_PROTOCOL_VERSION, ...body }));
      } catch (error) {
        done(() => reject(error));
      }
    });
    socket.on('data', (chunk: Buffer) => {
      let frame: unknown;
      try {
        frame = reader.push(chunk);
      } catch {
        return done(() => reject(new AgentUnavailableError('invalid response')));
      }
      if (frame === undefined) return;
      done(() => {
        if (typeof frame !== 'object' || frame === null) {
          return reject(new AgentUnavailableError('invalid response'));
        }
        const record = frame as Record<string, unknown>;
        if (record.ok === true) {
          const { v: _v, ok: _ok, ...rest } = record;
          return resolve(rest);
        }
        reject(
          new AgentError(
            (typeof record.code === 'string' ? record.code : 'internal') as AgentErrorCode,
            typeof record.message === 'string' ? record.message : 'request failed',
          ),
        );
      });
    });
    socket.on('close', () => done(() => reject(new AgentUnavailableError('connection closed'))));
  });
}

export class AgentClient implements KeyProvider {
  readonly kind = 'agent' as const;
  private readonly timeoutMs: number;
  private readonly readToken: () => string | undefined;

  constructor(
    private readonly paths: AgentPaths,
    options: AgentClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS;
    this.readToken = options.readToken ?? (() => readAgentToken(paths.tokenPath));
  }

  private async call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      const token = this.readToken();
      if (token === undefined) throw new AgentUnavailableError('no token');
      try {
        return await exchange(this.paths.endpoint, { token, ...body }, this.timeoutMs);
      } catch (error) {
        // A restarted agent has a new token; read it once more.
        if (attempt === 0 && error instanceof AgentError && error.code === 'unauthorized') continue;
        throw error;
      }
    }
  }

  async status(): Promise<AgentStatus> {
    return (await this.call({ op: 'status' })) as unknown as AgentStatus;
  }
  async getOrCreate(projectId: string): Promise<KeyInfo> {
    return (await this.call({ op: 'getOrCreate', projectId })) as unknown as KeyInfo;
  }
  async importLegacy(projectId: string, secret: string): Promise<KeyInfo & { created: boolean }> {
    return (await this.call({ op: 'importLegacy', projectId, secret })) as unknown as KeyInfo & {
      created: boolean;
    };
  }
  async rotate(projectId: string): Promise<KeyInfo> {
    return (await this.call({ op: 'rotate', projectId })) as unknown as KeyInfo;
  }
  async signSessionCert(projectId: string, request: SignCertRequest): Promise<RelayCertJson> {
    const result = await this.call({
      op: 'signSessionCert',
      projectId,
      sessionPublicKey: request.sessionPublicKey,
      nb: request.nb,
      na: request.na,
      ...(request.publicKey === undefined ? {} : { publicKey: request.publicKey }),
    });
    return result.cert as RelayCertJson;
  }
}
