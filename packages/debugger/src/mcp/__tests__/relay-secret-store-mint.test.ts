/**
 * First-mint announcement and ignore-entry handling for `.ait_relay`.
 *
 * SECRET-HANDLING: the fixture secret is a constant byte pattern. The tests
 * assert the announcement never contains the minted value.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** Temp files of an interrupted key write hold the full secret, so they are ignored too. */
const TMP_IGNORE = `${RELAY_SECRET_FILE_NAME}.*.tmp`;

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
      `${RELAY_SECRET_FILE_NAME}\n${RELAY_KEY_META_FILE_NAME}\n${TMP_IGNORE}\n`,
    );
    expect(logs[0]).toContain('무시 규칙을 추가했습니다');
  });

  it('adds the ignore entry after existing lines without a trailing newline', async () => {
    const { files } = await mint('node_modules');
    expect(files.get(`${ROOT}/.gitignore`)).toBe(
      `node_modules\n${RELAY_SECRET_FILE_NAME}\n${RELAY_KEY_META_FILE_NAME}\n${TMP_IGNORE}\n`,
    );
  });

  it.each([RELAY_SECRET_FILE_NAME, `/${RELAY_SECRET_FILE_NAME}`, `**/${RELAY_SECRET_FILE_NAME}`])(
    'leaves .gitignore alone when it already has %s',
    async (line) => {
      const original = `dist\n${line}\n${RELAY_KEY_META_FILE_NAME}\n${TMP_IGNORE}\n`;
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

describe('ensureRelaySecret — two sessions minting at once', () => {
  it('real fs: every session ends with the one key on disk, and no temp file is left', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ait-mint-race-'));
    try {
      writeFileSync(join(root, 'package.json'), '{}');
      const envs: NodeJS.ProcessEnv[] = Array.from({ length: 8 }, () => ({}));
      await Promise.all(
        envs.map((env) => ensureRelaySecret({ projectRoot: root, env, log: () => {} })),
      );
      const onDisk = readFileSync(join(root, RELAY_SECRET_FILE_NAME), 'utf8').trim();
      expect(onDisk).toMatch(/^[0-9a-f]{64}$/);
      for (const env of envs) expect(env.AIT_DEBUG_TOTP_SECRET).toBe(onDisk);
      expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a reader never sees the key file empty: it is published complete or not at all', async () => {
    const files = new Map<string, string>([[`${ROOT}/package.json`, '{}']]);
    const seenAtLink: string[] = [];
    const fs: RelaySecretFs = {
      existsSync: (p) => files.has(p),
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: (p, data, o) => {
        if (o.flag === 'wx' && files.has(p))
          throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        files.set(p, data);
      },
      chmodSync: () => {},
      appendFileSync: (p, data) => files.set(p, (files.get(p) ?? '') + data),
      linkSync: (from, to) => {
        if (files.has(to)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        seenAtLink.push(files.get(from) ?? '');
        files.set(to, files.get(from) ?? '');
      },
      unlinkSync: (p) => {
        files.delete(p);
      },
    };
    const env: NodeJS.ProcessEnv = {};
    await ensureRelaySecret({
      projectRoot: ROOT,
      env,
      fs,
      existsSync: fs.existsSync,
      randomBytes: (n) => Buffer.alloc(n, 0xcd),
      log: () => {},
    });
    // The key file appeared through a link of an already complete temp file.
    expect(seenAtLink).toHaveLength(1);
    expect(seenAtLink[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(files.get(`${ROOT}/${RELAY_SECRET_FILE_NAME}`)).toBe(seenAtLink[0]);
    expect([...files.keys()].filter((k) => k.endsWith('.tmp'))).toEqual([]);
  });

  it("the loser of the link race reads the winner's key instead of replacing it", async () => {
    const files = new Map<string, string>([[`${ROOT}/package.json`, '{}']]);
    const winner = 'a'.repeat(64);
    const fs: RelaySecretFs = {
      // The key does not exist when the loser checks, and exists by the time it links.
      existsSync: (p) => files.has(p),
      readFileSync: (p) => files.get(p) ?? '',
      writeFileSync: (p, data) => {
        files.set(p, data);
      },
      chmodSync: () => {},
      appendFileSync: () => {},
      linkSync: () => {
        files.set(`${ROOT}/${RELAY_SECRET_FILE_NAME}`, winner);
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      },
      unlinkSync: (p) => {
        files.delete(p);
      },
    };
    const env: NodeJS.ProcessEnv = {};
    await ensureRelaySecret({
      projectRoot: ROOT,
      env,
      fs,
      existsSync: fs.existsSync,
      randomBytes: (n) => Buffer.alloc(n, 0xcd),
      log: () => {},
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(winner);
    expect(files.get(`${ROOT}/${RELAY_SECRET_FILE_NAME}`)).toBe(winner);
  });
});
