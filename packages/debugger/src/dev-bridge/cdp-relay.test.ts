/**
 * Tests for `startDevServerCdpRelay` — the env-2 CDP relay bootstrap (issue #30).
 *
 * The function's whole reason to exist is an ORDER (ensure secret → assert auth
 * → build verifier → boot relay → open tunnel), so the suite proves the order
 * through its observable consequences rather than by spying on call sequence:
 *
 *   - a code derived from the secret the call MINTED is accepted by the relay it
 *     STARTED. That can only hold if step 1 ran before step 3 and step 3 before
 *     step 4 — a verifier built too early captures nothing, and a relay started
 *     too early is ungated.
 *   - the injected `openTunnel` finds the relay already listening AND already
 *     gated (its probe gets a 401), which pins step 4 before step 5.
 *   - the daemon's read-only loader finds the same secret at the same anchored
 *     path, which pins the `.ait_relay` seam the two processes share.
 *
 * The real `chii` module is mocked (as in `chii-relay-port.test.ts`) so no Go
 * binary or phone is needed; the auth gate, the attach-handshake route, and the
 * HTTP bind are all this package's own code and run for real.
 *
 * SECRET-HANDLING: the values this suite treats as secret-class — the minted
 * relay secret, the fake tunnel host, the derived `wss://` URL, and any TOTP
 * code — are asserted ABSENT from every captured output stream. They are never
 * printed, and the fixture host below is a syntactic placeholder, not a real
 * tunnel.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayAuthRejectEvent } from '../mcp/chii-relay.js';
import { loadRelaySecretReadOnly } from '../mcp/relay-secret-store.js';
import { generateTotp } from '../mcp/totp.js';
import { type DevServerCdpRelay, startDevServerCdpRelay } from './cdp-relay.js';

// Mock `chii` so the relay can bind without the real chii server (same approach
// as src/mcp/__tests__/chii-relay-port.test.ts). Our own auth listener and the
// attach-handshake listener are registered by chii-relay.ts itself, so the
// request paths this suite exercises are unaffected by the mock.
vi.mock('chii', () => ({
  default: undefined,
  start: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Stand-in for a public tunnel URL. Secret-class by policy (a real one carries
 * the tunnel host), so every assertion below treats it as a value that must not
 * appear in output.
 */
const FAKE_TUNNEL_URL = 'https://relay-host-placeholder.example';
const FAKE_TUNNEL_WSS = 'wss://relay-host-placeholder.example';

/** Relay HTTP path that answers 204 behind the auth gate (attach handshake). */
const GATED_PROBE_PATH = 'ait-attach';

/** A code that is essentially never the live TOTP — used to force a rejection. */
const BAD_CODE = '000000';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ait-cdp-relay-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Creates `<tmpRoot>/<name>/package.json` and returns the directory path. */
function makeProject(name: string): string {
  const dir = join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }), 'utf8');
  return dir;
}

/** Reads the minted secret straight off disk (never logged, only compared). */
function readSecret(anchorDir: string): string {
  return readFileSync(join(anchorDir, '.ait_relay'), 'utf8').trim();
}

