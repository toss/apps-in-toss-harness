/**
 * Leaves a short trace of what the agent ran on the phone, for the phone's own UI.
 *
 * After each `evaluate`, `call_sdk` and `run_tests`, the daemon appends
 * `{ t, kind, summary, ok }` to `window.__ait_remote_log` (the last 50 are kept) and
 * dispatches `ait:remote-log`. Best effort: a missing page or a failed send never
 * fails the tool.
 *
 * SECRET-HANDLING: the summary is at most 80 characters, passed through page-redact
 * (tokens, card and resident numbers are masked). For `evaluate` it is the first 60
 * characters of the expression, for `call_sdk` the method name.
 */

import type { CdpConnection } from './cdp-connection.js';
import { redactText } from './page-redact.js';

export type RemoteLogKind = 'evaluate' | 'call_sdk' | 'run_tests';

export interface RemoteLogEntry {
  t: number;
  kind: RemoteLogKind;
  summary: string;
  ok: boolean;
}

export function remoteLogEntry(
  kind: RemoteLogKind,
  summary: string,
  ok: boolean,
  now: number = Date.now(),
): RemoteLogEntry {
  const flat = redactText(summary.replace(/\s+/g, ' ').trim());
  return { t: Math.round(now), kind, summary: flat.slice(0, 80), ok };
}

export function buildRemoteLogExpression(entry: RemoteLogEntry): string {
  return (
    `(() => {` +
    `try { var W = window; var a = W.__ait_remote_log; if (!Array.isArray(a)) { a = W.__ait_remote_log = []; }` +
    `a.push(${JSON.stringify(entry)}); if (a.length > 50) { a.splice(0, a.length - 50); }` +
    `W.dispatchEvent(new Event('ait:remote-log')); } catch (_) {}` +
    `return true;` +
    `})()`
  );
}

/** Best effort; resolves once the send settled. */
export async function appendRemoteLog(
  conn: CdpConnection,
  kind: RemoteLogKind,
  summary: string,
  ok: boolean,
): Promise<void> {
  try {
    if (conn.kind !== 'relay' || conn.listTargets().length === 0) return;
    await conn.send('Runtime.evaluate', {
      expression: buildRemoteLogExpression(remoteLogEntry(kind, summary, ok)),
    });
  } catch {
    // The trace is a convenience.
  }
}
