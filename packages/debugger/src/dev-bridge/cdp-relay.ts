/**
 * env-2 CDP relay bootstrap for a dev server (issue #30).
 *
 * The dev-server plugin that wires on-device debugging (`@ait-co/devtools`'s
 * unplugin, `tunnel.cdp`) needs four things to happen, in this order, before a
 * phone can attach:
 *
 *   1. ensure a relay TOTP secret exists   (`ensureRelaySecret`)
 *   2. fail fast if it still is not set    (`assertRelayAuthConfigured`)
 *   3. build the upgrade-gate predicate    (`buildRelayVerifyAuth`)
 *   4. boot the relay behind that gate     (`startChiiRelay`)
 *
 * The order is load-bearing, not stylistic. Step 1 mints-and-injects on first
 * run, so steps 2–3 read a value that only exists because step 1 ran; step 3
 * captures the secret in a closure, so a relay booted before it would be
 * ungated on a public tunnel — precisely the hole the relay-auth baseline
 * closes. Exporting the four pieces separately would publish that ordering
 * hazard as the API. This module exports the composition instead, and callers
 * get "a gated relay or an exception" with no way to assemble a half-gated one.
 *
 * `@ait-co/devtools` currently reaches into this package's `src/mcp/*` copies of
 * those four symbols directly; `startDevServerCdpRelay` is what lets it stop.
 *
 * WHAT STAYS WITH THE CALLER (deliberate non-goals):
 *
 *   - **Spawning the tunnel.** `cloudflared` process management, its banner, and
 *     its stderr sanitisation belong to the dev-server plugin's dev loop — the
 *     same reason `startQuickTunnel` was left there when `startTunnelDashboard`
 *     moved here. So the opener arrives as {@link StartDevServerCdpRelayOptions.openTunnel}
 *     rather than being imported. The composition still owns the *ordering*
 *     (relay first, then a tunnel to its OS-assigned port) and the URL algebra
 *     the caller would otherwise re-derive.
 *   - **Writing the relay-URL store (`.ait_urls`).** That file also carries the
 *     plain screen-preview tunnel, which exists with or without CDP, so its
 *     writer stays on the caller's side. Only the daemon's *reader* lives here.
 *   - **Throttling `onAuthReject`.** How often a rejection becomes a visible
 *     hint is a UX decision owned by whoever renders it. The callback is passed
 *     through unchanged and fires on every rejection.
 *
 * SECRET-HANDLING: three of the four values this module handles are secret-class
 * — the TOTP secret, the public relay `https://` base, and the `wss://` URL
 * derived from it. None of them is ever logged, folded into an error message, or
 * otherwise surfaced by this module. The one loggable value is
 * {@link DevServerCdpRelay.localHttpUrl} (`http://127.0.0.1:<port>`), which
 * carries no tunnel host. Errors from `openTunnel` are re-thrown untouched (the
 * caller's opener owns its own sanitisation) and teardown errors are swallowed
 * rather than reported, because a teardown message is one of the few places a
 * tunnel host could still escape.
 */

import type { RelayAuthRejectEvent } from '../mcp/chii-relay.js';

/**
 * Re-exported so a caller can name the type of its own `onAuthReject` handler
 * without reaching past this entry point into the daemon's internals.
 */
export type { RelayAuthRejectEvent };

/**
 * The slice of a public tunnel this module needs. Structurally satisfied by the
 * dev-server plugin's own quick-tunnel handle — nothing else is used, so the
 * caller keeps whatever extra fields (child PID, health probes, reissue) its
 * implementation carries.
 */
export interface DevServerRelayTunnel {
  /**
   * Public `https://` base URL the tunnel exposes for the relay.
   *
   * SECRET-HANDLING: the tunnel host is secret-class — never log this.
   */
  url: string;
  /** Tear down the tunnel. Must be safe to call more than once. */
  stop: () => void;
}

export interface StartDevServerCdpRelayOptions {
  /**
   * Dev-server project root (Vite's `server.config.root`).
   *
   * This is the anchor for the project-local `.ait_relay` secret file: it is
   * written to the nearest `package.json` directory at or above this path. The
   * MCP daemon resolves the same path from the project root it is given per
   * debug session and reads that file read-only, so a secret minted by
   * `pnpm dev` is the one the daemon verifies against. Passing a different
   * anchor here than the daemon sees does not fail loudly — it produces a relay
   * whose gate rejects every code the QR carries.
   */
  projectRoot: string;
  /**
   * Opens a public tunnel to the relay's local port, resolving once the URL is
   * assigned.
   *
   * Called exactly once, after the relay is listening, with the relay's
   * OS-assigned port. Injected rather than imported — see the module header for
   * why the `cloudflared` spawner stays with the dev-server plugin.
   */
  openTunnel: (localPort: number) => Promise<DevServerRelayTunnel>;
  /**
   * Secret-free observer for relay auth rejections, passed straight through to
   * the relay. Fires on EVERY rejection — throttling, if any, is the caller's.
   *
   * SECRET-HANDLING: the event carries only the rejected surface kind. It never
   * carries a URL, a code, or the secret, and must not be made to.
   */
  onAuthReject?: (event: RelayAuthRejectEvent) => void;
  /**
   * Environment to read the relay secret from and mint it into. Defaults to
   * `process.env`, which is what production wants — step 1 injects the secret
   * into the live process so steps 2–4 and any later TOTP minting see it.
   * Injectable so tests stay hermetic.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Sink for the one-time "a relay secret was generated" notice emitted on first
   * run. Defaults to the secret store's own sink (stderr).
   *
   * SECRET-HANDLING: the notice names the file, never its contents. Nothing else
   * in this module writes to this sink.
   */
  log?: (msg: string) => void;
}

