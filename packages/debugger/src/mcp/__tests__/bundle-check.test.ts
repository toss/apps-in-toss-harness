import { describe, expect, it } from 'vitest';
import {
  type BundleCheckFs,
  DEBUG_DEPLOYMENTS_FILE,
  inspectDebugBundle,
  staleBundleMessage,
} from '../bundle-check.js';

const ROOT = '/work/app';
const RECORD = `${ROOT}/${DEBUG_DEPLOYMENTS_FILE}`;
const CLIENT_PKG = `${ROOT}/node_modules/@apps-in-toss/debugger-client/package.json`;

function fakeFs(files: Record<string, string>, mtimes: Record<string, number> = {}): BundleCheckFs {
  return {
    readText: (p) => files[p] ?? null,
    mtimeMs: (p) => mtimes[p] ?? null,
  };
}

const rec = (...deployments: Record<string, unknown>[]) =>
  JSON.stringify({ version: 1, deployments });
const T = (iso: string) => Date.parse(iso);

describe('inspectDebugBundle', () => {
  it('is ok without a record', () => {
    expect(inspectDebugBundle(ROOT, null, fakeFs({}))).toEqual({ status: 'ok' });
  });

  it('ignores a corrupt or odd record', () => {
    for (const text of [
      '{not json',
      '[]',
      '{"deployments": 3}',
      'null',
      '{"deployments":[1,"x",null]}',
    ]) {
      expect(inspectDebugBundle(ROOT, 'a', fakeFs({ [RECORD]: text }))).toEqual({ status: 'ok' });
    }
  });

  it('refuses when the latest build recorded debug-console', () => {
    const fs = fakeFs({
      [RECORD]: rec({
        appName: 'a',
        bundleVersion: '1.2',
        recordedAt: '2026-01-02T00:00:00Z',
        debuggerClient: { name: '@apps-in-toss/debug-console', version: '0.2.0' },
      }),
    });
    expect(inspectDebugBundle(ROOT, 'a', fs)).toEqual({
      status: 'stale',
      reason: 'recorded-client',
      client: '@apps-in-toss/debug-console',
      clientVersion: '0.2.0',
      bundleVersion: '1.2',
    });
  });

  it('refuses a recorded debugger-client below the minimum and accepts the minimum', () => {
    const mk = (version: string) =>
      fakeFs({
        [RECORD]: rec({
          appName: 'a',
          recordedAt: '2026-01-02T00:00:00Z',
          debuggerClient: { name: '@apps-in-toss/debugger-client', version },
        }),
      });
    expect(inspectDebugBundle(ROOT, 'a', mk('0.3.2')).status).toBe('stale');
    expect(inspectDebugBundle(ROOT, 'a', mk('0.4.0'))).toEqual({ status: 'ok' });
    expect(inspectDebugBundle(ROOT, 'a', mk('weird'))).toEqual({ status: 'ok' });
  });

  it('judges by the most recent record, not the file order', () => {
    const fs = fakeFs({
      [RECORD]: rec(
        {
          appName: 'a',
          recordedAt: '2026-02-01T00:00:00Z',
          debuggerClient: { name: '@apps-in-toss/debugger-client', version: '0.4.0' },
        },
        {
          appName: 'a',
          recordedAt: '2026-01-01T00:00:00Z',
          debuggerClient: { name: '@apps-in-toss/debug-console', version: '0.2.0' },
        },
      ),
    });
    expect(inspectDebugBundle(ROOT, 'a', fs)).toEqual({ status: 'ok' });
  });

  it('prefers records of the project app and falls back to the newest overall', () => {
    const stale = {
      appName: 'mine',
      recordedAt: '2026-01-01T00:00:00Z',
      debuggerClient: { name: '@apps-in-toss/debug-console', version: '0.2.0' },
    };
    const otherNewer = {
      appName: 'other',
      recordedAt: '2026-03-01T00:00:00Z',
      debuggerClient: { name: '@apps-in-toss/debugger-client', version: '0.4.0' },
    };
    const fs = fakeFs({ [RECORD]: rec(stale, otherNewer) });
    expect(inspectDebugBundle(ROOT, 'mine', fs).status).toBe('stale');
    expect(inspectDebugBundle(ROOT, null, fs)).toEqual({ status: 'ok' });
    // No record for this app name: the newest overall decides.
    expect(inspectDebugBundle(ROOT, 'nobody', fs)).toEqual({ status: 'ok' });
  });

  describe('records without debuggerClient', () => {
    const old = { appName: 'a', bundleVersion: '9', recordedAt: '2026-01-01T00:00:00Z' };

    it('refuses when the installed client is newer than the record', () => {
      const fs = fakeFs({ [RECORD]: rec(old) }, { [CLIENT_PKG]: T('2026-01-02T00:00:00Z') });
      expect(inspectDebugBundle(ROOT, 'a', fs)).toEqual({
        status: 'stale',
        reason: 'built-before-client',
        bundleVersion: '9',
      });
    });

    it('is ok when the record is newer than the installed client', () => {
      const fs = fakeFs({ [RECORD]: rec(old) }, { [CLIENT_PKG]: T('2025-12-31T00:00:00Z') });
      expect(inspectDebugBundle(ROOT, 'a', fs)).toEqual({ status: 'ok' });
    });

    it('is ok when the client mtime or recordedAt is unknown', () => {
      expect(inspectDebugBundle(ROOT, 'a', fakeFs({ [RECORD]: rec(old) }))).toEqual({
        status: 'ok',
      });
      const noTime = fakeFs(
        { [RECORD]: rec({ appName: 'a' }) },
        { [CLIENT_PKG]: T('2026-01-02T00:00:00Z') },
      );
      expect(inspectDebugBundle(ROOT, 'a', noTime)).toEqual({ status: 'ok' });
    });

    it('finds the client in an ancestor node_modules', () => {
      const parent = '/work/node_modules/@apps-in-toss/debugger-client/package.json';
      const fs = fakeFs({ [RECORD]: rec(old) }, { [parent]: T('2026-01-02T00:00:00Z') });
      expect(inspectDebugBundle(ROOT, 'a', fs).status).toBe('stale');
    });
  });
});

describe('staleBundleMessage', () => {
  it('names the recorded client, the rebuild steps and the escape hatch, without secrets', () => {
    const text = staleBundleMessage(
      {
        status: 'stale',
        reason: 'recorded-client',
        client: '@apps-in-toss/debug-console',
        clientVersion: '0.2.0',
        bundleVersion: '1.2',
      },
      '0.4.1',
    );
    expect(text).toContain('QR을 발급하지 않았습니다');
    expect(text).toContain('번들 1.2');
    expect(text).toContain('@apps-in-toss/debug-console 0.2.0');
    expect(text).toContain('/ait:test-on-device');
    expect(text).toContain('skipBundleCheck: true');
    expect(text).not.toContain('/work');
  });

  it('explains the older-record case', () => {
    const text = staleBundleMessage(
      { status: 'stale', reason: 'built-before-client', bundleVersion: '' },
      '0.4.1',
    );
    expect(text).toContain('설치(또는 업그레이드)하기 전에 만든');
    expect(text).not.toContain('번들 )');
  });
});
