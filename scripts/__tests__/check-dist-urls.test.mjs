// 실행: node --test scripts/__tests__/check-dist-urls.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음.)
//
// 이 테스트는 게이트를 일부러 여러 방식으로 깨뜨려 실제로 실패하는지
// 확인한다 — 통과만 하는 테스트는 게이트를 증명하지 못한다. 검사 로직은
// ../check-dist-urls.mjs에서 그대로 import한다(로직을 여기 복붙하지 않는다).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  README_FILENAMES,
  checkArmedScopeReferences,
  checkUrlRules,
  collectSurfaceFiles,
  findReleaseUrls,
  parseFilename,
  parseTag,
} from '../check-dist-urls.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(__dirname, '..', 'check-dist-urls.mjs');

/** 텍스트를 `checkArmedScopeReferences`가 기대하는 라인 배열로 펼친다. */
function toLines(file, text) {
  return text.split('\n').map((lineText, i) => ({ file, line: i + 1, text: lineText }));
}

describe('collectSurfaceFiles — README 표면 확장', () => {
  test('루트 README.md·README.en.md가 표면에 포함된다', async () => {
    const files = await collectSurfaceFiles(REPO_ROOT);
    for (const name of README_FILENAMES) {
      const expected = path.join(REPO_ROOT, name);
      assert.ok(files.includes(expected), `${expected}가 표면에 없다`);
    }
  });

  test('각 workspace 패키지의 README.md·README.en.md가 표면에 포함된다', async () => {
    const files = await collectSurfaceFiles(REPO_ROOT);
    for (const pkgDir of ['agent-plugin', 'debugger', 'debug-console']) {
      for (const name of README_FILENAMES) {
        const expected = path.join(REPO_ROOT, 'packages', pkgDir, name);
        assert.ok(files.includes(expected), `${expected}가 표면에 없다`);
      }
    }
  });

  test('docs/·CHANGELOG.md는 표면에 없다 (정책 서술·이력 prose로 false positive 방지)', async () => {
    const files = await collectSurfaceFiles(REPO_ROOT);
    assert.ok(
      files.every((f) => !f.includes(`${path.sep}docs${path.sep}`)),
      'docs/ 아래 파일이 표면에 섞여 들어왔다',
    );
    assert.ok(
      files.every((f) => !f.endsWith('CHANGELOG.md')),
      'CHANGELOG.md가 표면에 섞여 들어왔다',
    );
  });
});

