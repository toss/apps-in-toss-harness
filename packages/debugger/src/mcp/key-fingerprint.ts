/**
 * The one label every surface prints for a relay public key: `start_attach`,
 * `get_status`, `relay-key`, `inject-client` and the bundle check. Short and
 * non-reversible, so it is safe to print; it is not a secret.
 */

import { createHash } from 'node:crypto';

/** First 8 hex characters of the SHA-256 of the public key. */
export function keyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 8);
}

/** The same two facts, in the same words, for every CLI line: which folder, which key. */
export function describeKeyTarget(projectFolder: string, fingerprints: readonly string[]): string {
  return `project folder ${projectFolder}, key fingerprint ${fingerprints.join(', ')}`;
}

/**
 * Stderr warning for a CLI call that had to make a new key because the folder had none. A key
 * belongs to a project folder, so a new one is usually a sign that `--project` was left out
 * (the current folder is not the one the debugger session runs for) or is wrong.
 */
export function newKeyWarning(
  command: string,
  projectFolder: string,
  fingerprint: string,
  projectFlagGiven: boolean,
): string {
  const lead = projectFlagGiven
    ? `${projectFolder} had no relay key, so a new one was created (fingerprint ${fingerprint}).`
    : `--project was not given, so the current folder ${projectFolder} was used and a new relay key was created for it (fingerprint ${fingerprint}).`;
  return (
    `[debugger] ${command}: warning: ${lead} ` +
    'A bundle attaches only to a debugger session that signs with the same folder key: ' +
    'pass --project <the folder your debugger session runs for>, or ignore this if this folder is the one.\n'
  );
}
