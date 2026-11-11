/**
 * Fingerprints the test files `run_tests` is about to run, so the developer approves the
 * exact files and a later swap is noticed.
 *
 * The phone shows the file list and a short digest. Right before the run the files are
 * hashed again; a different digest means a file changed after the approval and the run is
 * refused. The digest covers the test files themselves, not the modules they import.
 *
 * SECRET-HANDLING: paths relative to the project root and hashes only.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

export interface TestFileFingerprint {
  /** Path relative to the project root. */
  file: string;
  /** First 12 hex characters of the file's sha256. */
  hash: string;
}

export interface TestFilesDigest {
  files: TestFileFingerprint[];
  /** First 12 hex characters of the sha256 over all file names and hashes. */
  digest: string;
}

export async function hashTestFiles(
  files: readonly string[],
  root: string,
): Promise<TestFilesDigest> {
  const entries: TestFileFingerprint[] = [];
  const all = createHash('sha256');
  for (const abs of [...files].sort()) {
    const full = createHash('sha256')
      .update(await readFile(abs))
      .digest('hex');
    const file = relative(root, abs) || abs;
    entries.push({ file, hash: full.slice(0, 12) });
    all.update(`${file}\0${full}\n`);
  }
  return { files: entries, digest: all.digest('hex').slice(0, 12) };
}

/** Lines for the phone dialog: a digest line, then up to 5 files. */
export function describeTestFiles(d: TestFilesDigest): string[] {
  const lines = [`파일 ${d.files.length}개 · 지문 ${d.digest}`];
  for (const f of d.files.slice(0, 5)) lines.push(`${f.file} (${f.hash})`);
  if (d.files.length > 5) lines.push(`… 외 ${d.files.length - 5}개`);
  return lines;
}
