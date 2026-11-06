/**
 * cloudflared quick tunnel + attach banner for the debug-mode MCP server.
 *
 * On spawn, the debug server opens an accountless `*.trycloudflare.com` quick
 * tunnel to the local Chii relay so the phone can attach over a public wss URL,
 * then prints a short stderr notice. The notice never carries the relay URL,
 * the tunnel host, or a QR of them: the person gets the scannable attach QR
 * from the dashboard or the `start_attach` tool, which splice the live TOTP
 * code in at call time.
 *
 * Tunnel health probe (`TunnelHealthProbe`):
 *   After the tunnel is up, a periodic HTTP HEAD probe hits the tunnel's
 *   `https://` URL every `probeIntervalMs` (default 60 s). Two consecutive
 *   failures trigger a reissue attempt (spawn a new cloudflared quick tunnel
 *   and redirect traffic). After `MAX_REISSUE_ATTEMPTS` (3) consecutive
 *   reissue failures, the probe gives up and marks the tunnel permanently
 *   dropped — `tunnelStatus.up` becomes false with `droppedAt` set. The caller
 *   should surface this to the agent so the user knows to restart the server.
 *
 * SECRET-HANDLING: The TOTP secret and computed code values MUST NOT appear
 * in any output from this module.
 *
 * Node-only: spawns the cloudflared binary and writes to stdout/stderr.
 */

import { randomBytes } from 'node:crypto';
import { bin, Tunnel } from 'cloudflared';
import { withoutRelaySecretEnv } from './child-env.js';
import { ensureVerifiedCloudflaredBin } from './cloudflared-binary.js';
import { redactRelayText } from './relay-redact.js';
import { RESTART_CMD } from './restart-hint.js';
import type { TunnelStatus } from './tools.js';

