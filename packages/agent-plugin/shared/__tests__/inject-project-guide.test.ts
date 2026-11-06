/**
 * inject-project-guide.test.ts
 *
 * design/scripts/inject-project-guide.sh 의 쓰기 안전을 fixture 로 검증한다.
 *   - 프로젝트 안의 심볼릭 링크(AGENTS.md·docs/·src/styles/)를 따라 프로젝트 밖에 쓰지 않는다
 *   - index.html 의 모듈 스크립트 경로가 `..` 로 프로젝트 밖을 가리켜도 거기에 쓰지 않는다
 *   - 따옴표가 든 프로젝트 경로가 코드로 해석되지 않는다
 *   - `..` 가 든 프로젝트 경로는 실제 경로로 풀려 정상 동작한다
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../skills/design/scripts/inject-project-guide.sh');

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 샌드박스(바깥 디렉터리) 하나를 만든다. 프로젝트는 그 안의 proj/, 프로젝트 밖 파일은 outside/ 에 둔다. */
function sandbox(): { root: string; proj: string; outside: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'inject-guide-')));
  tmpDirs.push(root);
  const proj = path.join(root, 'proj');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(proj);
  fs.mkdirSync(outside);
  return { root, proj, outside };
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function reactProject(proj: string): void {
  write(path.join(proj, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
  write(
    path.join(proj, 'index.html'),
    '<!doctype html>\n<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  write(path.join(proj, 'src/main.tsx'), "console.log('app');\n");
  write(path.join(proj, 'src/vite-env.d.ts'), '/// <reference types="vite/client" />\n');
}

function run(proj: string): string {
  const out = execFileSync('bash', [SCRIPT, proj], { encoding: 'utf8' });
  return out.trimEnd().split('\n').pop() ?? '';
}

describe('inject-project-guide.sh 쓰기 안전', () => {
  it('정상 프로젝트: 파일을 심고, 다시 돌리면 전부 skip 한다', () => {
    const { proj } = sandbox();
    reactProject(proj);

    const first = run(proj);
    expect(first).toMatch(/guide=new/);
    expect(first).toMatch(/tokens=new/);
    expect(first).toMatch(/base=new/);
    expect(first).toMatch(/icons=new/);
    expect(first).toMatch(/agents=new/);
    expect(first).toMatch(/claude=new/);
    expect(first).not.toMatch(/unsafe|FAIL/);
    expect(fs.readFileSync(path.join(proj, 'src/main.tsx'), 'utf8')).toContain('styles/base.css');

    const second = run(proj);
    expect(second).toMatch(/guide=skip/);
    expect(second).toMatch(/tokens=skip/);
    expect(second).toMatch(/entry=skip/);
    expect(second).not.toMatch(/=new/);
  });

  it('AGENTS.md·CLAUDE.md 가 프로젝트 밖을 가리키는 심볼릭 링크면 쓰지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    const target = path.join(outside, 'victim.txt');
    write(target, 'original\n');
    fs.symlinkSync(target, path.join(proj, 'AGENTS.md'));
    fs.symlinkSync(target, path.join(proj, 'CLAUDE.md'));

    const summary = run(proj);

    expect(summary).toMatch(/agents=unsafe/);
    expect(summary).toMatch(/claude=unsafe/);
    expect(fs.readFileSync(target, 'utf8')).toBe('original\n');
  });

  it('깨진(dangling) 심볼릭 링크도 따라가서 파일을 만들지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    const target = path.join(outside, 'not-yet.txt');
    fs.symlinkSync(target, path.join(proj, 'AGENTS.md'));

    expect(run(proj)).toMatch(/agents=unsafe/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('docs/ 가 프로젝트 밖 디렉터리로 가는 링크면 그 안에 가이드를 쓰지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    fs.symlinkSync(outside, path.join(proj, 'docs'));

    expect(run(proj)).toMatch(/guide=unsafe/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('src/styles/ 가 프로젝트 밖 디렉터리로 가는 링크면 CSS 를 쓰지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    fs.symlinkSync(outside, path.join(proj, 'src/styles'));

    const summary = run(proj);

    expect(summary).toMatch(/tokens=unsafe/);
    expect(summary).toMatch(/base=unsafe/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('src/components/ 가 프로젝트 밖으로 가는 링크면 아이콘을 쓰지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    fs.symlinkSync(outside, path.join(proj, 'src/components'));

    expect(run(proj)).toMatch(/icons=unsafe/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('진입 파일이 프로젝트 밖을 가리키는 심볼릭 링크면 거기에 import 를 끼우지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    const target = path.join(outside, 'entry.tsx');
    write(target, "console.log('outside');\n");
    fs.rmSync(path.join(proj, 'src/main.tsx'));
    fs.symlinkSync(target, path.join(proj, 'src/main.tsx'));

    run(proj);

    expect(fs.readFileSync(target, 'utf8')).toBe("console.log('outside');\n");
  });

  it('index.html 의 모듈 스크립트가 `..` 로 프로젝트 밖을 가리켜도 거기에 쓰지 않는다', () => {
    const { proj, outside } = sandbox();
    reactProject(proj);
    const target = path.join(outside, 'evil.tsx');
    write(target, "console.log('outside');\n");
    write(
      path.join(proj, 'index.html'),
      '<!doctype html>\n<html><head></head><body><script type="module" src="../outside/evil.tsx"></script></body></html>\n',
    );
    // src/ 아래 알려진 진입 파일도 없애, 후보가 `..` 경로뿐인 상황을 만든다
    fs.rmSync(path.join(proj, 'src/main.tsx'));

    const summary = run(proj);

    expect(fs.readFileSync(target, 'utf8')).toBe("console.log('outside');\n");
    expect(summary).not.toMatch(/entry=js/);
  });

  it('따옴표가 든 프로젝트 경로가 코드로 해석되지 않는다(React 프로젝트로 판정된다)', () => {
    const { root } = sandbox();
    const proj = path.join(root, "it's a proj");
    fs.mkdirSync(proj);
    reactProject(proj);

    const summary = run(proj);

    // 경로가 JS 코드에 끼면 판정이 깨져 SVG 경로(아이콘 디렉터리)로 떨어진다
    expect(summary).toMatch(/icons=new/);
    expect(fs.existsSync(path.join(proj, 'src/components/icons.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(proj, 'src/assets/icons'))).toBe(false);
  });

  it('`..` 가 든 프로젝트 경로는 실제 경로로 풀려 정상 동작한다', () => {
    const { root, proj } = sandbox();
    reactProject(proj);
    fs.mkdirSync(path.join(root, 'other'));

    const summary = run(`${root}/other/../proj`);

    expect(summary).toMatch(/guide=new/);
    expect(fs.existsSync(path.join(proj, 'AGENTS.md'))).toBe(true);
  });
});
