/**
 * upgrade-check.test.ts
 *
 * debugger 업그레이드 점검 경로의 불변식: welcome·setup-debugger·debug가 같은
 * reference를 가리키고, reference의 "기준 버전" 예시가 setup-debugger 4단계의
 * 고정 Release URL과 어긋나지 않는다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skills = path.join(__dirname, '..', 'skills');
const read = (rel: string) => readFileSync(path.join(skills, rel), 'utf8');

const URL_RE =
  /releases\/download\/debugger-v(\d+\.\d+\.\d+)\/apps-in-toss-debugger-(\d+\.\d+\.\d+)\.tgz/g;

describe('debugger upgrade-check 경로', () => {
  it('welcome·setup-debugger·debug가 upgrade-check.md를 참조한다', () => {
    for (const rel of ['welcome/SKILL.md', 'setup-debugger/SKILL.md', 'debug/SKILL.md']) {
      expect(read(rel), rel).toContain('references/upgrade-check.md');
    }
  });

  it('welcome은 ait-debugger 버전 점검을 제안만 하고 파일을 쓰지 않는다', () => {
    const welcome = read('welcome/SKILL.md');
    expect(welcome).toContain('ait-debugger');
    expect(welcome).toContain('어떤 파일도 쓰지 않는다');
  });

  it('setup-debugger의 고정 URL은 두 버전 필드가 같고 전부 한 버전이다', () => {
    const found = [...read('setup-debugger/SKILL.md').matchAll(URL_RE)];
    expect(found.length).toBeGreaterThan(0);
    for (const m of found) expect(m[1]).toBe(m[2]);
    expect(new Set(found.map((m) => m[1])).size).toBe(1);
  });

  it('upgrade-check의 기준 버전 예시가 setup-debugger의 고정 URL과 일치한다', () => {
    const pinned = [...read('setup-debugger/SKILL.md').matchAll(URL_RE)][0][1];
    const ref = read('setup-debugger/references/upgrade-check.md');
    expect(ref).toContain(`이 플러그인이 쓰는 버전은 ${pinned}입니다`);
    expect(ref).toContain(`.../debugger-v${pinned}/apps-in-toss-debugger-${pinned}.tgz`);
  });

  it('upgrade-check는 0.3.0 이하의 옛 이름(키·패키지·권한 규칙)을 새 이름으로 한꺼번에 옮기는 절차를 담는다', () => {
    const ref = read('setup-debugger/references/upgrade-check.md');
    for (const needle of [
      'mcpServers."ait-devtools"',
      '@apps-in-toss/debug-console',
      '@apps-in-toss/debugger-client',
      'mcp__ait-devtools__',
      'mcp__ait-debugger__',
      '프로토콜',
      '부분 업데이트',
    ]) {
      expect(ref, needle).toContain(needle);
    }
    expect(ref.replace(/\s+/g, ' ')).toContain('"미설치"가 아니라 "업그레이드 필요"');
  });

  it('최소 버전은 이름 변경 릴리스(0.3.1)다', () => {
    const mins = JSON.parse(read('setup-debugger/references/min-versions.json')) as Record<
      string,
      string
    >;
    expect(mins['@apps-in-toss/debugger']).toBe('0.3.1');
    expect(mins['@apps-in-toss/debugger-client']).toBe('0.3.1');
    expect(mins).not.toHaveProperty('@apps-in-toss/debug-console');
  });

  it('디버거를 찾는 skill은 옛 키·옛 패키지를 미설치가 아니라 업그레이드 대상으로 다룬다', () => {
    for (const rel of [
      'debug/SKILL.md',
      'setup-debugger/SKILL.md',
      'test-on-device/SKILL.md',
      'launch/SKILL.md',
      'inject/SKILL.md',
      'inject/references/debugger-client.md',
      'welcome/SKILL.md',
    ]) {
      const text = read(rel);
      expect(text, rel).toMatch(/ait-devtools|@apps-in-toss\/debug-console/);
    }
  });

  it('setup-debugger는 새 키가 이미 있어도 옛 이름 점검을 먼저 하고, 옛 이름이 없을 때만 "이미 배선됨"으로 끝낸다', () => {
    const text = read('setup-debugger/SKILL.md');
    const step3 = text.slice(text.indexOf('### 3.'), text.indexOf('### 4.'));
    const oldNameAt = step3.indexOf('mcpServers."ait-devtools"');
    const wiredAt = step3.indexOf('이미 배선됨');
    expect(oldNameAt).toBeGreaterThan(-1);
    expect(wiredAt).toBeGreaterThan(-1);
    expect(oldNameAt).toBeLessThan(wiredAt);
    expect(step3).toMatch(/옛 이름이 하나도 남아 있지 않은 상태/);
    expect(step3).toMatch(/부분 업데이트/);
  });
});
