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

  it('welcome은 ait-devtools 버전 점검을 제안만 하고 파일을 쓰지 않는다', () => {
    const welcome = read('welcome/SKILL.md');
    expect(welcome).toContain('ait-devtools');
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
});
