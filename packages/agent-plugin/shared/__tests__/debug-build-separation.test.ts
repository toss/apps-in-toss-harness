/**
 * debug-build-separation.test.ts
 *
 * 디버그 도구(debugger MCP, debugger-client)가 검수·출시 번들에 남지 않도록 skill 문서들이
 * 같은 계약을 가리키는지 지키는 불변식:
 *   - `__DEBUG_BUILD__`는 AIT_DEBUG_BUILD=1 명시에서만 온다 (옛 RELEASE_CHANNEL 신호 없음)
 *   - 디버그 배포 기록 파일 이름·마커 목록이 inject / test-on-device / launch / launch-scan.sh에서 일치
 *   - 최소 버전 단일 정본(min-versions.json)을 네 skill이 가리킨다
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(__dirname, '..');
const skills = path.join(shared, 'skills');
const read = (rel: string) => readFileSync(path.join(skills, rel), 'utf8');

const MARKERS = [
  '__ait_status_banner',
  '__ait_debug_status',
  'ait-attach',
  'relayPublicKeys',
  'startDebugConsole',
];
const RECORD = '.ait-debug-deployments.json';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const semver = (v: string) => v.split('.').map(Number) as [number, number, number];
const gte = (a: string, b: string) => {
  const x = semver(a);
  const y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

describe('AIT_DEBUG_BUILD 게이트', () => {
  it('옛 RELEASE_CHANNEL 신호가 shared/ 어디에도 남아 있지 않다', () => {
    for (const f of walk(shared)) {
      if (f.endsWith('.test.ts')) continue;
      expect(readFileSync(f, 'utf8'), path.relative(shared, f)).not.toContain('RELEASE_CHANNEL');
    }
  });

  it('inject debugger-client 문서는 define 값을 AIT_DEBUG_BUILD === 1 에서만 만들고 true 고정을 금한다', () => {
    const ref = read('inject/references/debugger-client.md');
    expect(ref).toContain("process.env.AIT_DEBUG_BUILD === '1'");
    expect(ref).toContain('AIT_DEBUG_BUILD=1 npm run build');
    expect(ref).toContain('devDependencies');
    // define 표의 값은 전부 debugBuild 변수에서 온다 (리터럴 true 없음)
    const table = ref.slice(
      ref.indexOf('| 번들러 | 넣는 곳 |'),
      ref.indexOf('디버그 빌드와 릴리즈 빌드는'),
    );
    expect(table).not.toMatch(/__DEBUG_BUILD__:\s*(JSON\.stringify\()?['"]?true/);
    expect(table.match(/debugBuild/g)?.length).toBeGreaterThanOrEqual(5);
    expect(ref).toContain("`'true'`로 고정");
  });

  it('inject 는 게이트 import 와 검증 grep 에 같은 마커 목록을 쓴다', () => {
    const ref = read('inject/references/debugger-client.md');
    for (const m of MARKERS) expect(ref).toContain(m);
    expect(ref).toContain('if (__DEBUG_BUILD__)');
  });
});

describe('디버그 배포 기록', () => {
  it('test-on-device 가 기록 절차와 .gitignore 줄을 정의하고 debug·launch 가 같은 파일을 가리킨다', () => {
    const rec = read('test-on-device/references/debug-builds.md');
    expect(rec).toContain(RECORD);
    expect(rec).toContain('.gitignore');
    for (const key of ['deploymentId', 'bundleVersion', 'recordedAt']) expect(rec).toContain(key);

    const tod = read('test-on-device/SKILL.md');
    expect(tod).toContain('references/debug-builds.md');
    expect(tod).toContain('검수에 제출하지 마세요');

    expect(read('debug/SKILL.md')).toContain(RECORD);
    expect(read('launch/SKILL.md')).toContain(RECORD);
    expect(read('inject/references/debugger-client.md')).toContain(RECORD);
  });

  it('test-on-device 는 기본이 릴리즈 빌드이고 디버깅할 때만 디버그 빌드를 올린다', () => {
    const tod = read('test-on-device/SKILL.md');
    expect(tod).toContain('릴리즈 빌드(기본)');
    expect(tod).toContain('사용자가 디버깅을 말하지 않았는데');
  });
});

describe('launch 하드 차단', () => {
  const launch = read('launch/SKILL.md');
  const script = read('launch/scripts/launch-scan.sh');

  it('SKILL.md 5단계 0번이 기록 대조와 산출물 마커를 둘 다 하드 차단으로 둔다', () => {
    expect(launch).toContain('하드 차단');
    expect(launch).toContain('launch-scan:debug-deployments');
    expect(launch).toContain('launch-scan:blocking');
    expect(launch).toContain('사용자가 승인해도');
  });

  it('마커 목록이 SKILL.md · launch-scan.sh · test-on-device 에서 같다', () => {
    const tod = read('test-on-device/SKILL.md');
    for (const m of MARKERS) {
      expect(launch, m).toContain(m);
      expect(script, m).toContain(m);
      expect(tod, m).toContain(m);
    }
    const sentinels = script.match(/^SENTINELS="([^"]+)"/m)?.[1].split(' ');
    expect(sentinels?.sort()).toEqual([...MARKERS].sort());
  });
});

describe('최소 버전 단일 정본', () => {
  const file = path.join(skills, 'setup-debugger/references/min-versions.json');
  const mins = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;

  it('min-versions.json 은 두 패키지의 semver 를 갖고 현재 알려진 발행본보다 낮지 않다', () => {
    expect(existsSync(file)).toBe(true);
    expect(mins['@apps-in-toss/debugger']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(mins['@apps-in-toss/debugger-client']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(gte(mins['@apps-in-toss/debugger'], '0.2.8')).toBe(true);
    expect(gte(mins['@apps-in-toss/debugger-client'], '0.2.1')).toBe(true);
  });

  it('runtime-floor(원격 차단 키)는 플러그인 최소 버전보다 높지 않다 — 발행 전 버전으로 현재 버전을 막지 않게', () => {
    const floor = mins['@apps-in-toss/debugger:runtime-floor'];
    expect(floor).toMatch(/^\d+\.\d+\.\d+$/);
    expect(gte(mins['@apps-in-toss/debugger'], floor)).toBe(true);
  });

  it('setup-debugger · debug · test-on-device · launch 가 min-versions.json 을 가리킨다', () => {
    const refs: Record<string, string> = {
      'setup-debugger/SKILL.md': 'min-versions.json',
      'debug/SKILL.md': 'min-versions.json',
      'test-on-device/SKILL.md': 'min-versions.json',
      'launch/SKILL.md': 'min-versions.json',
      'setup-debugger/references/upgrade-check.md': 'min-versions.json',
    };
    for (const [rel, needle] of Object.entries(refs)) expect(read(rel), rel).toContain(needle);
  });

  it('upgrade-check 는 최소 버전 미달을 URL 과 버전 표기 양쪽에서 다루고 ait-debugger 키를 바꾸지 않는다', () => {
    const up = read('setup-debugger/references/upgrade-check.md');
    expect(up).toContain('최소 버전 미달');
    expect(up).toContain('버전 표기');
    expect(up).toContain('node_modules/@apps-in-toss/debugger-client/package.json');
    expect(up).not.toContain('보안');
    expect(read('setup-debugger/SKILL.md')).toContain('"ait-debugger"');
  });
});
