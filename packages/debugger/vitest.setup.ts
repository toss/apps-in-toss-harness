import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// 세션 레지스트리 디렉터리는 항상 임시 디렉터리로 돌린다. 개발 머신에서 실제 debugger 데몬이
// 떠 있어도 테스트가 실제 ~/.ait-debugger/sessions 를 읽거나 쓰지 않게 한다. 개별 테스트가
// AIT_DEBUGGER_STATE_DIR 을 따로 지정하면 그 값이 우선한다.
const dir = mkdtempSync(join(tmpdir(), 'ait-vitest-home-'));
process.env.AIT_DEBUGGER_STATE_DIR = dir;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// 원격 최소 버전 게이트가 테스트에서 실제 GitHub에 붙지 않게 URL을 닫힌 loopback 포트로 돌린다(fail-open이라
// 연결 거부는 unknown). 게이트를 직접 시험하는 테스트는 URL이나 fetch를 주입한다.
process.env.AIT_DEBUGGER_MIN_VERSIONS_URL = 'http://127.0.0.1:1/min-versions.json';

// relay 키 agent를 테스트에서 띄우지 않는다. 데몬 경로는 프로세스 메모리 키로 돌고(fallback),
// agent 자체를 시험하는 테스트는 임시 디렉터리와 주입한 경로를 직접 쓴다. 개발 머신의 실제
// ~/.ait-debugger 는 절대 건드리지 않는다.
process.env.AIT_DEBUGGER_KEY_AGENT = 'off';
process.env.AIT_DEBUGGER_KEY_AGENT_DIR = join(dir, 'key-agent');
