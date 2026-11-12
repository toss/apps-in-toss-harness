import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  bakedKeyRefusedMessage,
  builtOutputRefusedMessage,
  judgeBakedKeys,
  keyFingerprint,
  readBakedKeys,
  readClientEvidence,
  scanBuiltOutput,
} from '../built-output.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function project(
  files: Record<string, string | Buffer>,
  times: Record<string, number> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'ait-built-'));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    const t = times[rel];
    if (t !== undefined) utimesSync(p, t, t);
  }
  return root;
}

const crc32 = (buf: Buffer): number => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};

/** A minimal zip with one stored or deflated entry per file. */
function zip(entries: Record<string, string>, deflate = true): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'latin1');
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(deflate ? 8 : 0, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, eocd]);
}

const LEGACY_JS = 'var a="__ait_debug_status";var u="?p=1&v="+encodeURIComponent("0.2.0");';
const LEGACY_P2 = 'var a="__ait_debug_status";var u="?p=2&v=0.3.0";';
const CURRENT_JS = 'var a="__ait_debug_status";var u="?p=3&v="+encodeURIComponent("0.4.0");';
const LEGACY_NAMED = 'x="@apps-in-toss/debug-console";y="startDebugConsole";';

describe('readClientEvidence', () => {
  it('reads protocol and version next to a client marker', () => {
    expect(readClientEvidence(LEGACY_JS)).toEqual({ protocol: 1, version: '0.2.0' });
    expect(readClientEvidence(CURRENT_JS)).toMatchObject({ protocol: 3, version: '0.4.0' });
  });
  it('needs a marker and a protocol literal; a name alone is no evidence', () => {
    expect(readClientEvidence('var u="?p=1&v=0.2.0"')).toBeNull();
    expect(readClientEvidence('var a="__ait_debug_status"')).toBeNull();
    expect(readClientEvidence(LEGACY_NAMED)).toBeNull();
  });
});

describe('scanBuiltOutput', () => {
  it('is unknown for a project without output', () => {
    expect(scanBuiltOutput(project({ 'package.json': '{}' }))).toEqual({ status: 'unknown' });
    expect(scanBuiltOutput('/definitely/not/here')).toEqual({ status: 'unknown' });
  });

  it('refuses a legacy client in dist/web', () => {
    const root = project({ 'dist/web/assets/app.js': LEGACY_JS });
    expect(scanBuiltOutput(root)).toEqual({
      status: 'refused',
      path: 'dist/web/assets/app.js',
      client: '@apps-in-toss/debug-console',
      version: '0.2.0',
    });
  });

  it('refuses protocol 2 and ignores a name-only mention', () => {
    expect(scanBuiltOutput(project({ 'build/a.js': LEGACY_P2 })).status).toBe('refused');
    const named = scanBuiltOutput(project({ 'dist/a.html': `<script>${LEGACY_NAMED}</script>` }));
    expect(named).toEqual({ status: 'unknown' });
  });

  it('accepts a current client', () => {
    expect(scanBuiltOutput(project({ 'dist/web/a.js': CURRENT_JS }))).toEqual({
      status: 'ok',
      path: 'dist/web/a.js',
      version: '0.4.0',
      keys: [],
    });
  });

  it('skips node_modules and unrelated directories', () => {
    const root = project({
      'dist/node_modules/x/a.js': LEGACY_JS,
      'src/a.js': LEGACY_JS,
    });
    expect(scanBuiltOutput(root)).toEqual({ status: 'unknown' });
  });

  it('reads a deflated or stored .ait archive at the project root', () => {
    for (const deflate of [true, false]) {
      const root = project({
        'game.ait': zip({ 'web/index.html': '<html></html>', 'web/main.js': LEGACY_JS }, deflate),
      });
      expect(scanBuiltOutput(root)).toMatchObject({
        status: 'refused',
        path: 'game.ait',
        version: '0.2.0',
      });
    }
  });

  it('survives a damaged archive', () => {
    const root = project({ 'x.ait': Buffer.from('PK\u0003\u0004 not really a zip') });
    expect(scanBuiltOutput(root)).toEqual({ status: 'unknown' });
    const cut = zip({ 'a.js': LEGACY_JS }).subarray(0, 40);
    expect(scanBuiltOutput(project({ 'y.ait': cut }))).toEqual({ status: 'unknown' });
  });

  it('lets the newest file decide', () => {
    const root = project(
      {
        'old.ait': zip({ 'a.js': LEGACY_JS }),
        'dist/web/a.js': CURRENT_JS,
      },
      { 'old.ait': 1_700_000_000, 'dist/web/a.js': 1_800_000_000 },
    );
    expect(scanBuiltOutput(root)).toMatchObject({ status: 'ok', path: 'dist/web/a.js' });
    const reversed = project(
      { 'new.ait': zip({ 'a.js': LEGACY_JS }), 'dist/web/a.js': CURRENT_JS },
      { 'new.ait': 1_800_000_000, 'dist/web/a.js': 1_700_000_000 },
    );
    expect(scanBuiltOutput(reversed)).toMatchObject({ status: 'refused', path: 'new.ait' });
  });
});

describe('builtOutputRefusedMessage', () => {
  it('names the relative path and client, never an absolute path', () => {
    const text = builtOutputRefusedMessage(
      {
        status: 'refused',
        path: 'dist/web/a.js',
        client: '@apps-in-toss/debug-console',
        version: '0.2.0',
      },
      '0.4.1',
      'STEPS',
    );
    expect(text).toContain('QR을 발급하지 않았습니다');
    expect(text).toContain('빌드 산출물(dist/web/a.js)');
    expect(text).toContain('@apps-in-toss/debug-console 0.2.0');
    expect(text).toContain('STEPS');
    expect(text).not.toContain(tmpdir());
  });
});

