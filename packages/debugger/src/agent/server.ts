/**
 * The relay key agent server: a small resident Node process holding relay root
 * signing keys in memory only (see `./key-store.ts`), reachable over a Unix
 * socket or a Windows named pipe (see `./paths.ts`).
 *
 * No network listener, no OS integration (no launchd, systemd, registry, keychain)
 * and no reads of user folders. Requests need the per-agent token (see
 * `./token.ts`) and a matching protocol version. The root private key never
 * leaves the process: callers get public keys and certificates.
 *
 * Idle exit: with no live key and no request for {@link DEFAULT_IDLE_EXIT_MS}
 * the agent calls `onIdle` (the entry then exits).
 *
 * SECRET-HANDLING: request and response bodies are never logged; error replies
 * carry fixed texts.
 */

import { createServer, type Server, type Socket } from 'node:net';
import type { KeyStore } from './key-store.js';
import {
  AGENT_PROTOCOL_VERSION,
  AgentError,
  type AgentErrorCode,
  type AgentRequest,
  encodeFrame,
  FrameReader,
} from './protocol.js';
import { tokensEqual } from './token.js';

export const DEFAULT_IDLE_EXIT_MS = 5 * 60_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_CONNECTIONS = 32;

export interface KeyAgentServerOptions {
  readonly store: KeyStore;
  readonly token: string;
  /** Socket path or pipe name. */
  readonly endpoint: string;
  readonly now?: () => number;
  readonly pid?: number;
  readonly idleExitMs?: number;
  readonly idleCheckMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxConnections?: number;
  /** Called once when the agent has been idle long enough. */
  readonly onIdle?: () => void;
}

export interface KeyAgentServer {
  readonly server: Server;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function reply(socket: Socket, body: Record<string, unknown>): void {
  try {
    socket.end(encodeFrame({ v: AGENT_PROTOCOL_VERSION, ...body }));
  } catch {
    socket.destroy();
  }
}

function fail(socket: Socket, code: AgentErrorCode, message: string): void {
  reply(socket, { ok: false, code, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createKeyAgentServer(options: KeyAgentServerOptions): KeyAgentServer {
  const { store, token, endpoint } = options;
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const idleExitMs = options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS;
  const idleCheckMs =
    options.idleCheckMs ?? Math.max(50, Math.min(30_000, Math.floor(idleExitMs / 4)));
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  let lastActivity = now();
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let idleFired = false;

  function dispatch(request: Record<string, unknown>): Record<string, unknown> {
    const op = request.op;
    switch (op) {
      case 'status':
        return { ...store.status(pid) };
      case 'getOrCreate':
        return { ...store.getOrCreate(request.projectId as string) };
      case 'importLegacy':
        return { ...store.importLegacy(request.projectId as string, request.secret as string) };
      case 'rotate':
        return { ...store.rotate(request.projectId as string) };
      case 'signSessionCert': {
        const cert = store.signSessionCert(request.projectId as string, {
          sessionPublicKey: request.sessionPublicKey as string,
          nb: request.nb as number,
          na: request.na as number,
          publicKey: typeof request.publicKey === 'string' ? request.publicKey : undefined,
        });
        return { cert };
      }
      default:
        throw new AgentError('unknown-op', 'unknown operation');
    }
  }

  function handle(socket: Socket, raw: unknown): void {
    if (!isRecord(raw)) {
      fail(socket, 'bad-request', 'request must be an object');
      return;
    }
    if (raw.v !== AGENT_PROTOCOL_VERSION) {
      fail(socket, 'unsupported-version', 'unsupported protocol version');
      return;
    }
    if (!tokensEqual(token, raw.token)) {
      fail(socket, 'unauthorized', 'unauthorized');
      return;
    }
    lastActivity = now();
    try {
      reply(socket, { ok: true, ...dispatch(raw) });
    } catch (error) {
      if (error instanceof AgentError) fail(socket, error.code, error.message);
      else fail(socket, 'internal', 'internal error');
    }
  }

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const reader = new FrameReader();
    socket.setTimeout(requestTimeoutMs, () => socket.destroy());
    let handled = false;
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: Buffer) => {
      if (handled) return;
      let frame: unknown;
      try {
        frame = reader.push(chunk);
      } catch (error) {
        handled = true;
        const code = error instanceof AgentError ? error.code : 'bad-request';
        fail(socket, code, 'invalid frame');
        return;
      }
      if (frame === undefined) return;
      handled = true;
      handle(socket, frame);
    });
  });

  server.maxConnections = maxConnections;

  function startIdleTimer(): void {
    idleTimer = setInterval(() => {
      const live = store.liveKeyCount();
      if (live > 0) return;
      if (now() - lastActivity < idleExitMs) return;
      if (idleFired) return;
      idleFired = true;
      options.onIdle?.();
    }, idleCheckMs);
    // The listening server keeps the process alive; the timer must not.
    idleTimer.unref();
  }

  return {
    server,
    listen() {
      return new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(endpoint, () => {
          server.off('error', reject);
          startIdleTimer();
          resolve();
        });
      });
    },
    close() {
      if (idleTimer !== null) clearInterval(idleTimer);
      idleTimer = null;
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}

export type { AgentRequest };
