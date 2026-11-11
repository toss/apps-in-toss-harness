/**
 * Chromium launcher for the local debug mode (env 1).
 *
 * Launch decision rationale:
 *   - `chrome-launcher` (npm) is purpose-built and finds installed Chrome, but
 *     adds a runtime dependency to the MCP bundle. The repo already has a clear
 *     "external dependency minimization" policy; `chrome-launcher` is not worth
 *     pulling in for what is essentially `spawn(chromeBin, [...flags])`.
 *   - Playwright is a devDependency used for E2E only — pulling `chromium.launch`
 *     into the runtime MCP path would add ~100 MB of bundled Chromium to the
 *     production install and break the "devDep = e2e only" boundary.
 *   - `child_process.spawn` with a platform-aware binary search is the lightest
 *     option: zero new dependencies, portable across macOS/Linux/Windows, and
 *     trivially testable by injecting a `spawnFn`.
 *
 * The launcher finds an installed Chrome/Chromium using a prioritized list of
 * well-known binary paths per platform, then spawns it with:
 *   --remote-debugging-port=<port>
 *   --no-first-run
 *   --no-default-browser-check
 *   <devUrl>
 *
 * `npm run dev` is started by the user; the MCP only launches the browser pointing
 * at it.
 *
 * Node-only.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { platform, tmpdir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { childProcessEnv } from './child-env.js';
import { isPidAlive } from './parent-watcher.js';

/** A handle returned by `launchChromium`. */
export interface ChromiumHandle {
  /** The port Chromium is listening on for CDP (`--remote-debugging-port`). */
  port: number;
  /** Devtools HTTP base URL, e.g. `http://127.0.0.1:9222`. */
  devtoolsUrl: string;
  /** Stop the Chromium child process. */
  stop(): void;
}

export interface LaunchChromiumOptions {
  /**
   * CDP remote debugging port. If 0 or omitted, Chromium picks a free port
   * itself (`--remote-debugging-port=0`) and the launcher reads the choice back
   * from the profile's `DevToolsActivePort` file, so two sessions starting at
   * the same moment can never be handed the same port.
   */
  port?: number;
  /**
   * URL to open in the browser. Defaults to `AIT_DEVTOOLS_URL` env var or
   * `http://localhost:5173`.
   */
  devUrl?: string;
  /**
   * Extra Chromium flags appended to the spawn command. Use with caution.
   */
  extraArgs?: string[];
  /**
   * Injectable `spawn` function for unit testing — defaults to Node's
   * `child_process.spawn`. Tests inject a fake to avoid launching a real browser.
   */
  spawnFn?: typeof spawn;
  /** Browser binary to run instead of searching the system. Tests only. */
  binaryPath?: string;
  /** Directory the per-session profile directory is created in. Defaults to the OS temp dir. */
  profileBaseDir?: string;
}

/**
 * Returns an ordered list of Chromium/Chrome binary paths to try for the
 * current platform.
 */