/** GETs `path` on the relay and resolves with the status code. */
function getStatus(baseUrl: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Composition: return shape + the `.ait_relay` contract
// ---------------------------------------------------------------------------

describe('startDevServerCdpRelay — composition', () => {
  it('mints the project-local secret, boots a relay, and reports all three URL forms', async () => {
    const projectRoot = makeProject('app');
    const env: NodeJS.ProcessEnv = {};
    const seenPorts: number[] = [];

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env,
      log: () => {},
      openTunnel: async (port) => {
        seenPorts.push(port);
        return { url: FAKE_TUNNEL_URL, stop: () => {} };
      },
    });

    try {
      // 1. secret persisted at the project anchor, 0600, and injected into env.
      const secretPath = join(projectRoot, '.ait_relay');
      expect(existsSync(secretPath)).toBe(true);
      expect(statSync(secretPath).mode & 0o777).toBe(0o600);
      expect(readSecret(projectRoot)).toMatch(/^[0-9a-f]{64}$/);
      expect(env.AIT_DEBUG_TOTP_SECRET).toBe(readSecret(projectRoot));

      // 2. the tunnel was opened exactly once, for the port the relay bound.
      expect(seenPorts).toEqual([handle.port]);
      expect(handle.port).toBeGreaterThan(0);

      // 3. the three URL forms the caller distinguishes.
      expect(handle.localHttpUrl).toBe(`http://127.0.0.1:${handle.port}`);
      expect(handle.httpUrl).toBe(FAKE_TUNNEL_URL);
      expect(handle.wssUrl).toBe(FAKE_TUNNEL_WSS);
    } finally {
      await handle.close();
    }
  });

  it('leaves the ambient process environment untouched when `env` is injected', async () => {
    const projectRoot = makeProject('app');
    const before = process.env.AIT_DEBUG_TOTP_SECRET;

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env: {},
      log: () => {},
      openTunnel: async () => ({ url: FAKE_TUNNEL_URL, stop: () => {} }),
    });
    await handle.close();

    expect(process.env.AIT_DEBUG_TOTP_SECRET).toBe(before);
  });

  it('anchors `.ait_relay` at the nearest package.json directory above the root', async () => {
    // A dev server rooted in a subdirectory that has no package.json of its own:
    // the secret must land next to the package.json, because that is the anchor
    // the MCP daemon resolves from the project root it is handed.
    const pkgDir = makeProject('app');
    const nestedRoot = join(pkgDir, 'apps', 'web');
    mkdirSync(nestedRoot, { recursive: true });

    const handle = await startDevServerCdpRelay({
      projectRoot: nestedRoot,
      env: {},
      log: () => {},
      openTunnel: async () => ({ url: FAKE_TUNNEL_URL, stop: () => {} }),
    });
    await handle.close();

    expect(existsSync(join(pkgDir, '.ait_relay'))).toBe(true);
    expect(existsSync(join(nestedRoot, '.ait_relay'))).toBe(false);
  });

  it('writes the secret where the daemon reads it (loadRelaySecretReadOnly seam)', async () => {
    const projectRoot = makeProject('app');
    const devEnv: NodeJS.ProcessEnv = {};

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env: devEnv,
      log: () => {},
      openTunnel: async () => ({ url: FAKE_TUNNEL_URL, stop: () => {} }),
    });
    await handle.close();

    // A separate process (the MCP daemon) resolving the same project root must
    // land on the same file — this seam failing is silent, not loud.
    const daemonEnv: NodeJS.ProcessEnv = {};
    await loadRelaySecretReadOnly({ projectRoot, env: daemonEnv, log: () => {} });

    expect(daemonEnv.AIT_DEBUG_TOTP_SECRET).toBe(devEnv.AIT_DEBUG_TOTP_SECRET);
    expect(daemonEnv.AIT_DEBUG_TOTP_SECRET).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Ordering: the gate is built from the secret this call minted
// ---------------------------------------------------------------------------