/** Generates a 32-byte hex attach token shown as a pairing hint (relay-side validation is a later phase). */
export function generateAttachToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Matches the public URL cloudflared prints for an unauthenticated quick
 * tunnel. Ported from the deleted `@apps-in-toss/devtools`'s
 * `src/unplugin/tunnel.ts` (harness#79, C4 devtools removal) alongside the
 * rest of the `startQuickTunnel` hardening below (#421) — this relay path
 * already had a `url` event from the `cloudflared` lib, but the timeout +
 * stderr-diagnostics behavior ported from devtools scans raw output too.
 */
const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Extract the `https://<sub>.trycloudflare.com` URL from a line of cloudflared
 * output, or `null` if the line doesn't contain one. Pulled out as a pure
 * function so it can be unit-tested without spawning anything.
 */
export function parseTrycloudflareUrl(line: string): string | null {
  const m = line.match(TRYCLOUDFLARE_RE);
  return m ? m[0] : null;
}

/**
 * Sanitize cloudflared stderr output for error diagnostics (#421, ported from
 * devtools' `src/unplugin/tunnel.ts` alongside {@link parseTrycloudflareUrl}).
 *
 * Masks `*.trycloudflare.com` hostnames and full `https://` / `wss://` URLs
 * that carry those hostnames so tunnel host values never appear in error
 * messages. Diagnostic content (error codes, reasons, JSON blobs) is preserved.
 *
 * SECRET-HANDLING: tunnel host is SECRET-class per harness policy — only
 * placeholder text is emitted.
 */
export function sanitizeCloudflaredOutput(line: string): string {
  // Full URL forms: https://xxx.trycloudflare.com/… and wss://xxx.trycloudflare.com/…
  let s = line.replace(/(?:https?|wss?):\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/[^\s]*)*/gi, (m) =>
    m.replace(/[a-z0-9-]+\.trycloudflare\.com/i, '<HOST>.trycloudflare.com'),
  );
  // Bare hostname without scheme (e.g. printed in cloudflared JSON logs)
  s = s.replace(/[a-z0-9-]+\.trycloudflare\.com/gi, '<HOST>.trycloudflare.com');
  return s;
}

/**
 * How long {@link startQuickTunnel} waits for cloudflared to report a public
 * URL before giving up (#421, ported from devtools' `src/unplugin/tunnel.ts`).
 * A cloudflared process that never reports a URL (dead network, blocked
 * egress) used to hang the caller forever — this bounds the wait and rejects
 * with a friendly manual fallback plus a sanitized stderr tail.
 */
const URL_TIMEOUT_MS = 20_000;

export interface QuickTunnel {
  /** Public `https://*.trycloudflare.com` URL the tunnel exposes. */
  url: string;
  /** Same host as `wss://` — the relay endpoint the phone attaches to. */
  wssUrl: string;
  /**
   * PID of the cloudflared child process. Present once the tunnel is up.
   * Safe to surface in diagnostics (plain integer — not a secret).
   */
  childPid?: number;
  /**
   * Register a callback to be invoked when the cloudflared child exits
   * unexpectedly (i.e. NOT due to our own `stop()` call). The caller
   * (`startTunnelHealthProbe`) uses this to immediately trigger reissue
   * without waiting for the next probe interval.
   *
   * Only one callback can be registered at a time; calling this again
   * replaces the previous one.
   */
  onUnexpectedExit(cb: (code: number | null) => void): void;
  stop(): void;
}

/**
 * Ensures the pinned, sha256-verified cloudflared binary is at `bin` (downloads on first run).
 * The `cloudflared` package's own installer follows `latest` with no checksum, so the version
 * and hashes are pinned in `cloudflared-binary.ts` and any other executable at `bin` (for
 * example the one npm's postinstall fetched) is replaced. pnpm consumers need no `allowBuilds`
 * config: pnpm's `ignore-scripts` default blocks the package's postinstall and this lazy path
 * provisions the binary. On failure (offline / firewall / hash mismatch) the error points at the
 * README troubleshooting section instead of surfacing the raw error alone.
 */
async function ensureCloudflaredBin(): Promise<void> {
  try {
    await ensureVerifiedCloudflaredBin(bin);
  } catch (err) {
    throw new Error(
      `[@apps-in-toss/debugger] cloudflared binary download or verification failed: ${
        err instanceof Error ? err.message : String(err)
      }. See README "Troubleshooting → cloudflared binary not installed" for pnpm allowBuilds / pre-cache options.`,
      { cause: err },
    );
  }
}

/**
 * Opens a cloudflared quick tunnel to the local relay port and resolves once
 * the public URL is assigned.
 *
 * FIX 1 (issue #571): after URL resolution the returned `QuickTunnel` object
 * watches the cloudflared child process for unexpected exits and calls any
 * registered `onUnexpectedExit` callback so the health probe can immediately
 * trigger reissue instead of waiting for the next poll interval.
 *
 * #421 (ported from devtools' `src/unplugin/tunnel.ts`, harness#79): rejects
 * with a friendly manual-command fallback if no URL appears within
 * {@link URL_TIMEOUT_MS}, and attaches a sanitized stderr tail (last ~15
 * lines, hostnames masked via {@link sanitizeCloudflaredOutput}) to both the
 * timeout error and a premature-exit error. This benefits the relay path
 * (env 3, `debug-server.ts`) that calls this function.
 */
export async function startQuickTunnel(localPort: number): Promise<QuickTunnel> {
  await ensureCloudflaredBin();

  // Origin uses `localhost`, not `127.0.0.1`: cloudflared is a Go binary, and
  // Go's dialer tries every resolved address of `localhost` (both v4 and v6)
  // before giving up, so this tolerates dev servers bound to either loopback
  // family — e.g. some `vite` setups bind only `[::1]` (IPv6).
  // cloudflared does not get the relay secret (the library spawns synchronously
  // with `process.env` and takes no env option).
  // `--no-autoupdate`: the binary is sha256-pinned and provisioned by
  // ensureVerifiedCloudflaredBin; cloudflared must not replace it at runtime.
  const tunnel = withoutRelaySecretEnv(() =>
    Tunnel.quick(`http://localhost:${localPort}`, { '--no-autoupdate': true }),
  );

  // #421: accumulate stderr so a timeout/premature-exit error can attach a
  // diagnostic tail. SECRET-HANDLING: lines are sanitized before inclusion in
  // any error message — the tunnel host must never leak.
  const stderrLines: string[] = [];
  const pushStderr = (line: string) => {
    stderrLines.push(line);
  };
  tunnel.on('stderr', pushStderr);

  /** Formats the last `n` sanitized stderr lines, or `''` if none were captured. */
  const stderrTail = (n = 15): string => {
    if (stderrLines.length === 0) return '';
    const tail = stderrLines.slice(-n).map(sanitizeCloudflaredOutput).join('');
    return `\ncloudflared 출력 (마지막 ${Math.min(n, stderrLines.length)}줄):\n${tail}`;
  };

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      // The cloudflared child is likely still alive (it just hasn't reported a
      // URL yet) — stop it so a timed-out tunnel doesn't leak an orphan process.
      try {
        tunnel.stop();
      } catch {
        // Ignore — the process may already be gone.
      }
      reject(
        new Error(
          `[@apps-in-toss/debugger] cloudflared did not report a tunnel URL within ${
            URL_TIMEOUT_MS / 1000
          }s. Check your network connection, or run \`cloudflared tunnel --url http://localhost:${localPort}\` manually.${stderrTail()}`,
        ),
      );
    }, URL_TIMEOUT_MS);
    const onUrl = (assigned: string) => {
      clearTimeout(timer);
      cleanup();
      resolve(assigned);
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      cleanup();
      reject(
        new Error(
          `[@apps-in-toss/debugger] cloudflared exited before assigning a URL (code ${code}).${stderrTail()}`,
        ),
      );
    };
    const cleanup = () => {
      tunnel.off('url', onUrl);
      tunnel.off('error', onError);
      tunnel.off('exit', onExit);
      tunnel.off('stderr', pushStderr);
    };
    tunnel.once('url', onUrl);
    tunnel.once('error', onError);
    tunnel.once('exit', onExit);
  });

  // FIX 1: watch for unexpected child death AFTER URL is resolved.
  // `intentionalStop` guards against triggering a reissue when we called stop() ourselves
  // (cloudflared exits on SIGINT from tunnel.stop(), which would otherwise look like a crash).
  let intentionalStop = false;
  let unexpectedExitCb: ((code: number | null) => void) | null = null;

  tunnel.once('exit', (code: number | null) => {
    if (!intentionalStop && unexpectedExitCb !== null) {
      unexpectedExitCb(code);
    }
  });

  return {
    url,
    wssUrl: url.replace(/^https/, 'wss'),
    childPid: (tunnel.process as { pid?: number } | null)?.pid,
    onUnexpectedExit(cb: (code: number | null) => void): void {
      unexpectedExitCb = cb;
    },
    stop(): void {
      intentionalStop = true;
      tunnel.stop();
    },
  };
}

