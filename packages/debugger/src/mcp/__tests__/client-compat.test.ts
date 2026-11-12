import { describe, expect, it } from 'vitest';
import {
  type ClientCompatFs,
  compatibleClientNote,
  compatRuleSentence,
  incompatibleClientMessage,
  inspectClientCompat,
  parseSpecVersion,
} from '../client-compat.js';

const ROOT = '/work/app';

function fakeFs(files: Record<string, unknown>): ClientCompatFs {
  return {
    readText: (p) => (p in files ? JSON.stringify(files[p]) : null),
  };
}

const client = (version: string) => ({
  [`${ROOT}/node_modules/@apps-in-toss/debugger-client/package.json`]: { version },
});
const legacy = (version: string) => ({
  [`${ROOT}/node_modules/@apps-in-toss/debug-console/package.json`]: { version },
});
const pkg = (deps: Record<string, string>) => ({
  [`${ROOT}/package.json`]: { name: 'app', devDependencies: deps },
});

describe('parseSpecVersion', () => {
  it('reads versions and range lower bounds', () => {
    expect(parseSpecVersion('0.4.0')).toBe('0.4.0');
    expect(parseSpecVersion('^0.4.1')).toBe('0.4.1');
    expect(parseSpecVersion('~0.3.0')).toBe('0.3.0');
    expect(parseSpecVersion('>=0.4.0 <0.5.0')).toBe('0.4.0');
  });

  it('reads the version out of a release tarball URL', () => {
    const base = 'https://example.test/releases/download';
    expect(
      parseSpecVersion(`${base}/debugger-client-v0.4.0/apps-in-toss-debugger-client-0.4.0.tgz`),
    ).toBe('0.4.0');
    expect(
      parseSpecVersion(`${base}/debug-console-v0.2.0/apps-in-toss-debug-console-0.2.0.tgz`),
    ).toBe('0.2.0');
    expect(parseSpecVersion(`${base}/x/apps-in-toss-debug-console-0.2.0.tgz`)).toBe('0.2.0');
  });

  it('gives null for specs without a readable version', () => {
    for (const spec of ['latest', 'workspace:*', 'file:../client', '^0.4', '', undefined, 4]) {
      expect(parseSpecVersion(spec)).toBeNull();
    }
  });
});

describe('inspectClientCompat', () => {
  it('refuses a project with only debug-console (installed)', () => {
    expect(inspectClientCompat(ROOT, fakeFs({ ...legacy('0.2.0'), ...pkg({}) }))).toEqual({
      status: 'incompatible',
      reason: 'legacy-only',
      version: '0.2.0',
    });
  });

  it('refuses a project that only declares debug-console, by version or by URL', () => {
    const url =
      'https://example.test/releases/download/debug-console-v0.2.0/apps-in-toss-debug-console-0.2.0.tgz';
    expect(inspectClientCompat(ROOT, fakeFs(pkg({ '@apps-in-toss/debug-console': url })))).toEqual({
      status: 'incompatible',
      reason: 'legacy-only',
      version: '0.2.0',
    });
    expect(
      inspectClientCompat(ROOT, fakeFs(pkg({ '@apps-in-toss/debug-console': 'latest' }))),
    ).toEqual({ status: 'incompatible', reason: 'legacy-only', version: null });
  });

  it('refuses a debugger-client below the minimum', () => {
    expect(inspectClientCompat(ROOT, fakeFs(client('0.3.0')))).toEqual({
      status: 'incompatible',
      reason: 'client-too-old',
      version: '0.3.0',
    });
    expect(
      inspectClientCompat(ROOT, fakeFs(pkg({ '@apps-in-toss/debugger-client': '^0.3.2' }))),
    ).toMatchObject({ status: 'incompatible', reason: 'client-too-old' });
  });

  it('accepts a compatible debugger-client, installed or declared', () => {
    expect(inspectClientCompat(ROOT, fakeFs(client('0.4.0')))).toEqual({
      status: 'compatible',
      version: '0.4.0',
    });
    expect(inspectClientCompat(ROOT, fakeFs(client('0.5.2')))).toMatchObject({
      status: 'compatible',
    });
    expect(
      inspectClientCompat(ROOT, fakeFs(pkg({ '@apps-in-toss/debugger-client': '^0.4.0' }))),
    ).toEqual({ status: 'compatible', version: '0.4.0' });
  });

  it('lets an installed debugger-client win over a leftover debug-console', () => {
    expect(inspectClientCompat(ROOT, fakeFs({ ...client('0.4.0'), ...legacy('0.2.0') }))).toEqual({
      status: 'compatible',
      version: '0.4.0',
    });
  });

  it('finds a client hoisted into a parent node_modules', () => {
    const files = {
      '/work/node_modules/@apps-in-toss/debugger-client/package.json': { version: '0.4.0' },
    };
    expect(inspectClientCompat(ROOT, fakeFs(files))).toMatchObject({ status: 'compatible' });
  });

  it('is unknown when nothing can be determined', () => {
    expect(inspectClientCompat(ROOT, fakeFs({}))).toEqual({ status: 'unknown' });
    expect(inspectClientCompat(ROOT, fakeFs(pkg({})))).toEqual({ status: 'unknown' });
    expect(
      inspectClientCompat(ROOT, fakeFs(pkg({ '@apps-in-toss/debugger-client': 'workspace:*' }))),
    ).toEqual({ status: 'unknown' });
  });

  it('is unknown, not a crash, for a malformed package.json', () => {
    const fs: ClientCompatFs = { readText: () => '{not json' };
    expect(inspectClientCompat(ROOT, fs)).toEqual({ status: 'unknown' });
  });
});

describe('compatibility messages', () => {
  it('states the refusal definitively and gives the fix, with no hedging and no path', () => {
    const text = incompatibleClientMessage(
      { status: 'incompatible', reason: 'legacy-only', version: '0.2.0' },
      '0.4.1',
    );
    expect(text).toContain('QR을 발급하지 않았습니다');
    expect(text).toContain('debugger 0.4.1은 debug-console(0.3.0 이하)을 연결하지 않습니다');
    expect(text).toContain('attach는 매번 실패합니다');
    expect(text).toContain('@apps-in-toss/debugger-client 0.4.0 이상');
    expect(text).toContain('/ait:setup-debugger');
    expect(text).toContain('/ait:test-on-device');
    expect(text).not.toMatch(/수 있|may/);
    expect(text).not.toContain('/work');
  });

  it('names the old client version when a debugger-client is too old', () => {
    const text = incompatibleClientMessage(
      { status: 'incompatible', reason: 'client-too-old', version: '0.3.0' },
      '0.4.1',
    );
    expect(text).toContain('@apps-in-toss/debugger-client 0.3.0');
    expect(text).toContain('최소 버전(0.4.0)');
  });

  it('has one definitive rule sentence and a bundle-order note', () => {
    const rule = compatRuleSentence('0.4.1');
    expect(rule).toContain('프로토콜 3');
    expect(rule).toContain('0.4.0 이상');
    expect(rule).toContain('항상 거부합니다');
    expect(rule).not.toMatch(/수 있/);
    expect(compatibleClientNote('0.4.0', '0.4.1')).toContain('빌드해 올린 것이어야');
  });
});