describe('checkUrlRules — 규칙① 버전 일치 · 규칙③ 호스트 고정', () => {
  test('규칙① 위반 — 태그 버전이 package.json 버전과 다르면 RED', () => {
    const text =
      'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v9.9.9/apps-in-toss-debugger-9.9.9.tgz"';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([['debugger', '0.2.0']]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.deepEqual(hostViolations, []);
    assert.equal(versionViolations.length, 1);
    assert.equal(versionViolations[0].reason, 'version-mismatch');
    assert.equal(versionViolations[0].expectedVersion, '0.2.0');
    assert.equal(versionViolations[0].taggedVersion, '9.9.9');
  });

  test('규칙③ 위반 — 다른 호스트/owner/repo를 가리키면 RED', () => {
    const text =
      'npx -p https://github.com/apps-in-toss-community/harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz debugger';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([['debugger', '0.2.0']]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.equal(hostViolations.length, 1);
    assert.equal(hostViolations[0].owner, 'apps-in-toss-community');
    // 호스트가 틀리면 이 repo 소속이 아니므로 버전 대조는 생략된다.
    assert.deepEqual(versionViolations, []);
  });

  test('버전·호스트 모두 정상이면 위반 없음', () => {
    const text =
      'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz"';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([['debugger', '0.2.0']]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.deepEqual(hostViolations, []);
    assert.deepEqual(versionViolations, []);
  });

  test('parseTag — 패키지명에 하이픈이 있어도 마지막 -v<버전> 경계로 분해된다', () => {
    assert.deepEqual(parseTag('debug-console-v0.1.4'), { pkg: 'debug-console', ver: '0.1.4' });
    assert.equal(parseTag('not-a-valid-tag'), null);
  });

  test('규칙①b 위반 — 태그 버전은 맞는데 filename 버전이 옛 버전으로 남아 있으면 RED (재현된 우회)', () => {
    // 재현 사례: 태그는 debugger-v0.2.0(=package.json과 일치)인데, 그 태그
    // 아래 실제 에셋 filename은 0.1.9로 남아 있다 — 태그만 보는 검사는 이걸
    // 놓친다.
    const text =
      'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.1.9.tgz"';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([['debugger', '0.2.0']]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.deepEqual(hostViolations, []);
    assert.equal(versionViolations.length, 1);
    assert.equal(versionViolations[0].reason, 'filename-version-mismatch');
    assert.equal(versionViolations[0].expectedVersion, '0.2.0');
    assert.equal(versionViolations[0].filenameVersion, '0.1.9');
  });

  test('규칙①b 위반 — filename의 패키지가 태그의 패키지와 다르면 RED', () => {
    const text =
      'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debug-console-0.2.0.tgz"';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([
      ['debugger', '0.2.0'],
      ['debug-console', '0.2.0'],
    ]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.deepEqual(hostViolations, []);
    assert.equal(versionViolations.length, 1);
    assert.equal(versionViolations[0].reason, 'filename-pkg-mismatch');
    assert.equal(versionViolations[0].taggedPkg, 'debugger');
    assert.equal(versionViolations[0].filenamePkg, 'debug-console');
  });

  test('규칙①b — 태그·filename의 pkg·버전이 모두 package.json과 일치하면 위반 없음', () => {
    const text =
      'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debug-console-v0.1.4/apps-in-toss-debug-console-0.1.4.tgz"';
    const findings = findReleaseUrls(text).map((f) => ({ file: 'fixture.md', ...f }));
    const versionByPkgDir = new Map([['debug-console', '0.1.4']]);
    const { hostViolations, versionViolations } = checkUrlRules(findings, versionByPkgDir);
    assert.deepEqual(hostViolations, []);
    assert.deepEqual(versionViolations, []);
  });

  test('parseFilename — 패키지명에 하이픈이 있어도 마지막 -<버전>.tgz 경계로 분해된다', () => {
    assert.deepEqual(parseFilename('apps-in-toss-debug-console-0.1.4.tgz'), {
      pkg: 'debug-console',
      ver: '0.1.4',
    });
    assert.deepEqual(parseFilename('apps-in-toss-debugger-0.2.0.tgz'), { pkg: 'debugger', ver: '0.2.0' });
    assert.equal(parseFilename('not-a-valid-filename.tgz'), null);
  });
});

describe('checkArmedScopeReferences — 규칙② self-arming (문맥 무관 전체 등장 검사)', () => {
  test('휴면(armed=false) — 구 스코프 참조가 있어도 항상 위반 없음', () => {
    const lines = toLines('fixture.md', 'npx -p @ait-co/debugger debugger');
    const violations = checkArmedScopeReferences(lines, false);
    assert.deepEqual(violations, []);
  });

  test('무장(armed=true) — 한 줄 명령에 박힌 참조는 RED', () => {
    const lines = toLines('fixture.md', 'npx -p @ait-co/debugger debugger');
    const violations = checkArmedScopeReferences(lines, true);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].scopePackage, 'debugger');
  });

  test('무장(armed=true) — 멀티라인으로 쪼개진 설치 명령도 RED (라인 문맥 요구 제거)', () => {
    // 이전 버전은 "같은 줄에 pnpm/npx 등 명령 키워드가 있어야 위반"이라
    // 이런 줄바꿈 우회를 놓쳤다. 스코프 문자열만 있는 줄도 이제 잡힌다.
    const text = ['pnpm add -D \\', '  @ait-co/debugger'].join('\n');
    const lines = toLines('fixture.md', text);
    const violations = checkArmedScopeReferences(lines, true);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.equal(violations[0].scopePackage, 'debugger');
  });

  test('무장(armed=true) — pretty-print된 .mcp.json args 배열도 RED (같은 줄에 "args" 없어도)', () => {
    // 이전 버전은 `"(dependencies|...|args)"\s*:` 가 같은 줄에 있어야 잡았다 —
    // pretty-print JSON은 배열 원소가 한 줄씩 떨어져 있어 우회됐다.
    const text = ['{', '  "args": [', '    "-y",', '    "@ait-co/debug-console",', '    "run"', '  ]', '}'].join(
      '\n',
    );
    const lines = toLines('fixture.json', text);
    const violations = checkArmedScopeReferences(lines, true);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 4);
    assert.equal(violations[0].scopePackage, 'debug-console');
  });

  test('무장(armed=true) — devtools 스코프(@ait-co/devtools)는 계속 제외된다 (#74 대기)', () => {
    const lines = toLines('fixture.md', 'pnpm add -D @ait-co/devtools');
    const violations = checkArmedScopeReferences(lines, true);
    assert.deepEqual(violations, []);
  });

  test('무장(armed=true) — 순수 산문 서술(명령 문맥 없음)도 이제는 RED (구 규칙은 놓쳤던 케이스)', () => {
    const lines = toLines('fixture.md', '이 패키지는 과거 @ait-co/debugger 라는 이름으로 배포됐다.');
    const violations = checkArmedScopeReferences(lines, true);
    assert.equal(violations.length, 1);
  });
});

describe('현재 실제 repo 표면 — 종합 GREEN 확인', () => {
  test('현행 표면은 armed 상태에서도 위반이 없다 (README 확장 + 강화된 규칙② 포함)', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const files = await collectSurfaceFiles(REPO_ROOT);
    assert.ok(files.length > 0, '표면 파일을 찾지 못했다');

    const packagesDir = path.join(REPO_ROOT, 'packages');
    const packageEntries = await readdir(packagesDir, { withFileTypes: true }).catch(() => []);
    const versionByPkgDir = new Map();
    for (const entry of packageEntries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(path.join(packagesDir, entry.name, 'package.json'), 'utf8');
        versionByPkgDir.set(entry.name, JSON.parse(raw).version);
      } catch {
        // package.json 없는 디렉터리 — 무시
      }
    }

    const urlFindings = [];
    const allLines = [];
    for (const absPath of files) {
      let text;
      try {
        text = await readFile(absPath, 'utf8');
      } catch {
        continue;
      }
      const relPath = path.relative(REPO_ROOT, absPath);
      for (const found of findReleaseUrls(text)) {
        urlFindings.push({ file: relPath, ...found });
      }
      const fileLines = text.split('\n');
      for (let i = 0; i < fileLines.length; i++) {
        allLines.push({ file: relPath, line: i + 1, text: fileLines[i] });
      }
    }

    const { hostViolations, versionViolations } = checkUrlRules(urlFindings, versionByPkgDir);
    const armed = urlFindings.length > 0;
    assert.ok(armed, '현재 repo는 Release URL이 이미 존재해 무장 상태여야 한다');

    const scopeViolations = checkArmedScopeReferences(allLines, armed);

    assert.deepEqual(hostViolations, [], `규칙③ 위반: ${JSON.stringify(hostViolations, null, 2)}`);
    assert.deepEqual(versionViolations, [], `규칙① 위반: ${JSON.stringify(versionViolations, null, 2)}`);
    assert.deepEqual(scopeViolations, [], `규칙② 위반: ${JSON.stringify(scopeViolations, null, 2)}`);
  });
});

