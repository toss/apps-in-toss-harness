/**
 * launch-scan.test.ts
 *
 * launch skill 2단계의 읽기 전용 스캔 스크립트(launch-scan.sh)를 fixture 로 검증한다.
 *
 * 구조:
 *   mkFixture(files) — os.tmpdir() 아래에 임시 프로젝트를 fs 로 직접 만들고 afterEach 에서 지운다.
 *   scan(dir)        — `bash launch-scan.sh <dir>` 실행. 비 0 종료면 execFileSync 가 던지므로
 *                      "항상 exit 0" 계약이 모든 테스트에서 암묵적으로 단언된다.
 *   heads(out)       — 후보 줄에서 `[규칙 id] 경로:줄` 머리만 뽑는다. 설명 문구는 필요한 곳에서만
 *                      따로 단언한다(위치가 계약이고 문구는 사람이 읽는 부분이다).
 *
 * 키처럼 생긴 리터럴은 소스에 쓰지 않는다 — GitHub push protection 이 repo 텍스트를 스캔한다.
 * 가짜 키와 가짜 env 값은 전부 런타임에 조립한다.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../skills/launch/scripts/launch-scan.sh');

const FAKE_SK = `sk-${'a'.repeat(24)}`;
const FAKE_AIZA = `AIza${'B'.repeat(35)}`;
const FAKE_ENV_VALUE = `envval-${'x'.repeat(12)}`;

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** 줄 목록 → 파일 내용 (줄 번호를 소스에서 그대로 셀 수 있게 한다). */
function L(...rows: string[]): string {
  return `${rows.join('\n')}\n`;
}

function mkFixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-scan-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

function scan(dir: string): string {
  return execFileSync('bash', [SCRIPT, dir], { encoding: 'utf8' });
}

/** 후보 줄(`[` 로 시작)만. */
function candidates(out: string): string[] {
  return out.split('\n').filter((l) => l.startsWith('['));
}

/** 후보 줄의 `[규칙 id] 경로:줄` 머리. */
function heads(out: string): string[] {
  return candidates(out).map((l) => l.split(' ').slice(0, 2).join(' '));
}

/** `경로:줄` 위치의 후보 줄 전체. */
function lineAt(out: string, loc: string): string {
  const found = candidates(out).find((l) => l.split(' ')[1] === loc);
  if (!found) throw new Error(`후보 없음: ${loc}\n${out}`);
  return found;
}

function summary(out: string): string {
  const rows = out.trimEnd().split('\n');
  return rows[rows.length - 1];
}

/** 디렉터리 트리의 (경로, 크기, mtime, 내용) 스냅샷 — 스캔 전후 비교용. */
function snapshot(root: string): string[] {
  const rows: string[] = [`d . ${fs.statSync(root).mtimeMs}`];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        rows.push(`d ${rel} ${st.mtimeMs}`);
        walk(abs);
      } else {
        rows.push(`f ${rel} ${st.size} ${st.mtimeMs} ${fs.readFileSync(abs, 'utf8')}`);
      }
    }
  };
  walk(root);
  return rows;
}

const HTML_OK = L(
  '<!doctype html>',
  '<html lang="ko">',
  '  <head>',
  '    <meta charset="UTF-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
  '  </head>',
  '  <body><div id="root"></div></body>',
  '</html>',
);

