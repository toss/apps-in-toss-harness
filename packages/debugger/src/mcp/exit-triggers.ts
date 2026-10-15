/**
 * Exit triggers for the stdio MCP daemon.
 *
 * The daemon must not outlive the MCP client that spawned it. A leftover daemon
 * keeps `~/.ait-devtools/server.lock`, so the client's next reconnect fails
 * with `CONNECTION_CLOSED`. This module wires every way the client can go away
 * to one idempotent shutdown:
 *
 *   - SIGINT / SIGTERM / SIGHUP,
 *   - stdin `end` / `close` (the client closed the pipe),
 *   - the MCP server's `onclose` (the stdio transport closed),
 *   - a parent-death watchdog (`startParentWatcher`, `kill(ppid, 0)`).
 *
 * Every trigger awaits the graceful shutdown and then EXITS the process. The
 * old signal handlers only ran the shutdown and relied on the event loop
 * draining, which it never does while stdin or an open dashboard SSE socket
 * keeps it alive.
 *
 * `AIT_DEBUG_NO_PARENT_WATCH=1` disables the client-gone triggers (stdin,
 * transport close, parent watchdog); signals always stay on.
 *
 * Node-only, react-free.
 */

import { startParentWatcher } from './parent-watcher.js';

export interface ExitTriggerOptions {
  /** Graceful shutdown (idempotent). Resolves once teardown has run. */
  shutdown: () => Promise<void>;
  /** The MCP server; its `onclose` is set to trigger the shutdown. */
  server?: { onclose?: () => void };
  /** Default `process.stdin`. */
  stdin?: Pick<NodeJS.EventEmitter, 'once'>;
  /** Default `process` (signal registration). */
  proc?: { once(signal: NodeJS.Signals, listener: () => void): unknown };
  /** Default `process.exit`. */
  exit?: (code: number) => void;
  /** Default: `process.env.AIT_DEBUG_NO_PARENT_WATCH !== '1'`. */
  watchClient?: boolean;
  /** Passed to `startParentWatcher` (interval, injected ppid/liveness for tests). */
  parentWatcher?: Parameters<typeof startParentWatcher>[1];
  log?: (msg: string) => void;
}

export function installExitTriggers(opts: ExitTriggerOptions): { stop(): void } {
  const {
    shutdown,
    stdin = process.stdin,
    proc = process,
    exit = (code: number) => process.exit(code),
    watchClient = process.env.AIT_DEBUG_NO_PARENT_WATCH !== '1',
    log = (msg: string) => process.stderr.write(msg),
  } = opts;

  let fired = false;
  const trigger = (reason: string): void => {
    if (fired) return;
    fired = true;
    log(`[ait-debug] ${reason} — 종료합니다\n`);
    void shutdown().then(
      () => exit(0),
      () => exit(1),
    );
  };

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    proc.once(sig, () => trigger(sig));
  }

  let watcher: { stop(): void } | null = null;
  if (watchClient) {
    if (opts.server) opts.server.onclose = () => trigger('MCP 전송 채널이 닫힘');
    stdin.once('end', () => trigger('stdin이 끝남'));
    stdin.once('close', () => trigger('stdin이 닫힘'));
    watcher = startParentWatcher(() => trigger('부모 프로세스가 사라짐'), {
      intervalMs: 5_000,
      ...opts.parentWatcher,
    });
  }

  return {
    stop() {
      watcher?.stop();
    },
  };
}
