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
const manifestPath = join(root, '.claude-plugin', 'plugin.json');

const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const raw = readFileSync(manifestPath, 'utf8');

const versionRe = /("version"\s*:\s*")[^"]*(")/;
if (!versionRe.test(raw)) {
  throw new Error('no "version" field found in .claude-plugin/plugin.json');
}

const next = raw.replace(versionRe, `$1${version}$2`);
if (next === raw) {
  process.exit(0);
}

writeFileSync(manifestPath, next);
console.log(`synced .claude-plugin/plugin.json version → ${version}`);