/** 네 규칙을 모두 건드리는 프로젝트. */
function violatingFiles(): Record<string, string> {
  return {
    // 규칙 1: 5줄의 viewport 에 제한이 없다
    'index.html': L(
      '<!doctype html>',
      '<html lang="ko">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>app</title>',
      '  </head>',
      '  <body><div id="root"></div></body>',
      '</html>',
    ),
    // 규칙 2: 1줄의 color-scheme: light 는 후보가 아니고 2줄만 후보다
    'src/index.css': L(
      ':root { color-scheme: light; }',
      '@media (prefers-color-scheme: dark) {',
      '  body { background: #000; }',
      '}',
    ),
    // 규칙 3: 헤더 값 '*' 와 인자 없는 cors()
    'worker/src/index.ts': L(
      'export default {',
      '  async fetch(): Promise<Response> {',
      "    return new Response('ok', {",
      "      headers: { 'Access-Control-Allow-Origin': '*' },",
      '    });',
      '  },',
      '};',
    ),
    'server/app.ts': L(
      "import express from 'express';",
      "import cors from 'cors';",
      'const app = express();',
      'app.use(cors());',
    ),
    // 규칙 4(a)(c): 환경변수 참조와 AI API 직접 호출
    'src/lib/summary.ts': L(
      'export async function summarize(text: string) {',
      '  const key = import.meta.env.VITE_OPENAI_API_KEY;',
      "  const res = await fetch('https://api.openai.com/v1/chat/completions', {",
      '    headers: { Authorization: bearer(key) },',
      '  });',
      '  return res.json();',
      '}',
    ),
    // 규칙 4(b): .env 정의 (값은 출력되면 안 된다)
    '.env.local': L(`VITE_OPENAI_API_KEY=${FAKE_ENV_VALUE}`),
    // 규칙 4(d): 빌드 산출물과 public 의 키 형태 문자열
    'dist/assets/index.js': L(`const k="${FAKE_SK}";console.log(k);`),
    'public/config.js': L(`window.__CFG = { g: '${FAKE_AIZA}' };`),
  };
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('launch-scan.sh', () => {
  it('위반 fixture: 네 규칙이 기대한 파일:줄에서 후보를 내고 키 값은 찍지 않는다', () => {
    const out = scan(mkFixture(violatingFiles()));

    expect(heads(out)).toEqual([
      '[viewport-zoom] index.html:5',
      '[dark-theme] src/index.css:2',
      '[cors-any-origin] server/app.ts:4',
      '[cors-any-origin] worker/src/index.ts:4',
      '[client-ai-key] .env.local:1',
      '[client-ai-key] dist/assets/index.js:1',
      '[client-ai-key] public/config.js:1',
      '[client-ai-key] src/lib/summary.ts:2',
      '[client-ai-key] src/lib/summary.ts:3',
    ]);
    expect(summary(out)).toBe(
      'launch-scan:viewport-zoom=1 dark-theme=1 cors-any-origin=2 client-ai-key=5 total=9',
    );

    // 설명에는 변수 이름·호스트·접두사 라벨만 실린다
    expect(lineAt(out, '.env.local:1')).toContain('(VITE_OPENAI_API_KEY)');
    expect(lineAt(out, 'src/lib/summary.ts:2')).toContain('(VITE_OPENAI_API_KEY)');
    expect(lineAt(out, 'src/lib/summary.ts:3')).toContain('(api.openai.com)');
    expect(lineAt(out, 'dist/assets/index.js:1')).toContain('(sk-…)');
    expect(lineAt(out, 'public/config.js:1')).toContain('(AIza…)');

    // 키 본문과 env 값은 stdout 어디에도 없다
    for (const secret of [
      FAKE_SK,
      'a'.repeat(24),
      FAKE_AIZA,
      'B'.repeat(35),
      FAKE_ENV_VALUE,
      'x'.repeat(12),
    ]) {
      expect(out).not.toContain(secret);
    }
  });

  it('깨끗한 fixture: 후보 0건, total=0', () => {
    const dir = mkFixture({
      'index.html': HTML_OK,
      // 라이트 전용 CSS
      'src/index.css': L(':root { color-scheme: light; }', 'body { background: #fff; }'),
      // origin 을 좁게 지정한 서버
      'server/app.ts': L(
        "import cors from 'cors';",
        "app.use(cors({ origin: ['https://example.com'] }));",
      ),
      // 자기 서버 경로만 부르는 클라이언트
      'src/lib/summary.ts': L("const res = await fetch('/api/summary', { method: 'POST' });"),
      // AI 키가 아닌 클라이언트 변수
      '.env': L('VITE_API_BASE_URL=https://example.com/api'),
    });
    const out = scan(dir);

    expect(candidates(out)).toEqual([]);
    expect(out).toBe(
      'launch-scan:viewport-zoom=0 dark-theme=0 cors-any-origin=0 client-ai-key=0 total=0\n',
    );
  });

  it('프로젝트 디렉터리가 없으면 missing 한 줄만 찍고 정상 종료한다', () => {
    const missing = path.join(os.tmpdir(), `launch-scan-missing-${process.pid}-${Date.now()}`);
    expect(scan(missing)).toBe(`launch-scan:proj=missing(${missing})\n`);
  });

  it('제외 디렉터리(node_modules 등) 안의 매치는 어느 깊이에서도 보고하지 않는다', () => {
    const excluded = [
      'node_modules',
      '.git',
      'build',
      '.wrangler',
      '.next',
      '.turbo',
      '.vercel',
      '.output',
      'coverage',
      'out',
      '.cache',
    ];
    const files: Record<string, string> = {
      // dist/ 는 규칙 4(d) 말고는 보지 않는다
      'dist/index.js': L(
        'app.use(cors());',
        'const e = import.meta.env.VITE_OPENAI_API_KEY;',
        'fetch("https://api.openai.com/v1");',
      ),
    };
    for (const d of excluded) {
      files[`${d}/lib.js`] = L('app.use(cors());', '@media (prefers-color-scheme: dark) {}');
      files[`src/${d}/client.js`] = L(
        'const e = import.meta.env.VITE_OPENAI_API_KEY;',
        'fetch("https://api.openai.com/v1");',
        `const s = "${FAKE_SK}";`,
      );
      files[`public/${d}/page.html`] = L('<meta name="viewport" content="width=device-width">');
    }
    const out = scan(mkFixture(files));

    expect(candidates(out)).toEqual([]);
    expect(summary(out)).toBe(
      'launch-scan:viewport-zoom=skip(no-html) dark-theme=0 cors-any-origin=0 client-ai-key=0 total=0',
    );
    expect(out).not.toContain('node_modules');
  });

  it('루트 *.html 도 public/**/*.html 도 없으면 viewport-zoom=skip(no-html)이고 total 에 안 센다', () => {
    const dir = mkFixture({
      'src/main.ts': L('export {};'),
      // 대상이 아닌 위치의 HTML 은 없는 것으로 친다
      'src/legacy.html': L('<meta name="viewport" content="width=device-width">'),
      'dist/index.html': L('<meta name="viewport" content="width=device-width">'),
      'server/app.ts': L('app.use(cors());'),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual(['[cors-any-origin] server/app.ts:1']);
    expect(summary(out)).toBe(
      'launch-scan:viewport-zoom=skip(no-html) dark-theme=0 cors-any-origin=1 client-ai-key=0 total=1',
    );
  });

  it('읽기 전용: 스캔 전후로 프로젝트 트리가 그대로다', () => {
    const dir = mkFixture(violatingFiles());
    const before = snapshot(dir);
    scan(dir);
    scan(dir);
    expect(snapshot(dir)).toEqual(before);
  });

  it('prefers-color-scheme: dark 한 줄은 한 번만 보고한다', () => {
    const dir = mkFixture({
      'src/a.css': L('@media (prefers-color-scheme: dark) {', '  body { color: #fff; }', '}'),
      // prefers-color-scheme: dark 와 color-scheme: dark 가 한 줄에 같이 있어도 한 줄
      'src/b.css': L('@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }'),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual(['[dark-theme] src/a.css:1', '[dark-theme] src/b.css:1']);
    expect(summary(out)).toContain('dark-theme=2 ');
  });

  it('다크 모드 패턴: color-scheme 값에 dark 가 있거나 meta color-scheme 에 dark 가 있을 때만 잡는다', () => {
    const dir = mkFixture({
      'src/theme.css': L(
        ':root { color-scheme: light dark; }', // 1 잡음
        ':root { color-scheme: light; }', // 2 안 잡음
        '@media (prefers-color-scheme: light) { a { color: red; } }', // 3 안 잡음
        '.x { color-scheme : dark }', // 4 잡음 (콜론 앞 공백)
        ':root { color-scheme: light; background: dark-gray; }', // 5 안 잡음 (세미콜론 뒤)
      ),
      'index.html': L(
        '<head>',
        '<meta name="color-scheme" content="light dark">', // 2 잡음
        '<meta content="dark light" name="color-scheme">', // 3 잡음 (속성 순서 반대)
        '<meta name="color-scheme" content="light">', // 4 안 잡음
        '<meta name="viewport" content="width=device-width, user-scalable=no">',
        '</head>',
      ),
      'src/theme.ts': L("window.matchMedia('(prefers-color-scheme: dark)');"), // 1 잡음
      // 확장자 목록 밖
      'src/theme.py': L('x = "prefers-color-scheme: dark"'),
    });

    expect(heads(scan(dir))).toEqual([
      '[dark-theme] index.html:2',
      '[dark-theme] index.html:3',
      '[dark-theme] src/theme.css:1',
      '[dark-theme] src/theme.css:4',
      '[dark-theme] src/theme.ts:1',
    ]);
  });

  it('viewport: 제한이 없는 meta 만 후보이고, 속성 순서·따옴표·대소문자·3줄 태그를 읽는다', () => {
    const dir = mkFixture({
      // 제한 있음 — 속성 순서 반대, 대문자, user-scalable=0
      'index.html': L(
        '<!doctype html>',
        '<META CONTENT="width=device-width, USER-SCALABLE=0" NAME="viewport">',
      ),
      // 제한 있음 — 작은따옴표, maximum-scale=1.0
      'public/a.html': L("<meta name='viewport' content='width=device-width, maximum-scale=1.0'>"),
      // 제한 있음 — 태그가 3줄에 걸치고 제한이 셋째 줄에 있다
      'public/b.html': L(
        '<meta',
        '  name="viewport"',
        '  content="width=device-width, user-scalable=no" />',
      ),
      // 제한 없음 — 2줄에서 시작해 3줄에 걸친 태그, 후보는 <meta 가 있는 2줄
      'public/d.html': L(
        '<head>',
        '<meta',
        '  name="viewport"',
        '  content="width=device-width, initial-scale=1"',
        '/>',
      ),
      // 제한 없음 — maximum-scale=10 은 maximum-scale=1 이 아니다
      'public/sub/e.html': L(
        '<meta name="viewport" content="width=device-width, maximum-scale=10">',
      ),
      // 제한 없음 — 한 줄에 meta 가 둘
      'public/sub/f.html': L(
        '<meta charset="utf-8"><meta name="viewport" content="width=device-width">',
      ),
      // viewport meta 가 없어도 index.html 이 아니면 후보가 아니다
      'public/g.html': L('<html><body>no meta</body></html>'),
      // src/ 안의 HTML 은 대상이 아니다
      'src/page.html': L('<meta name="viewport" content="width=device-width">'),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual([
      '[viewport-zoom] public/d.html:2',
      '[viewport-zoom] public/sub/e.html:1',
      '[viewport-zoom] public/sub/f.html:1',
    ]);
    expect(lineAt(out, 'public/d.html:2')).toContain('확대·축소 제한(user-scalable=no 또는');
    expect(summary(out)).toContain('viewport-zoom=3 ');
  });

  it('viewport: 루트 index.html 에 viewport meta 가 아예 없으면 index.html:1 이 후보다', () => {
    const dir = mkFixture({
      'index.html': L('<!doctype html>', '<html><head><title>x</title></head></html>'),
      'public/other.html': L('<p>meta 없는 보조 HTML 은 후보가 아니다</p>'),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual(['[viewport-zoom] index.html:1']);
    expect(lineAt(out, 'index.html:1')).toContain('viewport meta가 없다');
  });

  it('CORS: 헤더·옵션·origin: true·cors()·allow_origins 형태는 잡고 좁은 origin 은 안 잡는다', () => {
    const dir = mkFixture({
      'server/forms.ts': L(
        "res.setHeader('Access-Control-Allow-Origin', '*');", // 1
        'res.headers.set("Access-Control-Allow-Origin", "*");', // 2
        "headers.append('access-control-allow-origin', '*');", // 3
        "const h = { 'Access-Control-Allow-Origin': '*' };", // 4
        "app.use(cors({ origin: '*' }));", // 5
        'app.use(cors());', // 6
        "app.use(cors({ origin: ['https://example.com'] }));", // 7 안 잡음
        "res.setHeader('Access-Control-Allow-Origin', 'https://example.com');", // 8 안 잡음
        'app.use(foo.cors());', // 9 안 잡음 (앞이 점)
        'window.postMessage(message, "*");', // 10 안 잡음
        "const o = { targetOrigin: '*' };", // 11 안 잡음 (origin 앞이 영문자)
        'app.use(cors({ origin: true, credentials: true }));', // 12 (요청 origin 반사)
        'const p = { origin: trueOrigin };', // 13 안 잡음 (true 뒤가 식별자)
      ),
      'api/app.py': L(
        "response.headers['Access-Control-Allow-Origin'] = '*'", // 1
        'app.add_middleware(CORSMiddleware, allow_origins=["*"])', // 2
        'app.add_middleware(CORSMiddleware, allow_origins=["https://example.com"])', // 3 안 잡음
      ),
    });

    expect(heads(scan(dir))).toEqual([
      '[cors-any-origin] api/app.py:1',
      '[cors-any-origin] api/app.py:2',
      '[cors-any-origin] server/forms.ts:1',
      '[cors-any-origin] server/forms.ts:2',
      '[cors-any-origin] server/forms.ts:3',
      '[cors-any-origin] server/forms.ts:4',
      '[cors-any-origin] server/forms.ts:5',
      '[cors-any-origin] server/forms.ts:6',
      '[cors-any-origin] server/forms.ts:12',
    ]);
  });

  it('AI 키 환경변수: 이름 규칙에 맞는 것만, 클라이언트 코드(src/·public/·루트 html)에서만 잡는다', () => {
    const serverSide = L(
      'const k = process.env.NEXT_PUBLIC_OPENAI_KEY;',
      'fetch("https://api.openai.com/v1/chat/completions");',
      `const s = "${FAKE_SK}";`,
    );
    const dir = mkFixture({
      'src/env.ts': L(
        'const a = import.meta.env.VITE_GEMINI_API_KEY;', // 1
        'const b = process.env.NEXT_PUBLIC_ANTHROPIC_KEY;', // 2
        'const c = process.env.REACT_APP_OPENAI_TOKEN;', // 3
        'const d = import.meta.env.EXPO_PUBLIC_GROQ_SECRET;', // 4
        'const e = import.meta.env.VITE_MY_AI_KEY;', // 5 (_AI_)
        'const n1 = import.meta.env.VITE_API_BASE_URL;', // 6 안 잡음
        'const n2 = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;', // 7 안 잡음 (AI 제공사 아님)
        'const n3 = import.meta.env.VITE_OPENAI_MODEL;', // 8 안 잡음 (KEY·TOKEN·SECRET 없음)
        'const n4 = process.env.OPENAI_API_KEY;', // 9 안 잡음 (클라이언트 접두사 없음)
        'const n5 = process.env.MY_VITE_OPENAI_KEY;', // 10 안 잡음 (접두사로 시작하지 않음)
        'const two = [import.meta.env.VITE_DEEPSEEK_KEY, import.meta.env.VITE_COHERE_KEY];', // 11 한 줄 한 번
      ),
      // 루트 html 의 인라인 스크립트도 클라이언트 코드다
      'index.html': L(
        '<meta name="viewport" content="width=device-width, user-scalable=no">',
        '<script>const k = import.meta.env.VITE_MISTRAL_API_KEY;</script>',
      ),
      // 서버 쪽 디렉터리는 클라이언트 코드가 아니다
      'server/ai.ts': serverSide,
      'worker/ai.ts': serverSide,
      'functions/api/ai.ts': serverSide,
      'api/ai.ts': serverSide,
    });
    const out = scan(dir);

    expect(heads(out)).toEqual([
      '[client-ai-key] index.html:2',
      '[client-ai-key] src/env.ts:1',
      '[client-ai-key] src/env.ts:2',
      '[client-ai-key] src/env.ts:3',
      '[client-ai-key] src/env.ts:4',
      '[client-ai-key] src/env.ts:5',
      '[client-ai-key] src/env.ts:11',
    ]);
    expect(lineAt(out, 'src/env.ts:5')).toContain('(VITE_MY_AI_KEY)');
    expect(lineAt(out, 'src/env.ts:11')).toContain('(VITE_DEEPSEEK_KEY)');
    expect(lineAt(out, 'index.html:2')).toContain('(VITE_MISTRAL_API_KEY)');
  });

  it('AI API 호스트: 클라이언트 코드의 직접 호출만 잡고 호스트 이름만 찍는다', () => {
    const dir = mkFixture({
      'src/hosts.ts': L(
        "fetch('https://api.anthropic.com/v1/messages');", // 1
        "fetch('https://generativelanguage.googleapis.com/v1beta/models');", // 2
        "fetch('https://clovastudio.stream.ntruss.com/v1');", // 3
        "const both = ['https://api.openai.com', 'https://api.groq.com'];", // 4 한 줄 한 번
        "fetch('/api/summary');", // 5 안 잡음
        "fetch('https://api.example.com/v1');", // 6 안 잡음
      ),
      'worker/ai.ts': L("fetch('https://api.openai.com/v1');"),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual([
      '[client-ai-key] src/hosts.ts:1',
      '[client-ai-key] src/hosts.ts:2',
      '[client-ai-key] src/hosts.ts:3',
      '[client-ai-key] src/hosts.ts:4',
    ]);
    expect(lineAt(out, 'src/hosts.ts:1')).toContain('(api.anthropic.com)');
    expect(lineAt(out, 'src/hosts.ts:3')).toContain('(clovastudio)');
    expect(lineAt(out, 'src/hosts.ts:4')).toContain('(api.openai.com)');
  });

  it('.env*: 루트 파일의 AI 키 변수 정의 줄만 이름으로 보고하고 값은 찍지 않는다', () => {
    const dir = mkFixture({
      '.env.production': L(
        '  export VITE_GROQ_API_KEY = value-one', // 1
        'NEXT_PUBLIC_GEMINI_TOKEN="value-two"', // 2
        '# VITE_OPENAI_API_KEY=commented-out', // 3 안 잡음 (주석)
        'OPENAI_API_KEY=value-three', // 4 안 잡음 (클라이언트 접두사 없음)
        'VITE_GOOGLE_MAPS_API_KEY=value-four', // 5 안 잡음 (AI 제공사 아님)
        'VITE_ANTHROPIC_API_KEY=', // 6 빈 값도 정의 줄이다
      ),
      // 루트가 아닌 .env 는 대상이 아니다
      'src/.env': L('VITE_OPENAI_API_KEY=value-five'),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual([
      '[client-ai-key] .env.production:1',
      '[client-ai-key] .env.production:2',
      '[client-ai-key] .env.production:6',
    ]);
    expect(lineAt(out, '.env.production:1')).toContain('(VITE_GROQ_API_KEY)');
    expect(lineAt(out, '.env.production:6')).toContain('(VITE_ANTHROPIC_API_KEY)');
    expect(out).not.toContain('value-');
  });

  it('키 형태 문자열: sk-·AIza 형태는 클라이언트 코드와 dist/ 에서만 잡고, 비슷한 문자열은 거른다', () => {
    const dir = mkFixture({
      'src/keys.ts': L(
        `const a = "${FAKE_SK}";`, // 1 잡음
        `const b = "task-${'a'.repeat(24)}";`, // 2 안 잡음 (sk- 앞이 영숫자)
        'const c = "sk-short123";', // 3 안 잡음 (20자 미만)
        `const d = "sk-proj-${'Q'.repeat(6)}_${'r'.repeat(6)}-${'S'.repeat(12)}";`, // 4 잡음 (_ - 섞인 본문)
        `const e = "${FAKE_AIZA}";`, // 5 잡음
        `const f = "AIza${'B'.repeat(34)}";`, // 6 안 잡음 (34자)
        `const g = "AIza${'B'.repeat(36)}";`, // 7 안 잡음 (더 긴 토큰)
      ),
      // 서버 쪽은 클라이언트 번들에 안 들어간다
      'server/keys.ts': L(`const k = "${FAKE_SK}";`),
      // dist/ 는 키 형태만 본다
      'dist/bundle.js': L(`var a="${FAKE_AIZA}";`),
    });
    const out = scan(dir);

    expect(heads(out)).toEqual([
      '[client-ai-key] dist/bundle.js:1',
      '[client-ai-key] src/keys.ts:1',
      '[client-ai-key] src/keys.ts:4',
      '[client-ai-key] src/keys.ts:5',
    ]);
    expect(lineAt(out, 'src/keys.ts:1')).toContain('(sk-…)');
    expect(lineAt(out, 'src/keys.ts:5')).toContain('(AIza…)');
    expect(out).not.toContain('a'.repeat(24));
    expect(out).not.toContain('B'.repeat(34));
    expect(out).not.toContain('Q'.repeat(6));
  });
});