const KEY_A = 'A'.repeat(87);
const KEY_B = 'B'.repeat(87);
const NOW = 1_800_000_000;

describe('readBakedKeys', () => {
  it('reads literals in object, JSON and escaped-JSON form, in either field order', () => {
    expect(readBakedKeys(`x=[{publicKey:"${KEY_A}",notAfter:1800000500}]`)).toEqual([
      { publicKey: KEY_A, notAfter: 1_800_000_500 },
    ]);
    expect(readBakedKeys(`{"publicKey":"${KEY_A}","notAfter":1800000500}`)).toEqual([
      { publicKey: KEY_A, notAfter: 1_800_000_500 },
    ]);
    expect(
      readBakedKeys(`JSON.parse('[{\\"publicKey\\":\\"${KEY_B}\\",\\"notAfter\\":1800000600}]')`),
    ).toEqual([{ publicKey: KEY_B, notAfter: 1_800_000_600 }]);
    expect(readBakedKeys(`{notAfter:1800000700,publicKey:"${KEY_A}"}`)).toEqual([
      { publicKey: KEY_A, notAfter: 1_800_000_700 },
    ]);
  });
  it('finds nothing in plain code', () => {
    expect(readBakedKeys('var publicKey = "short"; notAfter: 5')).toEqual([]);
  });
});

describe('scanBuiltOutput keys', () => {
  it('returns the keys of the same output as the newest client', () => {
    const root = project({
      'dist/web/a.js': CURRENT_JS,
      'dist/web/index.html': `<script>globalThis.__AIT_DEBUG_RELAY_KEYS__=[{"publicKey":"${KEY_A}","notAfter":1800000500}]</script>`,
    });
    expect(scanBuiltOutput(root)).toMatchObject({
      status: 'ok',
      keys: [{ publicKey: KEY_A, notAfter: 1_800_000_500 }],
    });
  });
  it('reads keys inside a .ait and keeps them apart from the directories', () => {
    const root = project(
      {
        'g.ait': zip({
          'web/a.js': CURRENT_JS,
          'web/index.html': `{publicKey:"${KEY_B}",notAfter:1800000900}`,
        }),
        'dist/old.html': `{publicKey:"${KEY_A}",notAfter:1800000500}`,
      },
      { 'g.ait': 1_800_000_000 },
    );
    expect(scanBuiltOutput(root)).toMatchObject({
      status: 'ok',
      path: 'g.ait',
      keys: [{ publicKey: KEY_B }],
    });
  });
  it('has no keys when none are pinned', () => {
    expect(scanBuiltOutput(project({ 'dist/a.js': CURRENT_JS }))).toMatchObject({ keys: [] });
  });
});

describe('judgeBakedKeys', () => {
  const live = [{ publicKey: KEY_A, notAfter: NOW + 3600 }];
  it('refuses a bundle without keys', () => {
    expect(judgeBakedKeys([], live, NOW)).toEqual({ status: 'no-keys' });
  });
  it('refuses expired keys, allowing the 300 s skew', () => {
    expect(judgeBakedKeys([{ publicKey: KEY_A, notAfter: NOW - 301 }], live, NOW).status).toBe(
      'expired',
    );
    expect(judgeBakedKeys([{ publicKey: KEY_A, notAfter: NOW - 299 }], live, NOW).status).toBe(
      'ok',
    );
  });
  it('refuses keys the key agent does not hold', () => {
    const v = judgeBakedKeys([{ publicKey: KEY_B, notAfter: NOW + 100 }], live, NOW);
    expect(v).toEqual({
      status: 'mismatch',
      baked: [keyFingerprint(KEY_B)],
      live: [keyFingerprint(KEY_A)],
    });
  });
  it('accepts a match, and skips the match when the agent cannot be asked', () => {
    expect(judgeBakedKeys([{ publicKey: KEY_A, notAfter: NOW + 100 }], live, NOW)).toEqual({
      status: 'ok',
    });
    expect(judgeBakedKeys([{ publicKey: KEY_B, notAfter: NOW + 100 }], null, NOW)).toEqual({
      status: 'ok',
    });
    expect(judgeBakedKeys([{ publicKey: KEY_B, notAfter: NOW + 100 }], [], NOW)).toEqual({
      status: 'ok',
    });
  });
});

describe('bakedKeyRefusedMessage', () => {
  it('prints fingerprints only, never key material', () => {
    for (const verdict of <Parameters<typeof bakedKeyRefusedMessage>[0][]>[
      { status: 'no-keys' } as const,
      { status: 'expired', fingerprints: [keyFingerprint(KEY_A)] } as const,
      {
        status: 'mismatch',
        baked: [keyFingerprint(KEY_B)],
        live: [keyFingerprint(KEY_A)],
      } as const,
    ]) {
      const text = bakedKeyRefusedMessage(verdict, 'dist/web/a.js', '0.4.0', '0.4.2', 'SKIP');
      expect(text).toContain('QR을 발급하지 않았습니다');
      expect(text).toContain('debugger inject-client');
      expect(text).toContain('SKIP');
      expect(text).not.toContain(KEY_A);
      expect(text).not.toContain(KEY_B);
    }
  });
});
