/**
 * Path-safety tests for the report/capture artifact writers.
 *
 * `__AIT_CAPTURE__` category comes from the phone console (page-controlled), and
 * sdkLine/platform from CLI options — none may steer a write outside `dir`.
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RelayRunReport } from './relay-worker.js';
import {
  isSafeArtifactSegment,
  writeCaptureArtifacts,
  writeCaptureArtifactsDetailed,
  writeReportArtifact,
} from './report.js';

let sandbox: string;
let dir: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ait-report-'));
  dir = join(sandbox, 'out', '.ait-capture');
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

const cell = { sdkLine: '3.x', platform: 'ios' };
const line = (category: string) => ({ category, json: '[{"k":1}]' });

async function listAll(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort();
}

describe('isSafeArtifactSegment', () => {
  it('accepts plain names and rejects traversal / separators / dots', () => {
    for (const ok of ['device', '3.x', 'ios', 'a_b-c.d', 'x'.repeat(64)]) {
      expect(isSafeArtifactSegment(ok)).toBe(true);
    }
    for (const bad of [
      '',
      '.',
      '..',
      '../evil',
      '..\\evil',
      '/etc/passwd',
      'a/b',
      'a b',
      'a\nb',
      'x'.repeat(65),
      '한글',
    ]) {
      expect(isSafeArtifactSegment(bad)).toBe(false);
    }
    expect(isSafeArtifactSegment(undefined)).toBe(false);
    expect(isSafeArtifactSegment(42)).toBe(false);
  });
});

describe('writeCaptureArtifacts — category path traversal', () => {
  it('writes a valid category inside dir', async () => {
    const { written, skipped } = await writeCaptureArtifactsDetailed([line('device')], dir, cell);
    expect(skipped).toEqual([]);
    expect(written).toEqual([join(dir, 'device.3.x.ios.json')]);
    expect(JSON.parse(await readFile(written[0] as string, 'utf8'))).toEqual([{ k: 1 }]);
  });

  it('skips ../ and absolute-path categories, writes nothing outside dir, and notes them', async () => {
    const victim = join(sandbox, 'victim');
    const payloads = [
      '../../escaped',
      '..',
      '.',
      '../',
      '/etc/cron.d/evil',
      victim,
      '..\\..\\win',
      'a/../../b',
    ];
    const { written, skipped } = await writeCaptureArtifactsDetailed(
      [...payloads.map(line), line('ok')],
      dir,
      cell,
    );
    expect(written).toEqual([join(dir, 'ok.3.x.ios.json')]);
    expect(skipped).toHaveLength(payloads.length);
    for (const note of skipped) expect(note).not.toContain('\n');
    // Only the one safe file exists anywhere under the sandbox.
    expect(await listAll(sandbox)).toEqual([
      'out',
      'out/.ait-capture',
      'out/.ait-capture/ok.3.x.ios.json',
    ]);
  });

  it('writes nothing (not even dir) when every category is unsafe', async () => {
    const { written, skipped } = await writeCaptureArtifactsDetailed([line('../../x')], dir, cell);
    expect(written).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(await listAll(sandbox)).toEqual([]);
  });

  it('drops everything when sdkLine or platform is unsafe', async () => {
    for (const bad of [
      { sdkLine: '../..', platform: 'ios' },
      { sdkLine: '3.x', platform: '/abs/path' },
      { sdkLine: '3.x', platform: '..' },
    ]) {
      const { written, skipped } = await writeCaptureArtifactsDetailed([line('device')], dir, bad);
      expect(written).toEqual([]);
      expect(skipped).toHaveLength(1);
    }
    expect(await listAll(sandbox)).toEqual([]);
  });

  it('the string[] wrapper returns only written paths', async () => {
    const paths = await writeCaptureArtifacts([line('../bad'), line('good')], dir, cell);
    expect(paths).toEqual([join(dir, 'good.3.x.ios.json')]);
  });
});

describe('writeReportArtifact — cell name path safety', () => {
  const report: RelayRunReport = {
    startedAt: new Date(0).toISOString(),
    duration: 1,
    totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    files: [],
    captures: [],
  } as unknown as RelayRunReport;

  it('refuses a traversing sdkLine/platform before writing any file', async () => {
    await expect(
      writeReportArtifact(report, dir, { sdkLine: '../..', platform: 'ios', projectRoot: sandbox }),
    ).rejects.toThrow(/unsafe artifact name segment/);
    await expect(
      writeReportArtifact(report, dir, {
        sdkLine: '3.x',
        platform: '/tmp/abs',
        projectRoot: sandbox,
      }),
    ).rejects.toThrow(/unsafe artifact name segment/);
    expect((await listAll(sandbox)).filter((p) => p.endsWith('.json'))).toEqual([]);
  });

  it('still writes the normal cell file', async () => {
    const [out] = await writeReportArtifact(report, dir, {
      sdkLine: '3.x',
      platform: 'ios',
      projectRoot: sandbox,
    });
    expect(out).toBe(join(dir, '3.x.ios.json'));
  });
});