describe('main() 진입 경로 — 실제 프로세스로 spawn해 exitCode·출력을 검증 (QA 지적: 종합 경로 커버리지 공백)', () => {
  // check-dist-urls.mjs는 REPO_ROOT를 항상 "자기 파일 위치의 부모 디렉터리"로
  // 계산한다(인자를 받지 않는다) — 그래서 main()을 실제로 다른 fixture
  // 상태에 대해 돌리려면, 스크립트 파일 자체를 fixture 디렉터리 트리
  // 안(scripts/check-dist-urls.mjs 상대 위치)에 복사해 그 트리를 REPO_ROOT로
  // 삼게 만든다. cwd는 REPO_ROOT 계산에 영향을 주지 않으므로(스크립트 자기
  // 경로 기준) 무관하다.
  function makeFixtureRepo({ pkgName, pkgVersion, readmeText }) {
    // realpath로 정규화한다 — macOS의 os.tmpdir()은 심볼릭 링크
    // (/var/folders/... -> /private/var/folders/...)라, 정규화하지 않으면
    // 스크립트 안 `isMainModule`(import.meta.url vs process.argv[1] 비교)이
    // 두 경로의 symlink 해석 차이로 어긋나 main()이 아예 실행되지 않는다.
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-dist-urls-e2e-')));
    const scriptsDir = path.join(tmpDir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.copyFileSync(SCRIPT_PATH, path.join(scriptsDir, 'check-dist-urls.mjs'));

    const pkgDir = path.join(tmpDir, 'packages', pkgName);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, version: pkgVersion }), 'utf8');

    fs.writeFileSync(path.join(tmpDir, 'README.md'), readmeText, 'utf8');

    return { tmpDir, scriptPath: path.join(scriptsDir, 'check-dist-urls.mjs') };
  }

  test('GREEN — 태그·filename·package.json 버전이 모두 일치하면 exit 0, 성공 메시지 출력', () => {
    const { tmpDir, scriptPath } = makeFixtureRepo({
      pkgName: 'debugger',
      pkgVersion: '0.2.0',
      readmeText:
        'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.2.0.tgz"\n',
    });
    try {
      const stdout = execFileSync('node', [scriptPath], { encoding: 'utf8' });
      assert.match(stdout, /check:dist-urls/);
      assert.match(stdout, /새 위반 없음/);
      assert.match(stdout, /규칙 ② 무장됨/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('RED — filename 버전이 태그·package.json과 다르면(재현된 우회) exit 1, 규칙① 위반 출력', () => {
    const { tmpDir, scriptPath } = makeFixtureRepo({
      pkgName: 'debugger',
      pkgVersion: '0.2.0',
      readmeText:
        'pnpm add -D "https://github.com/toss/apps-in-toss-harness/releases/download/debugger-v0.2.0/apps-in-toss-debugger-0.1.9.tgz"\n',
    });
    try {
      execFileSync('node', [scriptPath], { encoding: 'utf8' });
      assert.fail('filename 버전 불일치가 있으면 0이 아닌 exit code로 실패해야 한다');
    } catch (err) {
      assert.equal(err.status, 1);
      assert.match(err.stderr, /규칙 ① 위반/);
      assert.match(err.stderr, /filename 버전: 0\.1\.9/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
