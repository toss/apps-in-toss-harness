/**
 * First-mint announcement and ignore-entry handling for `.ait_relay`.
 *
 * SECRET-HANDLING: the fixture secret is a constant byte pattern. The tests
 * assert the announcement never contains the minted value.
 */

import { describe, expect, it } from 'vitest';
import { parseRelayKeyMeta, RELAY_KEY_META_FILE_NAME, relayKeyId } from '../relay-key-age.js';
import {
  ensureRelaySecret,
  RELAY_SECRET_FILE_NAME,
  type RelaySecretFs,
} from '../relay-secret-store.js';

const ROOT = '/fake/project';

function makeFs(gitignore: string | null, opts: { appendThrows?: boolean } = {}) {
  const files = new Map<string, string>([[`${ROOT}/package.json`, '{}']]);
  if (gitignore !== null) files.set(`${ROOT}/.gitignore`, gitignore);
  const fs: RelaySecretFs = {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p) ?? '',
    writeFileSync: (p, data) => {
      files.set(p, data);
    },
    chmodSync: () => {},
    appendFileSync: (p, data) => {
      if (opts.appendThrows) throw new Error('read-only');
      files.set(p, (files.get(p) ?? '') + data);
    },
  };
  return { fs, files };
}

async function mint(gitignore: string | null, opts: { appendThrows?: boolean } = {}) {
  const { fs, files } = makeFs(gitignore, opts);
  const logs: string[] = [];
  const processEnv: NodeJS.ProcessEnv = {};
  await ensureRelaySecret({
    projectRoot: ROOT,
    env: processEnv,
    fs,
    existsSync: fs.existsSync,
    randomBytes: (n) => Buffer.alloc(n, 0xab),
    log: (m) => logs.push(m),
    now: () => Date.parse('2026-11-04T00:00:00Z'),
  });
  return { logs, files, processEnv };
}

describe('ensureRelaySecret — first mint announcement', () => {
  it('does not tell the developer to commit the secret file', async () => {
    const { logs, processEnv } = await mint('');
    expect(logs).toHaveLength(1);
    const msg = logs[0] ?? '';
    expect(msg).not.toMatch(/커밋하세요|repo에 커밋|비공개 repo/);
    expect(msg).toContain('커밋하거나 공유하지 마세요');
    const minted = processEnv.AIT_DEBUG_TOTP_SECRET ?? '';
    expect(minted).not.toBe('');
    expect(msg).not.toContain(minted);
  });

  it('adds the ignore entry when .gitignore is missing', async () => {
    const { files, logs } = await mint(null);
    expect(files.get(`${ROOT}/.gitignore`)).toBe(
      `${RELAY_SECRET_FILE_NAME}\n${RELAY_KEY_META_FILE_NAME}\n`,
    );
    expect(logs[0]).toContain('무시 규칙을 추가했습니다');
  });

  it('adds the ignore entry after existing lines without a trailing newline', async () => {
    const { files } = await mint('node_modules');
    expect(files.get(`${ROOT}/.gitignore`)).toBe(
      `node_modules\n${RELAY_SECRET_FILE_NAME}\n${RELAY_KEY_META_FILE_NAME}\n`,
    );
  });

  it.each([RELAY_SECRET_FILE_NAME, `/${RELAY_SECRET_FILE_NAME}`, `**/${RELAY_SECRET_FILE_NAME}`])(
    'leaves .gitignore alone when it already has %s',
    async (line) => {
      const original = `dist\n${line}\n${RELAY_KEY_META_FILE_NAME}\n`;
      const { files, logs } = await mint(original);
      expect(files.get(`${ROOT}/.gitignore`)).toBe(original);
      expect(logs[0]).not.toContain('무시 규칙');
    },
  );

  it('records when the key was created, next to it and tied to that secret', async () => {
    const { files, processEnv } = await mint('');
    const meta = parseRelayKeyMeta(files.get(`${ROOT}/${RELAY_KEY_META_FILE_NAME}`) ?? '');
    expect(meta).toEqual({
      createdAtMs: Date.parse('2026-11-04T00:00:00Z'),
      keyId: relayKeyId(processEnv.AIT_DEBUG_TOTP_SECRET ?? ''),
    });
    // The secret file itself stays a bare hex string, readable by older tools.
    expect(files.get(`${ROOT}/${RELAY_SECRET_FILE_NAME}`)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('when .gitignore cannot be updated, says to add it by hand and not to commit', async () => {
    const { logs } = await mint('', { appendThrows: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('직접 추가하고 커밋하지 마세요');
    expect(logs[0]).not.toMatch(/비공개 repo/);
  });
});
