#!/usr/bin/env node
// Copies the package.json version into .claude-plugin/plugin.json so the
// plugin manifest never drifts behind a Changesets release. Run by the
// release workflow right after `changeset version`.
//
// This does a surgical replacement of just the `version` string value so it
// preserves the file's existing formatting (Biome owns the layout — a full
// JSON.stringify rewrite would collapse/expand arrays and fail `pnpm lint`).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

// 두 어댑터 manifest 를 모두 동기화한다 — 하나만 갱신되면 A5 가 하드 실패한다.
const manifestRelPaths = [
  ['.claude-plugin', 'plugin.json'],
  ['.cursor-plugin', 'plugin.json'],
];

const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const versionRe = /("version"\s*:\s*")[^"]*(")/;

for (const rel of manifestRelPaths) {
  const manifestPath = join(root, ...rel);
  const label = rel.join('/');
  const raw = readFileSync(manifestPath, 'utf8');
  if (!versionRe.test(raw)) {
    throw new Error(`no "version" field found in ${label}`);
  }
  const next = raw.replace(versionRe, `$1${version}$2`);
  if (next === raw) {
    continue;
  }
  writeFileSync(manifestPath, next);
  console.log(`synced ${label} version → ${version}`);
}
