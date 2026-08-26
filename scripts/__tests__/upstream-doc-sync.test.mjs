// 실행: node --test scripts/__tests__/upstream-doc-sync.test.mjs
// (Node 내장 테스트 러너 — 루트 `pnpm test`가 `test:scripts`로 함께 돌린다.)
//
// docs/upstream-sync.md ↔ 코드·데이터 정합성.
//
// 이 문서는 파이프라인의 보호 목록을 **손으로 베껴** 설명한다: 치환 금지 리터럴,
// 파일 전체 보존 패턴, 그리고 "가장 위험도가 높은 두 클래스는 이미 localOnly로
// 고정했다"는 경로 열거. 지금까지 그 열거가 실제 배열과 맞는지 확인하는 것은
// 아무것도 없었다.
//
// 왜 중요한가: `localOnly`는 `sync-upstream.mjs --write`가 하네스 손수정을
// 덮어쓰거나 지우는 것을 막는 **유일한** 메커니즘이다(`PRESERVED_FILE_PATTERNS`는
// `normalizeContent()` 안에서만 발화해 덮어쓰기를 막지 못한다 — 문서 자신이
// #21 사고 사례로 설명하는 구분이다). 누가 `localOnly`에서 경로를 빼면 문서는
// 계속 "고정했다"고 주장하고, 그 파일은 조용히 덮어쓰기 대상으로 돌아온다.
// 상류 sync 모드를 결정하는 시점(harness#25)에 이 문서를 근거로 삼으므로,
// 문서가 조용히 거짓이 되는 경로를 닫아 둔다.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRESERVED_FILE_PATTERNS, PROTECTED_LITERALS } from '../normalize-upstream.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

const DOC = fs.readFileSync(path.join(repoRoot, 'docs', 'upstream-sync.md'), 'utf8');
const UPSTREAM = JSON.parse(fs.readFileSync(path.join(repoRoot, '.upstream.json'), 'utf8'));

const localOnly = (pkg) => UPSTREAM.packages[pkg]?.localOnly ?? [];

/** 정규식에서 검색 가능한 경로 조각을 뽑는다. `/(^|\/)eval\/e2e\/x\.json$/` → `eval/e2e/x.json` */
function pathFragment(re) {
  return re.source
    .replace(/^\(\^\|\\\/\)/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/')
    .replace(/\\\./g, '.');
}

/** 문서에서 `**클래스 N —` 로 시작하는 불릿 본문만 잘라낸다. */
function classBullet(n) {
  const start = DOC.indexOf(`**클래스 ${n} —`);
  assert.notEqual(start, -1, `문서에서 "클래스 ${n}" 불릿을 못 찾았다 — 문단 구조가 바뀌었다면 이 추출기를 고쳐라`);
  const next = DOC.indexOf('**클래스 ', start + 5);
  const end = next === -1 ? DOC.indexOf('\n\n', start) : next;
  return DOC.slice(start, end === -1 ? DOC.length : end);
}

/** 백틱 토큰 중 경로처럼 생긴 것(`/` 포함, URL 아님)만. */
function pathTokens(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => m[1])
    .filter((t) => t.includes('/') && !t.startsWith('http'));
}

/** `a/{x,y}` 브레이스 확장. glob(`dir/**`)은 그대로 남긴다. */
function expandBraces(token) {
  const m = token.match(/^(.*)\{([^}]+)\}(.*)$/);
  if (!m) return [token];
  return m[2].split(',').map((opt) => `${m[1]}${opt.trim()}${m[3]}`);
}

/** 문서 열거 토큰들을 실제 localOnly 항목 집합으로 해석한다. */
function resolveAgainstLocalOnly(tokens, entries, label) {
  const resolved = new Set();
  for (const token of tokens.flatMap(expandBraces)) {
    if (token.endsWith('/**')) {
      const prefix = token.slice(0, -2);
      const hits = entries.filter((e) => e.startsWith(prefix));
      assert.ok(
        hits.length > 0,
        `${label}: 문서가 \`${token}\` 를 보호 대상으로 적었지만 localOnly에 그 prefix로 시작하는 항목이 없다`,
      );
      for (const h of hits) resolved.add(h);
    } else {
      assert.ok(
        entries.includes(token),
        `${label}: 문서가 \`${token}\` 를 "localOnly로 고정했다"고 적었지만 실제 localOnly에 없다 — ` +
          '다음 sync-upstream --write 가 이 파일을 조용히 덮어쓰거나 지운다.',
      );
      resolved.add(token);
    }
  }
  return resolved;
}

/** 문서 문구에서 `<label> N개` 형태의 수를 읽는다. */
function statedCount(text, label) {
  const m = text.match(new RegExp(`${label}\\s*\\*{0,2}(\\d+)개`));
  assert.notEqual(m, null, `문서에서 "${label} N개" 수치를 못 찾았다 — 문구가 바뀌었다면 이 추출기를 고쳐라`);
  return Number(m[1]);
}

