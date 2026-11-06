/**
 * Project label: the one name a debugger session shows to the person using it.
 *
 * Several sessions can run at once, each with its own daemon, relay and
 * dashboard. The label is what tells them apart (dashboard tab title,
 * `get_debug_status`). It is the basename of the project root and nothing else:
 * never the full path, never a relay host.
 *
 * Node-only, no heavy imports (the test runner pulls this in too).
 */

import { existsSync } from 'node:fs';
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