describe('startDevServerCdpRelay — bootstrap order', () => {
  it('gates the relay with a verifier built from the freshly minted secret', async () => {
    const projectRoot = makeProject('app');
    let probeInsideOpenTunnel = 0;

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env: {},
      log: () => {},
      openTunnel: async (port) => {
        // Step 4 must already be done when step 5 runs: the relay is listening
        // AND its gate is armed (an unauthenticated request is rejected).
        probeInsideOpenTunnel = await getStatus(
          `http://127.0.0.1:${port}`,
          `/at/${BAD_CODE}/${GATED_PROBE_PATH}`,
        );
        return { url: FAKE_TUNNEL_URL, stop: () => {} };
      },
    });

    try {
      expect(probeInsideOpenTunnel).toBe(401);

      // A code derived from the secret on disk is accepted — only possible if
      // the verifier captured the value step 1 minted.
      const code = generateTotp(readSecret(projectRoot));
      await expect(getStatus(handle.localHttpUrl, `/at/${code}/${GATED_PROBE_PATH}`)).resolves.toBe(
        204,
      );
    } finally {
      await handle.close();
    }
  });

  it('forwards every auth rejection to onAuthReject without throttling', async () => {
    // Throttling is the caller's concern (the dev-server plugin renders the
    // hint); this layer must not swallow rejections on its own.
    const projectRoot = makeProject('app');
    const events: RelayAuthRejectEvent[] = [];

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env: {},
      log: () => {},
      onAuthReject: (event) => events.push(event),
      openTunnel: async () => ({ url: FAKE_TUNNEL_URL, stop: () => {} }),
    });

    try {
      for (let i = 0; i < 3; i += 1) {
        await getStatus(handle.localHttpUrl, `/at/${BAD_CODE}/${GATED_PROBE_PATH}`);
      }
      expect(events).toHaveLength(3);
      expect(events.every((e) => e.kind === 'http-request')).toBe(true);
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('startDevServerCdpRelay — teardown', () => {
  it('closes the tunnel and the relay once, however many times close() is called', async () => {
    const projectRoot = makeProject('app');
    let stopCalls = 0;

    const handle = await startDevServerCdpRelay({
      projectRoot,
      env: {},
      log: () => {},
      openTunnel: async () => ({
        url: FAKE_TUNNEL_URL,
        stop: () => {
          stopCalls += 1;
        },
      }),
    });

    await handle.close();
    await handle.close();
    await handle.close();

    expect(stopCalls).toBe(1);
    // The relay socket is gone: a request to the loopback base now fails.
    await expect(getStatus(handle.localHttpUrl, '/')).rejects.toThrow();
  });

  it('closes the relay and rethrows the original error when the tunnel fails', async () => {
    const projectRoot = makeProject('app');
    const boom = new Error('tunnel refused');
    let relayPort = 0;

    await expect(
      startDevServerCdpRelay({
        projectRoot,
        env: {},
        log: () => {},
        openTunnel: async (port) => {
          relayPort = port;
          throw boom;
        },
      }),
      // Identity, not shape: the composition must not wrap the caller's error
      // (a wrapper is where a tunnel host would get re-serialised).
    ).rejects.toBe(boom);

    expect(relayPort).toBeGreaterThan(0);
    // No half-started relay is left holding the port.
    await expect(getStatus(`http://127.0.0.1:${relayPort}`, '/')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SECRET-HANDLING
// ---------------------------------------------------------------------------

describe('startDevServerCdpRelay — SECRET-HANDLING', () => {
  it('never emits the secret, the tunnel host, or the wss URL on any stream', async () => {
    const projectRoot = makeProject('app');
    const env: NodeJS.ProcessEnv = {};
    const captured: string[] = [];
    const record = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
    };

    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(record),
    );

    let handle: DevServerCdpRelay | undefined;
    try {
      // No `log` sink is injected here on purpose: the first-run mint notice
      // takes its default route (stderr) and is captured with everything else.
      handle = await startDevServerCdpRelay({
        projectRoot,
        env,
        openTunnel: async () => ({ url: FAKE_TUNNEL_URL, stop: () => {} }),
      });
      // Exercise a rejection too — the gate's own output path.
      await getStatus(handle.localHttpUrl, `/at/${BAD_CODE}/${GATED_PROBE_PATH}`);
      await handle.close();
      handle = undefined;
    } finally {
      if (handle !== undefined) await handle.close();
      stdout.mockRestore();
      stderr.mockRestore();
      for (const spy of spies) spy.mockRestore();
    }

    const secret = readSecret(projectRoot);
    const code = generateTotp(secret);
    const all = captured.join('\n');

    // Sanity: the capture is really wired. The first-run mint notice names the
    // file, so its presence proves the assertions below are testing something
    // rather than passing on an empty buffer.
    expect(all).toContain('.ait_relay');

    // The first-run notice is expected; what it must not carry is any of these.
    expect(all).not.toContain(secret);
    expect(all).not.toContain(FAKE_TUNNEL_URL);
    expect(all).not.toContain(FAKE_TUNNEL_WSS);
    expect(all).not.toContain('relay-host-placeholder');
    expect(all).not.toContain(`at=${code}`);
    expect(all).not.toContain(`/at/${code}`);

    // Whatever URLs do appear, none of them points at the relay. The first-run
    // notice links the docs page (a static, secret-free URL), so that one class
    // is excluded; everything else must be a loopback address, which is the only
    // relay-bearing URL this surface may emit.
    const urls = all.match(/\b(?:https?|wss?):\/\/[^\s"'<>)]+/g) ?? [];
    for (const url of urls.filter((u) => !u.startsWith('https://docs.aitc.dev/'))) {
      expect(url.startsWith('http://127.0.0.1:')).toBe(true);
    }
  });
});
