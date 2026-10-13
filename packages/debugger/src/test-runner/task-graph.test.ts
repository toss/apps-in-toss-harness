/**
 * Locks the id scheme of the synthesised task graph. Vitest 5 no longer
 * publishes `@vitest/runner`, so the id helpers are local copies of the 4.x
 * implementation; these expectations pin the output so a drift is caught.
 */

import { describe, expect, it } from 'vitest';
import type { RunReport } from './runtime.js';
import { synthesizeFileTask, syntheticFileId, toTaskResultPacks } from './task-graph.js';

const report: RunReport = {
  startedAt: '2026-01-01T00:00:00.000Z',
  duration: 5,
  passed: 1,
  failed: 1,
  skipped: 1,
  tests: [
    { name: 'a > b > ok', status: 'pass', duration: 1 },
    { name: 'a > bad', status: 'fail', duration: 2, error: 'boom' },
    { name: 'top-skipped', status: 'skip', duration: 0 },
  ],
};

describe('task-graph ids', () => {
  it('builds position-based ids under a path+project hash file id', () => {
    const file = synthesizeFileTask('/proj/src/x.test.ts', '/proj', undefined, 'relay', report);
    expect(file.name).toBe('src/x.test.ts');
    expect(file.id).toBe(syntheticFileId('src/x.test.ts', undefined));
    expect(file.file).toBe(file);
    expect(file.tasks[0]?.id).toBe(`${file.id}_0`);
    expect(file.tasks[1]?.id).toBe(`${file.id}_1`);
    const packs = toTaskResultPacks(file).map(([id, result]) => [id, result?.state]);
    expect(packs).toContainEqual([`${file.id}_0_0_0`, 'pass']);
    expect(packs).toContainEqual([`${file.id}_0_1`, 'fail']);
  });

  it('keeps the string hash stable', () => {
    expect(syntheticFileId('', undefined)).toBe('0');
    expect(syntheticFileId('a', undefined)).toBe('97');
    expect(syntheticFileId('src/x.test.ts', 'p')).toBe(syntheticFileId('src/x.test.ts', 'p'));
  });
});