describe('docs/upstream-sync.md ↔ normalize-upstream.mjs', () => {
  test('PROTECTED_LITERALS 전부가 문서에 적혀 있어야 한다', () => {
    // 문서는 리터럴마다 "해제 조건"을 기록한다. 문서화 없이 영구 예외를 추가하면
    // 왜 남아 있는지, 언제 뗄 수 있는지 아무도 모르는 예외가 된다.
    assert.ok(PROTECTED_LITERALS.length > 0);
    for (const literal of PROTECTED_LITERALS) {
      assert.ok(
        DOC.includes(literal),
        `치환 금지 리터럴 \`${literal}\` 이 문서에 없다 — 해제 조건과 함께 "치환 금지" 행에 적어라.`,
      );
    }
  });

  test('PRESERVED_FILE_PATTERNS 전부가 문서에 적혀 있어야 한다', () => {
    assert.ok(PRESERVED_FILE_PATTERNS.length > 0);
    for (const re of PRESERVED_FILE_PATTERNS) {
      const fragment = pathFragment(re);
      assert.ok(
        fragment.length > 0 && DOC.includes(fragment),
        `보존 패턴 \`${re}\`(조각: ${fragment})이 문서에 없다 — "파일 전체 보존" 행에 이유와 함께 적어라.`,
      );
    }
  });
});

describe('docs/upstream-sync.md ↔ .upstream.json localOnly', () => {
  test('클래스 1(공개 서빙 Pages 표면) 열거가 devtools localOnly와 일치해야 한다', () => {
    const bullet = classBullet(1);

    if (!UPSTREAM.packages.devtools) {
      // harness packages/devtools 자체가 C4(2026-08-05)로 제거됐다 — .upstream.json에
      // devtools 항목이 통째로 없으므로 지킬 localOnly도 없다. 문서가 그 소멸을
      // 정확히 설명하는지만 확인한다 (더 이상 파일 열거 ↔ localOnly 대조는 의미가 없다).
      assert.ok(
        /제거/.test(bullet),
        '클래스 1: devtools가 .upstream.json에서 사라졌는데 문서가 제거 사실을 설명하지 않는다',
      );
      return;
    }

    const tokens = pathTokens(bullet);
    assert.ok(tokens.length >= 5, `클래스 1 경로 추출이 ${tokens.length}건뿐 — 추출기가 깨졌을 수 있다`);

    const resolved = resolveAgainstLocalOnly(tokens, localOnly('devtools'), '클래스 1');

    // 문서는 "…, 12개 파일, devtools `localOnly` 참고"처럼 총 개수를 함께 적는다.
    // 열거가 실제로 그 수만큼 펼쳐지는지까지 봐야 "목록에서 하나 빠뜨렸는데 수치는
    // 그대로"인 경우를 잡는다.
    const stated = bullet.match(/(\d+)개 파일/);
    assert.notEqual(stated, null, '문서에서 "N개 파일" 수치를 못 찾았다 — 문구가 바뀌었다면 이 추출기를 고쳐라');
    assert.equal(
      resolved.size,
      Number(stated[1]),
      `문서가 적은 개수(${stated?.[1]})와 실제 열거가 펼쳐진 개수(${resolved.size})가 다르다`,
    );
  });

  test('클래스 2(#22 override 소비자·회귀 테스트) 열거가 두 패키지 localOnly와 일치해야 한다', () => {
    // harness#40(상류 df1f45e) 이후 devtools/debugger 두 목록은 서로소다(더 이상
    // "devtools 목록에서 일부 제외 = debugger 목록"이 아니다) — 문서는 "devtools
    // N개: … , debugger M개: …" 두 구간으로 나눠 적고, 여기서도 그 구분점
    // (`debugger *N개`)을 기준으로 잘라 각각 독립적으로 해석한다.
    const bullet = classBullet(2);
    const splitMatch = bullet.match(/debugger\s*\*{0,2}\d+개/);
    assert.notEqual(
      splitMatch,
      null,
      '문서에서 "debugger N개" 구분점을 못 찾았다 — 문구가 바뀌었다면 이 추출기를 고쳐라',
    );
    const devtoolsPart = bullet.slice(0, splitMatch.index);
    const debuggerPart = bullet.slice(splitMatch.index);

    if (!UPSTREAM.packages.devtools) {
      // devtools가 .upstream.json에서 완전히 사라졌다(C4) — devtools 쪽 절반은
      // 더 이상 localOnly 대조 대상이 아니다. 문서가 그 소멸을 설명하는지만 본다.
      assert.ok(
        /제거/.test(devtoolsPart),
        '클래스 2/devtools: devtools가 사라졌는데 문서가 제거 사실을 설명하지 않는다',
      );
    } else {
      const devtoolsResolved = resolveAgainstLocalOnly(
        pathTokens(devtoolsPart),
        localOnly('devtools'),
        '클래스 2/devtools',
      );
      assert.equal(
        devtoolsResolved.size,
        statedCount(bullet, 'devtools'),
        '문서가 적은 devtools 개수와 실제 열거 개수가 다르다',
      );
    }

    const debuggerResolved = resolveAgainstLocalOnly(
      pathTokens(debuggerPart),
      localOnly('debugger'),
      '클래스 2/debugger',
    );
    assert.equal(
      debuggerResolved.size,
      statedCount(bullet, 'debugger'),
      '문서가 적은 debugger 개수와 실제 열거 개수가 다르다',
    );
  });
});