/** Handle returned by {@link startDevServerCdpRelay}. */
export interface DevServerCdpRelay {
  /** OS-assigned local port the relay bound to. Not a secret. */
  port: number;
  /**
   * `http://127.0.0.1:<port>` — the relay's loopback base.
   *
   * The only URL here that is safe to log or show a developer: it names no
   * tunnel host, and the relay runs on the same machine as the tools that
   * consume it (the MCP inspector URL assembly uses it to skip the tunnel
   * round-trip entirely).
   */
  localHttpUrl: string;
  /**
   * Public `https://` base URL of the relay tunnel.
   *
   * SECRET-HANDLING: secret-class (carries the tunnel host) — store it, hand it
   * to the URL store, never log it.
   */
  httpUrl: string;
  /**
   * Public `wss://` relay URL the launcher QR / deep-link carries as `relay=`.
   * Same host as {@link httpUrl}, scheme swapped.
   *
   * SECRET-HANDLING: secret-class — never log it.
   */
  wssUrl: string;
  /**
   * Tears down the tunnel and then the relay, in that order.
   *
   * Idempotent, and never rejects: callers wire this into `SIGINT`/`SIGTERM`/
   * `exit` handlers where they can only `void` the promise, so a rejection would
   * surface as an unhandled rejection during shutdown. Teardown failures are
   * swallowed for that reason and because an error message here is a place the
   * tunnel host could otherwise leak.
   */
  close: () => Promise<void>;
}

/**
 * Boots a TOTP-gated CDP relay for a dev server and exposes it through a public
 * tunnel.
 *
 * Performs, in order: ensure the project-local relay secret exists, fail fast if
 * relay auth is still unconfigured, build the upgrade-gate predicate from that
 * secret, start the relay behind the gate, then open a tunnel to the port the
 * relay bound. See the module header for why that order is a contract rather
 * than an implementation detail.
 *
 * Every `../mcp/*` module is reached through a dynamic `import()` so the
 * relay's heavy graph (`chii`, `ws`, Koa) stays out of the eagerly-loaded
 * `dev-bridge` chunk — a caller that never turns CDP on never pays for it.
 *
 * Failure is all-or-nothing: if the tunnel cannot be opened the already-started
 * relay is closed before the error propagates, so a rejected call leaves no
 * listening socket behind. Errors are re-thrown as-is — the caller's opener owns
 * whatever sanitisation its own diagnostics need.
 *
 * @throws when relay auth cannot be configured, the relay cannot bind, or
 *   `openTunnel` rejects.
 */
export async function startDevServerCdpRelay(
  options: StartDevServerCdpRelayOptions,
): Promise<DevServerCdpRelay> {
  const { projectRoot, openTunnel, onAuthReject, env, log } = options;

  // 1. Ensure the relay secret exists. On first run this mints a 256-bit value,
  //    persists it to <nearest package.json dir above projectRoot>/.ait_relay
  //    (0600), and injects it into `env`; on later runs it silently reloads the
  //    persisted value. The MCP daemon reads that same file read-only.
  //    SECRET-HANDLING: neither the value nor the resolved path is logged.
  const { ensureRelaySecret } = await import('../mcp/relay-secret-store.js');
  await ensureRelaySecret({ projectRoot, env, log });

  // 2. Fail fast when the secret is still absent or malformed. The relay is
  //    reachable over a public tunnel, so an ungated boot would expose CDP to
  //    anyone holding the URL — refusing to start is the only safe outcome.
  //    SECRET-HANDLING: the thrown message is a fixed string that names neither
  //    the value nor its length.
  const { assertRelayAuthConfigured, buildRelayVerifyAuth } = await import('../mcp/totp.js');
  assertRelayAuthConfigured(env);

  // 3. Build the WS-upgrade / HTTP gate predicate. It captures the secret from
  //    step 1 in a closure and is the authoritative check on every inbound
  //    connection. Step 2 guarantees this is a function, not `undefined`.
  const verifyAuth = buildRelayVerifyAuth(env);

  // 4. Boot the relay behind that gate on an OS-assigned port (port 0): a stale
  //    orphaned tunnel child may still hold any fixed port, and EADDRINUSE here
  //    surfaces as an opaque startup failure.
  const { startChiiRelay } = await import('../mcp/chii-relay.js');
  const relay = await startChiiRelay({ port: 0, verifyAuth, onAuthReject });

  // 5. Expose the relay publicly. The relay must already be listening: the
  //    tunnel is opened to the port it actually bound.
  let tunnel: DevServerRelayTunnel;
  try {
    tunnel = await openTunnel(relay.port);
  } catch (err) {
    // Do not leave a gated-but-unreachable relay holding a socket. Teardown
    // failures are swallowed so the original cause is what propagates.
    try {
      await relay.close();
    } catch {
      // Ignore — the tunnel failure below is the error worth reporting.
    }
    throw err;
  }

  // Scheme swap only — same host, same path. Matches what the launcher deep-link
  // and the in-app attach expect as `relay=`.
  const wssUrl = tunnel.url.replace(/^https:/, 'wss:');

  let teardown: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (teardown !== null) return teardown;
    teardown = (async () => {
      // Tunnel first, then the relay: dropping the public leg before the local
      // one means no inbound connection can arrive at a half-closed relay.
      try {
        tunnel.stop();
      } catch {
        // Swallowed — see DevServerCdpRelay.close.
      }
      try {
        await relay.close();
      } catch {
        // Swallowed — see DevServerCdpRelay.close.
      }
    })();
    return teardown;
  };

  return {
    port: relay.port,
    // `baseUrl` is `http://127.0.0.1:<port>` — the relay binds loopback.
    localHttpUrl: relay.baseUrl,
    httpUrl: tunnel.url,
    wssUrl,
    close,
  };
}
