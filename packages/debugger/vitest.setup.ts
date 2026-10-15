import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// 락 디렉터리는 항상 임시 디렉터리로 돌린다. 개발 머신에서 실제 debugger 데몬이 떠 있어도
// 테스트가 실제 ~/.ait-devtools/server.lock 을 읽거나 쓰지 않게 한다. 개별 테스트가
// AIT_DEVTOOLS_LOCK_DIR 을 따로 지정하면 그 값이 우선한다.
const dir = mkdtempSync(join(tmpdir(), 'ait-vitest-home-'));
process.env.AIT_DEVTOOLS_LOCK_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
