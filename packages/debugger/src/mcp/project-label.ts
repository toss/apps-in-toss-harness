/**
 * Project label: the one name a debugger session shows to the person using it.
 *
 * Several sessions can run at once, each with its own daemon, relay and
 * dashboard. The label is what tells them apart (dashboard tab title,
 * `get_status`). It is the basename of the project root and nothing else:
 * never the full path, never a relay host.
 *
 * Node-only, no heavy imports (the test runner pulls this in too).
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const MAX_LABEL_LENGTH = 64;
const FALLBACK_LABEL = 'unknown';

/**
 * Makes `raw` safe to show: control characters and line breaks removed, runs of
 * whitespace collapsed, capped at {@link MAX_LABEL_LENGTH}. Empty input gives
 * `unknown`.
 */
export function sanitizeProjectLabel(raw: unknown): string {
  if (typeof raw !== 'string') return FALLBACK_LABEL;
  let withoutControls = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    withoutControls += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return FALLBACK_LABEL;
  return cleaned.length > MAX_LABEL_LENGTH ? cleaned.slice(0, MAX_LABEL_LENGTH) : cleaned;
}

/**
 * The label for the project that contains `start` (default: the working
 * directory): the basename of the nearest ancestor holding a `package.json`,
 * or of `start` itself when there is none.
 */
export function projectLabel(
  start: string = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): string {
  let dir = resolve(start);
  for (let depth = 0; depth < 32; depth++) {
    if (exists(join(dir, 'package.json'))) return sanitizeProjectLabel(basename(dir));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return sanitizeProjectLabel(basename(resolve(start)));
}

/** Where the label came from. */
export type ProjectIdentitySource = 'granite' | 'package' | 'folder';

/**
 * What identifies the project a daemon serves: `label` is the name shown first
 * (mini-app `appName`, else the `package.json` name, else the folder name) and
 * `folder` is the project folder's basename. Neither is ever a full path.
 */
export interface ProjectIdentity {
  label: string;
  folder: string;
  source: ProjectIdentitySource;
}

/** File access for {@link resolveProjectIdentity}; tests inject a fake. */
export interface ProjectIdentityFs {
  exists(path: string): boolean;
  /** UTF-8 text of `path`, or `null` when unreadable. */
  readText(path: string): string | null;
}

const MAX_CONFIG_BYTES = 256 * 1024;
const GRANITE_CONFIG_NAMES = [
  'granite.config.ts',
  'granite.config.js',
  'granite.config.mts',
  'granite.config.mjs',
] as const;

const defaultIdentityFs: ProjectIdentityFs = {
  exists: existsSync,
  readText(path) {
    try {
      const text = readFileSync(path, 'utf8');
      return text.length > MAX_CONFIG_BYTES ? null : text;
    } catch {
      return null;
    }
  },
};

function usableLabel(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const label = sanitizeProjectLabel(raw);
  return label === FALLBACK_LABEL && raw.trim() !== FALLBACK_LABEL ? null : label;
}

/**
 * Reads `appName: '...'` out of a granite config by text match. The file is
 * never executed or imported. Comments are dropped first so a commented-out
 * name is not picked up; a template literal with `\${` is not a plain name.
 */
export function extractGraniteAppName(source: string): string | null {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const m = /\bappName\s*:\s*(['"`])((?:(?!\1)[^\\\n])+)\1/.exec(code);
  const name = m?.[2];
  if (name === undefined || name.includes('${')) return null;
  return usableLabel(name);
}

function packageJsonName(text: string | null): string | null {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return usableLabel((parsed as Record<string, unknown>).name);
  } catch {
    return null;
  }
}

/**
 * The project root for `start`: the nearest ancestor holding a `package.json`,
 * or `start` itself when there is none.
 */
export function findProjectRoot(
  start: string = process.cwd(),
  exists: (path: string) => boolean = existsSync,
): string {
  let dir = resolve(start);
  for (let depth = 0; depth < 32; depth++) {
    if (exists(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

/**
 * Resolves the project identity once, at daemon start.
 *
 * Order: `appName` in `granite.config.{ts,js,mts,mjs}`, then the `package.json`
 * `name`, then the folder basename.
 */
export function resolveProjectIdentity(
  start: string = process.cwd(),
  fs: ProjectIdentityFs = defaultIdentityFs,
): ProjectIdentity {
  const root = findProjectRoot(start, fs.exists);
  const folder = sanitizeProjectLabel(basename(root));
  for (const name of GRANITE_CONFIG_NAMES) {
    const text = fs.readText(join(root, name));
    const appName = text === null ? null : extractGraniteAppName(text);
    if (appName !== null) return { label: appName, folder, source: 'granite' };
  }
  const pkgName = packageJsonName(fs.readText(join(root, 'package.json')));
  if (pkgName !== null) return { label: pkgName, folder, source: 'package' };
  return { label: folder, folder, source: 'folder' };
}