export interface AttachBannerInput {
  /**
   * Whether TOTP auth is enabled on the relay (`AIT_DEBUG_TOTP_SECRET` is set).
   * Only changes the auth line of the notice.
   */
  totpEnabled: boolean;
}

/**
 * Renders a pure unicode half-block QR string for the given text.
 *
 * Uses `qrcode` (Node full lib) to get the raw bit matrix, then encodes every
 * two vertical modules into a single half-block character:
 *   - both dark  → `█`
 *   - top only   → `▀`
 *   - bottom only → `▄`
 *   - both light → ` ` (space)
 *
 * The output contains **zero ANSI escape codes**, so it renders correctly in
 * every surface (terminal, VS Code, JetBrains, web) and can be scanned by a
 * phone camera when shown verbatim in an agent response.
 *
 * Used by the `start_attach` MCP tool response (attach deep-link QR).
 */
export async function renderQr(text: string): Promise<string> {
  // Dynamic import mirrors the cloudflared/qrcode-terminal precedent: keeps the
  // dependency out of the module graph when the function is not called.
  const { default: QRCode } = await import('qrcode');
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size: number = qr.modules.size;
  const data: Uint8Array = qr.modules.data as Uint8Array;

  const isDark = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return data[y * size + x] === 1;
  };

  const QUIET = 1;
  const lines: string[] = [];
  for (let y = -QUIET; y < size + QUIET; y += 2) {
    let line = '';
    for (let x = -QUIET; x < size + QUIET; x++) {
      const top = isDark(x, y);
      const bot = isDark(x, y + 1);
      line += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Renders the attach notice as a string.
 *
 * Deliberately has no relay URL, tunnel host or QR: stderr is captured by
 * terminals, agent transcripts and CI logs, so the host stays out of it. The
 * attach QR (relay URL plus the live TOTP code) is shown by the dashboard and
 * returned by the `start_attach` tool instead.
 *
 * SECRET-HANDLING: no secret, TOTP code, relay URL or tunnel host is included.
 */
export function renderAttachBanner(input: AttachBannerInput): string {
  const authNote = input.totpEnabled
    ? '  auth:          TOTP enabled — attach URLs include a rotating code (at=).'
    : '  auth:          none (set AIT_DEBUG_TOTP_SECRET to enable TOTP).';

  return [
    '',
    'AIT debug — relay tunnel is up (host not shown)',
    '',
    authNote,
    '',
    '  Call start_attach, or open the dashboard, to get the attach QR and deep link.',
    '',
  ].join('\n');
}

/** Prints the attach banner to stderr (stdout is the MCP stdio channel). */
export async function printAttachBanner(input: AttachBannerInput): Promise<void> {
  const banner = renderAttachBanner(input);
  process.stderr.write(`${banner}\n`);
}

/* -------------------------------------------------------------------------- */
/* TunnelHealthProbe — periodic health check + auto-reissue                    */
/* -------------------------------------------------------------------------- */

/** Maximum consecutive reissue attempts before the probe gives up. */
export const MAX_REISSUE_ATTEMPTS = 3;

/**
 * HTTP statuses that mean the tunnel itself is gone even though something still
 * answers. When the connector behind a quick-tunnel hostname is down, the edge
 * answers for it with a Cloudflare error page (530, error 1033) or a bad-gateway
 * class status; the relay never produces these for its own `/` route, and
 * cloudflared itself answers 502 when it cannot reach the local relay. Ordinary
 * application statuses (404, 403, 401, 429 ...) mean a live relay behind a live
 * tunnel and stay "alive".
 *
 * Not observed against a live dead connector: the list rests on Cloudflare's
 * documented error statuses for tunnels, so it is kept short and exact.
 */
export const TUNNEL_DEAD_STATUSES: ReadonlySet<number> = new Set([502, 504, 530]);

/** Whether an HTTP status from a probe means the tunnel is down. */
export function isTunnelDeadStatus(status: number | undefined): boolean {
  return status !== undefined && TUNNEL_DEAD_STATUSES.has(status);
}

/**
 * Probes `https://` URL with an HTTP HEAD request.
 * Returns `true` when the tunnel answers with an application status, `false` on
 * network error, timeout, or a status that says the connector is gone (see
 * {@link TUNNEL_DEAD_STATUSES}).
 *
 * @param httpsUrl - The `https://` tunnel URL to probe.
 * @param timeoutMs - Abort timeout in ms. Default 10 000.
 * @param send - HTTPS request function. Tests inject one.
 */
export async function probeTunnel(
  httpsUrl: string,
  timeoutMs = 10_000,
  send?: typeof import('node:https').request,
): Promise<boolean> {
  const request = send ?? (await import('node:https')).default.request;
  return new Promise<boolean>((resolve) => {
    const url = new URL(httpsUrl);
    const timer = setTimeout(() => {
      req.destroy();
      resolve(false);
    }, timeoutMs);

    const req = request(
      { hostname: url.hostname, port: 443, path: url.pathname || '/', method: 'HEAD' },
      (_res) => {
        clearTimeout(timer);
        _res.resume(); // drain response body to free socket
        resolve(!isTunnelDeadStatus(_res.statusCode));
      },
    );
    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    req.end();
  });
}

/** Why a tunnel was replaced. */
export type TunnelReissueReason = 'drop' | 'rotation';

export interface TunnelHealthProbeOptions {
  /**
   * Interval in ms between health probes. Default 60 000 (60 s).
   * Use a smaller value in tests.
   */
  probeIntervalMs?: number;
  /**
   * How many consecutive probe failures to tolerate before triggering a
   * reissue. Default 2 (so one transient network hiccup is forgiven).
   */
  failuresBeforeReissue?: number;
  /**
   * Callback invoked after a successful reissue. The caller (debug-server)
   * uses this to update `tunnelStatus` and reprint the attach banner with the
   * new `wssUrl`. `reason` is `'rotation'` when the caller asked for the new
   * URL through `rotate()` and `'drop'` when the probe replaced a dead tunnel.
   */
  onReissue: (newTunnel: QuickTunnel, reason: TunnelReissueReason) => void;
  /**
   * Callback invoked when the probe permanently gives up (all reissue attempts
   * exhausted). The caller should mark `tunnelStatus.up = false` and surface
   * the error to the agent / user.
   */
  onPermanentDrop: (droppedAt: string) => void;
  /**
   * Optional stderr-compatible logger. Default `process.stderr.write`.
   * Injected in tests to avoid real I/O.
   */
  log?: (msg: string) => void;
  /**
   * Optional probe function override (for tests — avoids real HTTP requests).
   */
  probe?: (httpsUrl: string) => Promise<boolean>;
  /**
   * Optional tunnel spawner override (for tests — avoids real cloudflared).
   */
  spawnTunnel?: (localPort: number) => Promise<QuickTunnel>;
}

/**
 * Starts a periodic health probe for a cloudflared quick tunnel.
 *
 * Every `probeIntervalMs` the probe sends an HTTP HEAD request to the tunnel's
 * `https://` URL. When `failuresBeforeReissue` consecutive failures are
 * detected, it attempts to spawn a new tunnel (up to `MAX_REISSUE_ATTEMPTS`
 * times). On success the caller is notified via `onReissue`; on permanent
 * failure via `onPermanentDrop`.
 *
 * FIX 1 (issue #571): the probe also subscribes to each tunnel's
 * `onUnexpectedExit` callback to detect child death *immediately* instead of
 * waiting for the next probe interval (which could be 60 s away).
 *
 * @returns `stop` — call during server shutdown to clear the probe interval.
 *   `rotate` — replaces the live tunnel on request through the same path as a
 *   drop reissue (`onReissue` fires with reason `'rotation'`); resolves `false`
 *   when a swap is already running, the probe is stopped, or the spawn failed.
 */
export function startTunnelHealthProbe(
  initialTunnel: QuickTunnel,
  localPort: number,
  options: TunnelHealthProbeOptions,
): { stop(): void; rotate(): Promise<boolean> } {
  const {
    probeIntervalMs = 60_000,
    failuresBeforeReissue = 2,
    onReissue,
    onPermanentDrop,
    log = (msg: string) => process.stderr.write(msg),
    probe = probeTunnel,
    spawnTunnel = startQuickTunnel,
  } = options;

  let currentTunnel = initialTunnel;
  let consecutiveFailures = 0;
  let reissueAttempts = 0;
  let stopped = false;

  // One swap for both reasons: spawn the new tunnel, then stop the old one, so
  // a failed spawn leaves the old tunnel as it was.
  let swapping = false;
  const swapTunnel = async (): Promise<QuickTunnel> => {
    const newTunnel = await spawnTunnel(localPort);
    // Stop the old tunnel process to free system resources.
    try {
      currentTunnel.stop();
    } catch {
      // Ignore stop errors — the process may already be dead.
    }
    currentTunnel = newTunnel;
    consecutiveFailures = 0;
    // FIX 1: arm child-exit watcher on the newly spawned tunnel too.
    armChildExitWatch(newTunnel);
    return newTunnel;
  };

  // FIX 1: shared reissue-or-drop logic — called both from the periodic
  // interval (after failuresBeforeReissue consecutive probe misses) and from
  // the child-exit handler (immediately on unexpected process death).
  const doReissueOrDrop = async (): Promise<void> => {
    if (stopped || swapping) return;

    reissueAttempts += 1;
    if (reissueAttempts > MAX_REISSUE_ATTEMPTS) {
      // Already exhausted — do not log again.
      return;
    }

    log(
      `[ait-debug] tunnel drop detected — reissuing (attempt ${reissueAttempts}/${MAX_REISSUE_ATTEMPTS})\n`,
    );

    swapping = true;
    try {
      const newTunnel = await swapTunnel();
      log(
        '[ait-debug] tunnel reissued — new relay URL available via start_attach (host not shown)\n',
      );
      onReissue(newTunnel, 'drop');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(
        `[ait-debug] tunnel reissue attempt ${reissueAttempts} failed: ${redactRelayText(message)}\n`,
      );

      if (reissueAttempts >= MAX_REISSUE_ATTEMPTS) {
        clearInterval(handle);
        stopped = true;
        const droppedAt = new Date().toISOString();
        log(
          `[ait-debug] tunnel permanently dropped after ${MAX_REISSUE_ATTEMPTS} reissue attempts — ` +
            `restart the debug server to continue (${RESTART_CMD}).\n`,
        );
        onPermanentDrop(droppedAt);
      }
    } finally {
      swapping = false;
    }
  };

  // Replaces a live tunnel on request so the old URL stops answering. Unlike a
  // drop, a failed spawn does not count toward the permanent-drop limit: the old
  // tunnel is still up. Returns whether the URL changed.
  const rotate = async (): Promise<boolean> => {
    if (stopped || swapping) return false;
    swapping = true;
    log('[ait-debug] tunnel rotation requested — reissuing\n');
    try {
      const newTunnel = await swapTunnel();
      log(
        '[ait-debug] tunnel rotated — new relay URL available via start_attach (host not shown)\n',
      );
      onReissue(newTunnel, 'rotation');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[ait-debug] tunnel rotation failed: ${redactRelayText(message)}\n`);
      return false;
    } finally {
      swapping = false;
    }
  };

  // FIX 1: register exit watcher on a QuickTunnel so unexpected child death
  // immediately kicks off reissue without waiting for the probe interval.
  const armChildExitWatch = (t: QuickTunnel): void => {
    t.onUnexpectedExit((code) => {
      if (stopped) return;
      log(
        `[ait-debug] cloudflared child exited unexpectedly (code=${code}) — triggering immediate reissue\n`,
      );
      // Set failures to threshold so the next interval probe also sees a clean
      // state; the actual reissue happens immediately below.
      consecutiveFailures = failuresBeforeReissue;
      void doReissueOrDrop();
    });
  };

  // Arm the watcher on the initial tunnel.
  armChildExitWatch(initialTunnel);

  const handle = setInterval(() => {
    void (async () => {
      if (stopped) return;

      const httpsUrl = currentTunnel.url;
      const alive = await probe(httpsUrl);

      if (alive) {
        // Tunnel responded — reset failure counter.
        if (consecutiveFailures > 0) {
          log('[ait-debug] tunnel health probe: tunnel recovered\n');
        }
        consecutiveFailures = 0;
        reissueAttempts = 0;
        return;
      }

      consecutiveFailures += 1;
      log(
        `[ait-debug] tunnel health probe: failure ${consecutiveFailures}/${failuresBeforeReissue}\n`,
      );

      if (consecutiveFailures < failuresBeforeReissue) {
        // Tolerate transient failures — wait for the next interval.
        return;
      }

      // Threshold reached — attempt reissue.
      await doReissueOrDrop();
    })();
  }, probeIntervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
    rotate,
  };
}

/**
 * Builds a `TunnelStatus` snapshot that includes drop state.
 *
 * Convenience helper for callers (debug-server) that maintain a mutable
 * `tunnelStatus` object — keeps the shape construction in one place.
 */
export function makeTunnelStatus(
  up: boolean,
  wssUrl: string | null,
  droppedAt: string | null = null,
  reissueAttempts = 0,
): TunnelStatus {
  return { up, wssUrl, droppedAt, reissueAttempts };
}
