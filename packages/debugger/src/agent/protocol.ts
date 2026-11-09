/**
 * Wire protocol of the relay key agent.
 *
 * One request and one response per connection, each a frame: a 4-byte big-endian
 * length followed by that many bytes of UTF-8 JSON. Every request carries the
 * protocol version `v` and the agent's auth token. The token only authorizes a
 * request; it is not key material.
 *
 *   request  { v: 1, token, op, ...params }
 *   response { v: 1, ok: true, ...result } | { v: 1, ok: false, code, message }
 *
 * Operations:
 *   status        -> { pid, startedAt, projects, keys }
 *   getOrCreate   { projectId }                        -> KeyInfo
 *   importLegacy  { projectId, secret }                -> KeyInfo & { created }
 *   rotate        { projectId }                        -> KeyInfo
 *   signSessionCert { projectId, sessionPublicKey, nb, na, publicKey? } -> { cert }
 *
 * SECRET-HANDLING: requests can carry a legacy secret (`importLegacy`); neither
 * side logs a request or a response body.
 */

import type { RelayCertJson } from '@apps-in-toss/internal-protocol/relay-signature';

export const AGENT_PROTOCOL_VERSION = 1;

/** Largest frame (request or response) either side accepts. */
export const AGENT_MAX_FRAME_BYTES = 16 * 1024;

/** `notAfter` is unix seconds. */
export interface PublicKeyInfo {
  readonly publicKey: string;
  readonly notAfter: number;
}

/** The primary key of a project and every live key it has (primary first). */
export interface KeyInfo extends PublicKeyInfo {
  readonly keys: readonly PublicKeyInfo[];
}

export type AgentErrorCode =
  | 'bad-request'
  | 'unauthorized'
  | 'too-large'
  | 'unsupported-version'
  | 'unknown-op'
  | 'no-key'
  | 'expired'
  | 'key-mismatch'
  | 'limit'
  | 'internal';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

export interface AgentStatus {
  readonly pid: number;
  readonly startedAt: number;
  readonly projects: number;
  readonly keys: number;
}

export type AgentRequest =
  | { op: 'status' }
  | { op: 'getOrCreate'; projectId: string }
  | { op: 'importLegacy'; projectId: string; secret: string }
  | { op: 'rotate'; projectId: string }
  | {
      op: 'signSessionCert';
      projectId: string;
      sessionPublicKey: string;
      nb: number;
      na: number;
      publicKey?: string;
    };

export interface SignedCert {
  readonly cert: RelayCertJson;
}

/** Encodes one frame. Throws when the payload exceeds the limit. */
export function encodeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > AGENT_MAX_FRAME_BYTES) throw new AgentError('too-large', 'frame too large');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Accumulates socket data into frames. `push` returns the parsed JSON of a
 * complete frame, or `undefined` while more bytes are needed. Throws an
 * {@link AgentError} for an oversized or malformed frame.
 */
export class FrameReader {
  private chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): unknown | undefined {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size < 4) return undefined;
    const all = Buffer.concat(this.chunks);
    this.chunks = [all];
    const length = all.readUInt32BE(0);
    if (length > AGENT_MAX_FRAME_BYTES) throw new AgentError('too-large', 'frame too large');
    if (all.length < 4 + length) return undefined;
    try {
      return JSON.parse(all.subarray(4, 4 + length).toString('utf8')) as unknown;
    } catch {
      throw new AgentError('bad-request', 'frame is not JSON');
    }
  }
}