export function candidateChromePaths(): string[] {
  const os = platform();
  if (os === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  if (os === 'linux') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/chromium',
      '/snap/bin/chromium',
    ];
  }
  if (os === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    return [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Chromium\\Application\\chrome.exe`,
    ];
  }
  return [];
}

/** Find the first Chrome/Chromium binary that exists on this machine. */
export function findChromeBinary(): string | null {
  for (const p of candidateChromePaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

const PROFILE_PREFIX = 'ait-debugger-chromium-profile-';

/**
 * Per-session Chromium profile directory, mode 0700.
 *
 * Chromium allows one running instance per profile directory: a second launch on
 * the same directory hands its window to the first instance and exits, so its
 * `--remote-debugging-port` never opens. Each debugger session therefore gets its
 * own profile (`…-<uid>-<session>`, `session` defaults to this process's PID) and
 * two sessions can run local browsers at the same time.
 *
 * `tmpdir()` is shared on Linux, and a directory another user created there
 * first would hold this browser's profile. If the name is taken by something
 * that is not ours, use a fresh private directory instead.
 */
export function chromiumProfileDir(
  baseDir: string = tmpdir(),
  session: number | string = process.pid,
): string {
  const dir = `${join(baseDir, PROFILE_PREFIX)}${userInfo().uid}-${session}`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (stat.isDirectory() && stat.uid === userInfo().uid) {
      chmodSync(dir, 0o700);
      return dir;
    }
  } catch {
    // Fall through to a private one-off directory.
  }
  return mkdtempSync(join(baseDir, PROFILE_PREFIX));
}

/** Removes a profile directory made by {@link chromiumProfileDir}. Best effort. */
export function removeChromiumProfileDir(dir: string): void {
  if (!basename(dir).startsWith(PROFILE_PREFIX)) return;
  try {
    // Chromium's helper processes can still be writing right after the kill, which makes the
    // first pass fail with ENOTEMPTY — retry briefly instead of leaving the directory.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // Chromium may still be flushing; the next session's sweep removes it.
  }
}

/**
 * Waits for Chromium to publish the port it chose, in
 * `<profileDir>/DevToolsActivePort` (first line = port, second = browser
 * websocket path). Rejects when the browser exits first or `timeoutMs` passes.
 */
export async function readDevToolsActivePort(
  profileDir: string,
  hasExited: () => boolean,
  timeoutMs = 15_000,
  pollMs = 100,
): Promise<number> {
  const file = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const first = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? '';
      const port = /^\d+$/.test(first) ? Number.parseInt(first, 10) : 0;
      if (port > 0 && port < 65536) return port;
    } catch {
      // Not written yet.
    }
    if (hasExited()) throw new Error('Chromium exited before it opened a debugging port.');
    if (Date.now() >= deadline) {
      throw new Error('Chromium did not report its debugging port in time.');
    }
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
}

/**
 * Removes profile directories of earlier sessions that no longer run (their PID
 * is gone), so a crashed session does not leave a profile behind for good. A
 * directory of a live session, of another user, or one that is not a plain
 * directory is never touched.
 */
export function sweepStaleChromiumProfiles(
  baseDir: string = tmpdir(),
  isAlive: (pid: number) => boolean = isPidAlive,
): void {
  const pattern = new RegExp(`^${PROFILE_PREFIX}${userInfo().uid}-(\\d+)$`);
  try {
    for (const name of readdirSync(baseDir)) {
      const m = pattern.exec(name);
      if (m?.[1] === undefined || isAlive(Number.parseInt(m[1], 10))) continue;
      const full = join(baseDir, name);
      const st = lstatSync(full);
      if (st.isDirectory() && st.uid === userInfo().uid) removeChromiumProfileDir(full);
    }
  } catch {
    // Unreadable temp directory — nothing to sweep.
  }
}

/**
 * Launch a local Chromium instance with CDP remote debugging enabled.
 *
 * The caller is responsible for calling `handle.stop()` when done.
 *
 * @throws if no Chrome/Chromium binary is found on the system.
 */
export async function launchChromium(options: LaunchChromiumOptions = {}): Promise<ChromiumHandle> {
  const spawnImpl = options.spawnFn ?? spawn;

  // An explicit port is passed through; 0 lets Chromium choose and report it.
  const requestedPort = options.port ?? 0;

  const devUrl = options.devUrl ?? process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';

  const binary = options.binaryPath ?? findChromeBinary();
  if (binary === null) {
    throw new Error(
      'No Chrome/Chromium binary found on this system. ' +
        'Install Google Chrome or Chromium and try again. ' +
        'Searched: ' +
        candidateChromePaths().join(', '),
    );
  }

  sweepStaleChromiumProfiles(options.profileBaseDir);
  const profileDir = chromiumProfileDir(options.profileBaseDir);

  const args = [
    `--remote-debugging-port=${requestedPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Use a separate profile dir so the debugged instance doesn't interfere
    // with the user's regular Chrome profile — nor with another session's browser.
    `--user-data-dir=${profileDir}`,
    ...(options.extraArgs ?? []),
    devUrl,
  ];

  const child: ChildProcess = spawnImpl(binary, args, {
    // Detach stdio so the MCP server's stdio transport is not contaminated.
    stdio: 'ignore',
    detached: false,
    env: childProcessEnv(),
  });

  // Allow the Node process to exit even if the child is still running.
  child.unref();
  // The profile belongs to this session only; remove it once the browser is gone.
  let exited = false;
  child.once('exit', () => {
    exited = true;
    removeChromiumProfileDir(profileDir);
  });

  let port = requestedPort;
  if (requestedPort === 0) {
    try {
      port = await readDevToolsActivePort(profileDir, () => exited);
    } catch (err) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      removeChromiumProfileDir(profileDir);
      throw err;
    }
  }

  const devtoolsUrl = `http://127.0.0.1:${port}`;

  process.stderr.write(
    `[ait-local-debug] Launched Chromium: ${binary}\n` +
      `[ait-local-debug] CDP endpoint: ${devtoolsUrl}\n` +
      `[ait-local-debug] Opening: ${devUrl}\n`,
  );

  return {
    port,
    devtoolsUrl,
    stop(): void {
      try {
        child.kill();
      } catch {
        // Ignore — the child may have already exited.
      }
      removeChromiumProfileDir(profileDir);
    },
  };
}
