// 실행: node --test scripts/__tests__/normalize-upstream.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음. 실행 방법은 docs/upstream-sync.md에도 기록.)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  normalizeContent,
  isPreservedFile,
  isExternalTargetContent,
  PROTECTED_LITERALS,
  SCOPED_PACKAGES,
  TEXT_LIKE_EXTENSIONS,
} from '../normalize-upstream.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function norm(content, filePath, env) {
  return normalizeContent(content, { filePath, env: env ?? {} });
}

describe('scope rename — functional contexts (default on)', () => {
  test('import specifier', () => {
    const src = `import aitDevtools from '@ait-co/devtools/unplugin';\n`;
    const { content, counts } = norm(src, 'src/index.ts');
    assert.equal(content, `import aitDevtools from '@apps-in-toss/devtools/unplugin';\n`);
    assert.equal(counts['scope:functional-import'], 1);
  });

  test('dynamic import specifier', () => {
    const src = `void import('@ait-co/debug-console').then((m) => m.maybeAttach());\n`;
    const { content } = norm(src, 'src/auto.ts');
    assert.equal(content, `void import('@apps-in-toss/debug-console').then((m) => m.maybeAttach());\n`);
  });

  test('import.meta.resolve specifier', () => {
    const src = `const ok = canResolve(import.meta.resolve('@ait-co/debugger/dev-bridge'));\n`;
    const { content } = norm(src, 'src/optional-peers.ts');
    assert.match(content, /@apps-in-toss\/debugger\/dev-bridge/);
  });

  test('package.json dependency key (all dependency-object kinds)', () => {
    const src = [
      '{',
      '  "peerDependencies": {',
      '    "@ait-co/debug-console": "^0.1.0",',
      '    "@ait-co/debugger": "^0.1.0"',
      '  },',
      '  "devDependencies": {',
      '    "@ait-co/debug-console": "workspace:*"',
      '  }',
      '}',
      '',
    ].join('\n');
    const { content, counts } = norm(src, 'packages/devtools/package.json');
    assert.match(content, /"@apps-in-toss\/debug-console": "\^0\.1\.0"/);
    assert.match(content, /"@apps-in-toss\/debugger": "\^0\.1\.0"/);
    assert.match(content, /"@apps-in-toss\/debug-console": "workspace:\*"/);
    assert.equal(counts['scope:functional-pkgjson'], 3);
  });

  test('non-LEGACY bare const literal is renamed (real precedent: DEBUGGER_DEV_BRIDGE_ID)', () => {
    const src = `export const DEBUGGER_DEV_BRIDGE_ID = '@ait-co/debugger/dev-bridge';\n`;
    const { content, counts } = norm(src, 'src/unplugin/optional-peers.ts');
    assert.equal(content, `export const DEBUGGER_DEV_BRIDGE_ID = '@apps-in-toss/debugger/dev-bridge';\n`);
    assert.equal(counts['scope:functional-const'], 1);
  });

  test('INSTALL_HINT-style const with two scope tokens both renamed', () => {
    const src = `export const INSTALL_HINT = 'pnpm add -D @ait-co/debugger @ait-co/debug-console';\n`;
    const { content } = norm(src, 'src/unplugin/optional-peers.ts');
    assert.equal(content, `export const INSTALL_HINT = 'pnpm add -D @apps-in-toss/debugger @apps-in-toss/debug-console';\n`);
  });
});

describe('scope rename — LEGACY literal (permanent preserve)', () => {
  test('LEGACY_IN_APP_ID is never renamed, even with NORMALIZE_SCOPE_INSTALL=1', () => {
    const src = `export const LEGACY_IN_APP_ID = '@ait-co/devtools/in-app';\n`;
    const withoutFlag = norm(src, 'src/unplugin/optional-peers.ts');
    const withFlag = norm(src, 'src/unplugin/optional-peers.ts', { NORMALIZE_SCOPE_INSTALL: '1' });
    assert.equal(withoutFlag.content, src);
    assert.equal(withFlag.content, src);
    // '@ait-co/devtools/in-app' is also a PROTECTED_LITERALS entry (see below),
    // which is checked before the LEGACY-const branch — so this line is now
    // categorized 'protected-literal', not 'scope:legacy-preserved'. Either way
    // the line is untouched; the assertion above is the behavioral guarantee.
    assert.equal(withoutFlag.counts['scope:protected-literal'], 1);
  });

  test('a string literal that merely embeds the pre-split specifier (not a LEGACY const) is also preserved — real regression: unplugin.test.ts #817 dedupe fixture', () => {
    // 실측 근거: packages/devtools/src/__tests__/unplugin.test.ts의
    // "#817: 분리 전 specifier로 직접 배선한 소비자도 dedupe 대상이다" 테스트는
    // `const code = "import('@ait-co/devtools/in-app')...";` 형태로 legacy
    // specifier를 fixture 문자열에 심는다. 변수명이 LEGACY가 아니고, 텍스트
    // 모양이 `import(...)` 특정자와 우연히 일치해 예전에는 IMPORT_SPECIFIER_RE가
    // 먼저 매치해 리네임됐다 — 그러면 "분리 전 specifier" 테스트가 더 이상
    // 분리 전 specifier를 테스트하지 못하게 된다.
    const src = "const code = \"import('@ait-co/devtools/in-app').then((m) => m.maybeAttach());\\nconsole.log('hello');\";\n";
    const { content, counts } = norm(src, 'src/__tests__/unplugin.test.ts');
    assert.equal(content, src);
    assert.equal(counts['scope:protected-literal'], 1);
  });
});

describe('scope rename — install/registry paths, devtools only (default on since devtools npm publish, 2026-08-04)', () => {
  const cases = [
    ['npx -p install command', `npx -p @ait-co/devtools devtools\n`],
    ['pnpm add install command', `pnpm add -D @ait-co/devtools\n`],
    ['npm install command', `npm install @ait-co/devtools\n`],
    ['npm registry homepage URL', `"homepage": "https://www.npmjs.com/package/@ait-co/devtools"\n`],
    ['install-detection grep string', `grep '"@ait-co/devtools"' package.json\n`],
  ];

  for (const [label, src] of cases) {
    test(`${label} — default rename (devtools is in NPM_PUBLISHED_SCOPED_PACKAGES)`, () => {
      const { content, counts } = norm(src, 'README.md');
      assert.notEqual(content, src);
      assert.ok(content.includes('@apps-in-toss/devtools'));
      assert.ok(counts['scope:install-forced'] >= 1);
    });

    test(`${label} — NORMALIZE_SCOPE_INSTALL=0 blocks rename (global kill switch)`, () => {
      const { content, counts } = norm(src, 'README.md', { NORMALIZE_SCOPE_INSTALL: '0' });
      assert.equal(content, src, 'must be left untouched when explicitly disabled');
      assert.ok(counts['scope:install-blocked'] >= 1);
    });
  }
});

describe('scope rename — install/registry paths, debugger/debug-console (permanently unpublished — npm-less is the design, not "not yet")', () => {
  const cases = [
    ['npx -p install command', `npx -p @ait-co/debugger debugger\n`],
    ['pnpm add install command', `pnpm add @ait-co/debug-console\n`],
    ['npm install command', `npm install @ait-co/debug-console\n`],
    ['npm registry homepage URL', `"homepage": "https://www.npmjs.com/package/@ait-co/debug-console"\n`],
    ['install-detection grep string', `grep '"@ait-co/debugger"' package.json\n`],
  ];

  for (const [label, src] of cases) {
    test(`${label} — default blocked (debugger/debug-console are not in NPM_PUBLISHED_SCOPED_PACKAGES)`, () => {
      const { content, counts } = norm(src, 'README.md');
      assert.equal(content, src, 'must be left untouched — these packages are never published to npmjs by design');
      assert.ok(counts['scope:install-blocked'] >= 1);
    });

    test(`${label} — NORMALIZE_SCOPE_INSTALL=1 does NOT force-rename (not a per-package escape hatch)`, () => {
      const { content, counts } = norm(src, 'README.md', { NORMALIZE_SCOPE_INSTALL: '1' });
      assert.equal(content, src, 'the global flag only gates published packages; it must not manufacture a 404 install command');
      assert.ok(counts['scope:install-blocked'] >= 1);
    });
  }
});

describe('scope rename — install context with mixed published/unpublished packages on one line', () => {
  test('a line mentioning both devtools (published) and debugger (unpublished) stays fully blocked — no partial rename', () => {
    const src = `# see also @ait-co/devtools and pnpm add -D @ait-co/devtools @ait-co/debugger\n`;
    const { content, counts } = norm(src, 'README.md');
    assert.equal(content, src, 'must not split one line into mixed scopes');
    assert.ok(counts['scope:install-blocked'] >= 1);
  });
});

describe('scope rename — prose/comments in code files (renamed, #21)', () => {
  // 실측 근거: git show --stat 33771c1(전면 스코프 sweep)의 실제 변경 파일
  // 목록이 src/**·scripts/**·설정 파일의 주석/JSDoc 안 @ait-co/* 언급까지
  // 예외 없이 치환했다 — 예전엔 이 문맥을 영구 보존('prose-preserved')했지만,
  // 그 결과 정규화기가 재실행될 때마다 손으로 한 sweep을 부분적으로
  // 되돌렸다(#21). 지금은 '치환' 기본값이고, 마크다운만 예외다(아래 describe).
  test('JSDoc comment mention in a .ts file IS renamed', () => {
    const src = ` * OPTIONAL peerDependencies of \`@ait-co/devtools\`:\n`;
    const { content, counts } = norm(src, 'src/unplugin/optional-peers.ts');
    assert.equal(content, ` * OPTIONAL peerDependencies of \`@apps-in-toss/devtools\`:\n`);
    assert.equal(counts['scope:prose-renamed'], 1);
  });

  test('a .sh script comment mention IS renamed — real regression: check-debug-surface-absent.sh (#21)', () => {
    // 실측 근거: 커밋 33771c1이 scripts/check-debug-surface-absent.sh 같은 .sh
    // 파일의 주석 안 @ait-co/* 언급도 치환했다. .sh는 원래
    // TEXT_LIKE_EXTENSIONS에 없어서(normalize-upstream.mjs CLI와
    // sync-upstream.mjs의 runNormalize가 각자 다른 확장자 목록을 하드코딩)
    // 이 파일 자체가 스캔 대상에서 빠져 있었다 — 그 갭이 #21의 원인 중 하나.
    const src = '# checks that the debug surface (@ait-co/debug-console) is absent from the release bundle\n';
    const { content, counts } = norm(src, 'packages/debugger/scripts/check-debug-surface-absent.sh');
    assert.match(content, /@apps-in-toss\/debug-console/);
    assert.equal(counts['scope:prose-renamed'], 1);
  });

  test('a .json (non-package.json) comment-like string mention IS renamed', () => {
    const src = '{\n  "description": "wraps @ait-co/devtools for local dev"\n}\n';
    const { content, counts } = norm(src, 'packages/devtools/tsconfig.json');
    assert.match(content, /@apps-in-toss\/devtools/);
    assert.equal(counts['scope:prose-renamed'], 1);
  });
});

describe('scope rename — prose in markdown documentation (preserved, #21)', () => {
  // 실측 근거: 같은 커밋 33771c1의 변경 파일 목록에 일반 docs/*.md 안내·회고
  // 문서는 단 하나도 없다 — 코드 sweep과 달리 마크다운 프로즈는 애초에 손대지
  // 않았다. 마크다운까지 일괄 치환하면 (a) release-readiness-0.1.0.md처럼
  // 과거 PR 커밋 메시지를 인용하는 회고 문서의 역사적 사실을 소급 왜곡하고,
  // (b) agent-plugin(hardfork — 이 sync 파이프라인이 관리하지 않음)의
  // CLAUDE.md/SKILL.md까지 "변경 필요"로 잘못 잡는다 — 둘 다 실측으로 재현해
  // 확인한 사고다(#21).
  test('README narrative mention is not renamed even with the install flag', () => {
    const src = '이 패키지는 `@ait-co/devtools`의 optional peer로 동작합니다.\n';
    const { content, counts } = norm(src, 'README.md', { NORMALIZE_SCOPE_INSTALL: '1' });
    assert.equal(content, src);
    assert.equal(counts['scope:prose-preserved-md'], 1);
  });

  test('a retrospective doc quoting a historical PR commit message is not renamed — real regression: release-readiness-0.1.0.md (#21)', () => {
    const src =
      '> **0.1.0 태그가 없는 이유**: (`#67` `fix(unplugin): resolve @ait-co/devtools/mock to an absolute path`)\n';
    const { content, counts } = norm(src, 'packages/devtools/docs/release-readiness-0.1.0.md');
    assert.equal(content, src, 'must not retroactively rewrite a quoted historical commit message');
    assert.equal(counts['scope:prose-preserved-md'], 1);
  });

  test('agent-plugin (hardfork, not managed by this pipeline) markdown mentions are not renamed — real regression (#21)', () => {
    const src = '| `@ait-co/debugger` | MCP 디버그 데몬 + 테스트 러너 |\n';
    const { content, counts } = norm(src, 'packages/agent-plugin/CLAUDE.md');
    assert.equal(content, src);
    assert.equal(counts['scope:prose-preserved-md'], 1);
  });

  test('an .mdx-adjacent code-fenced import inside markdown is still preserved by default (whole-file .md gate, not fence-aware)', () => {
    const src = "```ts\nimport '@ait-co/devtools/panel';\n```\n";
    const { content } = norm(src, 'packages/agent-plugin/shared/skills/debug/references/panel-tabs.md');
    assert.equal(content, src);
  });
});

describe('GitHub issue/PR link degrade', () => {
  test('markdown link form → plain repo#N', () => {
    const src = '(관련: [#290](https://github.com/apps-in-toss-community/devtools/issues/290))\n';
    const { content, counts } = norm(src, 'README.md');
    assert.equal(content, '(관련: devtools#290)\n');
    assert.equal(counts['github-issue-degrade'], 1);
  });

  test('markdown link form, pull request', () => {
    const src = 'See [sdk-example#60](https://github.com/apps-in-toss-community/sdk-example/pull/60).\n';
    const { content } = norm(src, 'README.md');
    assert.equal(content, 'See sdk-example#60.\n');
  });

  test('bare (non-markdown) numbered URL form', () => {
    const src = 'iPhone 15 Pro on-device relay 실측(devtools#190 아님, 원문 링크: https://github.com/apps-in-toss-community/devtools/issues/190)\n';
    const { content } = norm(src, 'CLAUDE.md');
    assert.match(content, /devtools#190\)\n$/);
  });

  test('idempotent — already-degraded plain identifier is untouched', () => {
    const once = norm('devtools#824 관련 수정.\n', 'README.md');
    const twice = norm(once.content, 'README.md');
    assert.equal(twice.content, once.content);
  });
});

describe('GitHub general link rewrite', () => {
  test('root link to a mapped package repo gets tree/main/packages path', () => {
    const src = 'GitHub: https://github.com/apps-in-toss-community/devtools\n';
    const { content, counts } = norm(src, 'e2e/fixture/public/llms.txt');
    assert.equal(content, 'GitHub: https://github.com/toss/apps-in-toss-harness/tree/main/packages/devtools\n');
    assert.equal(counts['github-link-rewrite'], 1);
  });

  test('blob link to a mapped single-package repo inserts packages/<name>', () => {
    const src = 'https://github.com/apps-in-toss-community/devtools/blob/main/src/mock/proxy.ts\n';
    const { content } = norm(src, 'README.md');
    assert.equal(content, 'https://github.com/toss/apps-in-toss-harness/blob/main/packages/devtools/src/mock/proxy.ts\n');
  });

  test('debugger repo link keeps its packages/<sub> path as-is (repo is itself a workspace)', () => {
    const src = 'https://github.com/apps-in-toss-community/debugger/blob/main/packages/debug-console/src/index.ts\n';
    const { content } = norm(src, 'README.md');
    assert.equal(content, 'https://github.com/toss/apps-in-toss-harness/blob/main/packages/debug-console/src/index.ts\n');
  });

  test('unmapped repo (sdk-example) is left untouched (no invented URL) and flagged for review', () => {
    const src = 'https://github.com/apps-in-toss-community/sdk-example\n';
    const { content, counts } = norm(src, 'README.md');
    assert.equal(content, src, 'must not fabricate a harness URL for a repo that is not vendored');
    assert.equal(counts['github-link-rewrite-needs-review'], 1);
    assert.equal(counts['github-link-rewrite'], undefined);
  });

  test('idempotent — rewritten harness link is not re-matched', () => {
    const once = norm('https://github.com/apps-in-toss-community/devtools\n', 'README.md');
    const twice = norm(once.content, 'README.md');
    assert.equal(twice.content, once.content);
  });
});

describe('docs.aitc.dev deep-link → MCP guidance', () => {
  test('Korean line produces Korean MCP guidance with slug, no invented URL', () => {
    const src = '자세히: https://docs.aitc.dev/guides/relay-auth-totp\n';
    const { content, counts } = norm(src, 'src/mcp/totp.ts');
    assert.equal(content, '자세히: apps-in-toss-docs MCP에서 "relay-auth-totp" 문서를 조회하세요\n');
    assert.doesNotMatch(content, /https?:\/\//);
    assert.equal(counts['docs-deeplink-mcp'], 1);
  });

  test('English line produces English MCP guidance with slug', () => {
    const src = "'See: https://docs.aitc.dev/guides/debug-relay',\n";
    const { content } = norm(src, 'src/mcp/server.ts');
    assert.equal(content, "'See: query the apps-in-toss-docs MCP for \"debug-relay\"',\n");
  });

  test('does not touch the unrelated devtools.aitc.dev domain', () => {
    const src = 'https://devtools.aitc.dev/guide/\n';
    const { content } = norm(src, 'README.md');
    assert.equal(content, src);
  });
});

describe('protected literals — never touched regardless of rule', () => {
  for (const literal of PROTECTED_LITERALS) {
    test(`${literal} survives normalization untouched`, () => {
      const src = `참고: ${literal} 을 확인하세요.\n`;
      const { content } = norm(src, 'README.md');
      assert.equal(content, src);
    });
  }
});

describe('branding neutralization', () => {
  test('Korean footer disclaimer block (--- separator + line) is removed', () => {
    const src = ['## 라이센스', '', 'BSD 3-Clause', '', '---', '', '커뮤니티 오픈소스 프로젝트입니다.', ''].join('\n');
    const { content, counts } = norm(src, 'README.md');
    assert.equal(content, ['## 라이센스', '', 'BSD 3-Clause', ''].join('\n'));
    assert.equal(counts['branding-footer-removed'], 1);
  });

  test('English footer disclaimer block is removed', () => {
    const src = ['## License', '', 'BSD 3-Clause', '', '---', '', 'Community open-source project.', ''].join('\n');
    const { content } = norm(src, 'README.en.md');
    assert.equal(content, ['## License', '', 'BSD 3-Clause', ''].join('\n'));
  });

  test('standalone "not affiliated" line is removed', () => {
    const src = ['## Notes', '', '- This project is not affiliated with Toss or Viva Republica.', '- other note', ''].join('\n');
    const { content, counts } = norm(src, 'e2e/fixture/public/llms.txt');
    assert.equal(content, ['## Notes', '', '- other note', ''].join('\n'));
    assert.equal(counts['branding-line-removed'], 1);
  });

  test('"Open Source Community" eyebrow copy is neutralized to existing "Apps in Toss" wording', () => {
    const src = "  eyebrow: 'Open Source Community',\n  subtitle: 'mock SDK + DevTools panel for Apps in Toss mini-apps.',\n";
    const { content, counts } = norm(src, 'scripts/build-og-image.tsx');
    assert.match(content, /eyebrow: 'Apps in Toss',/);
    assert.equal(counts['branding-eyebrow-neutralized'], 1);
  });

  test('a disclaimer sentence embedded mid-line (not the whole line) is also stripped in non-markdown files — real regression: letterbox-probe manifest/HTML (#21)', () => {
    // 실측 대상 파일(e2e/fixture/public/letterbox-probe/index.html의 <div> 안,
    // fullscreen/manifest.webmanifest의 JSON description 필드)은 .html/.webmanifest가
    // TEXT_LIKE_EXTENSIONS에 없어 실제로는 이 함수까지 도달하지 않는다(그래서
    // .upstream.json의 localOnly로 별도 고정했다) — 이 테스트는 그 도달 자체가
    // 아니라, 함수가 "줄 일부에 묻힌 문장"을 실제로 지울 수 있는지(비-마크다운
    // 파일에 한해)를 단위 수준에서 고정한다.
    const src = '{\n  "description": "letterbox probe. 커뮤니티 오픈소스 프로젝트입니다."\n}\n';
    const { content, counts } = norm(src, 'scripts/fixture-manifest.json');
    assert.equal(content, '{\n  "description": "letterbox probe."\n}\n');
    assert.equal(counts['branding-embedded-removed'], 1);
  });

  test('a disclaimer sentence quoted as an example inside markdown prose is NOT stripped — real regression: agent-plugin/CLAUDE.md (#21)', () => {
    // 실측 근거: packages/agent-plugin/CLAUDE.md가 "과거 커뮤니티
    // disclaimer(\"커뮤니티 오픈소스 프로젝트입니다.\" 등)는 넣지 않는다"처럼
    // 이 문장을 실제 disclaimer로 "포함"이 아니라 예시로 "인용"하는 프로즈를
    // 갖고 있다 — 마크다운에서 줄-일부 매치로 이 인용을 지우면 문장이 깨진다.
    const src = '과거 커뮤니티 disclaimer("커뮤니티 오픈소스 프로젝트입니다." 등)는 넣지 않는다.\n';
    const { content, counts } = norm(src, 'packages/agent-plugin/CLAUDE.md');
    assert.equal(content, src, 'must not corrupt a markdown sentence that quotes the disclaimer as an example');
    assert.equal(counts['branding-embedded-removed'], undefined);
  });
});

describe('package.json "homepage" field pinned to harness repo (#21)', () => {
  // 실측 근거: 커밋 acffd8c가 devtools/debugger/debug-console package.json의
  // homepage 필드를 손으로 harness GitHub URL로 정정했다(devtools는 커뮤니티
  // 자체 도메인 devtools.aitc.dev에서, debugger/debug-console은 미배포 npm
  // URL에서) — 어떤 규칙도 이걸 캡처하지 못해 다음 snapshot sync가 조용히
  // 되돌릴 수 있는 gap이었다.
  test('an npmjs.com homepage URL (debugger/debug-console pattern) is rewritten to the harness repo', () => {
    const src = '{\n  "name": "@apps-in-toss/debugger",\n  "homepage": "https://www.npmjs.com/package/@ait-co/debugger",\n  "bugs": {}\n}\n';
    const { content, counts } = norm(src, 'packages/debugger/package.json');
    assert.match(content, /"homepage": "https:\/\/github\.com\/toss\/apps-in-toss-harness"/);
    assert.equal(counts['package-homepage-harness'], 1);
  });

  test('a community-domain homepage URL (devtools pattern) is rewritten to the harness repo', () => {
    const src = '{\n  "name": "@apps-in-toss/devtools",\n  "homepage": "https://devtools.aitc.dev/"\n}\n';
    const { content, counts } = norm(src, 'packages/devtools/package.json');
    assert.match(content, /"homepage": "https:\/\/github\.com\/toss\/apps-in-toss-harness"/);
    assert.equal(counts['package-homepage-harness'], 1);
  });

  test('an already-correct homepage is left untouched (idempotent, no phantom count)', () => {
    const src = '{\n  "name": "@apps-in-toss/debugger",\n  "homepage": "https://github.com/toss/apps-in-toss-harness"\n}\n';
    const { content, counts } = norm(src, 'packages/debugger/package.json');
    assert.equal(content, src);
    assert.equal(counts['package-homepage-harness'], undefined);
  });

  test('package.json outside SCOPED_PACKAGES (e.g. agent-plugin, a hardfork package) is not touched by this rule', () => {
    const src = '{\n  "name": "@apps-in-toss/agent-plugin",\n  "homepage": "https://www.npmjs.com/package/@ait-co/agent-plugin"\n}\n';
    const { content, counts } = norm(src, 'packages/agent-plugin/package.json');
    assert.equal(content, src);
    assert.equal(counts['package-homepage-harness'], undefined);
  });

  test('a homepage field elsewhere in the file (not package.json basename) does not trigger package-homepage-harness, but the npm registry URL inside it is still scope-renamed for a published package (scope-install is a separate, always-line-scanned rule)', () => {
    const src = '{\n  "homepage": "https://www.npmjs.com/package/@ait-co/devtools"\n}\n';
    const { content, counts } = norm(src, 'packages/devtools/some-other-file.json');
    assert.equal(content, '{\n  "homepage": "https://www.npmjs.com/package/@apps-in-toss/devtools"\n}\n');
    assert.equal(counts['package-homepage-harness'], undefined);
    assert.ok(counts['scope:install-forced'] >= 1);
  });

  test('the same registry-URL homepage field for debugger (permanently unpublished) is left untouched — no false rename', () => {
    const src = '{\n  "homepage": "https://www.npmjs.com/package/@ait-co/debugger"\n}\n';
    const { content, counts } = norm(src, 'packages/debugger/some-other-file.json');
    assert.equal(content, src);
    assert.equal(counts['package-homepage-harness'], undefined);
    assert.ok(counts['scope:install-blocked'] >= 1);
  });
});

describe('LICENSE copyright holder', () => {
  test('rewrites DaveDev42 to Viva Republica, Inc. only in a file literally named LICENSE', () => {
    const src = 'BSD 3-Clause License\n\nCopyright (c) 2026, DaveDev42\n\nRedistribution...\n';
    const { content, counts } = norm(src, 'packages/devtools/LICENSE');
    assert.match(content, /Copyright \(c\) 2026 Viva Republica, Inc\.\n/);
    assert.equal(counts['license-copyright'], 1);
  });

  test('does not touch a non-LICENSE file even if it quotes the same line', () => {
    const src = 'Copyright (c) 2026, DaveDev42\n';
    const { content } = norm(src, 'README.md');
    assert.equal(content, src);
  });
});

describe('preserved files — whole file skipped', () => {
  test('CHANGELOG.md is untouched', () => {
    const src = '- fix: something ([#1](https://github.com/apps-in-toss-community/devtools/issues/1))\n@ait-co/devtools\n';
    assert.equal(isPreservedFile('packages/devtools/CHANGELOG.md'), true);
    const { content, preserved } = norm(src, 'packages/devtools/CHANGELOG.md');
    assert.equal(content, src);
    assert.equal(preserved, true);
  });

  test('docs/superpowers design archive is untouched', () => {
    assert.equal(isPreservedFile('packages/devtools/docs/superpowers/plans/2026-04-12-sdk-example.md'), true);
  });

  test('meta/ design archive is untouched', () => {
    assert.equal(isPreservedFile('packages/devtools/meta/env3-test-execution-redesign.md'), true);
  });

  test('a package.json is NOT preserved (sanity check the matcher is not too broad)', () => {
    assert.equal(isPreservedFile('packages/devtools/package.json'), false);
  });

  test('eval/e2e/baseline.json (frozen measurement snapshot) is untouched — real regression', () => {
    // baseline.json의 templateBaseline은 메인테이너가 수동으로만 갱신하는 고정
    // 입력값이다. 자동 정규화 대상이면 스캐폴드 템플릿의 실제(아직 미배포라
    // 리네임되지 않는) 의존성 문자열과 어긋나게 된다.
    assert.equal(isPreservedFile('packages/agent-plugin/eval/e2e/baseline.json'), true);
    const src = '{\n  "fixedInputs": {\n    "templateBaseline": {\n      "@ait-co/devtools": "^0.1.19"\n    }\n  }\n}\n';
    const { content, preserved } = norm(src, 'packages/agent-plugin/eval/e2e/baseline.json');
    assert.equal(content, src);
    assert.equal(preserved, true);
  });

  test('validate-negative.test.ts (A2/docs-link-banned negative fixture) is untouched — real regression', () => {
    // 이 파일의 negative fixture는 의도적으로 https://docs.aitc.dev 링크를 심어
    // validate-plugin.mjs의 A2/docs-link-banned 규칙이 실제로 발화하는지 검증한다.
    // docs-deeplink-mcp 규칙이 이 링크를 MCP 안내 문구로 바꿔버리면 fixture가
    // 더 이상 "금지된 패턴"을 담지 않아 테스트가 무력화된다.
    assert.equal(isPreservedFile('packages/agent-plugin/shared/__tests__/validate-negative.test.ts'), true);
    const src = "    const broken = `[전체 문서](https://docs.aitc.dev)`;\n    expect(rulesFired(violations)).toContain('A2/docs-link-banned');\n";
    const { content, preserved } = norm(src, 'packages/agent-plugin/shared/__tests__/validate-negative.test.ts');
    assert.equal(content, src);
    assert.equal(preserved, true);
  });

  test('sibling validate.test.ts (positive fixtures, no banned-link samples) is NOT preserved (matcher precision)', () => {
    assert.equal(isPreservedFile('packages/agent-plugin/shared/__tests__/validate.test.ts'), false);
  });
});

describe('scope rename — external-target content (scaffold templates + inject references)', () => {
  test('path matcher: scaffold templates are external-target', () => {
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/templates/react-vite/package.json'), true);
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/templates/react-vite/vite.config.ts'), true);
  });

  test('path matcher: inject references dir is external-target', () => {
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/skills/inject/references/devtools.md'), true);
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/skills/inject/references/debug-console.md'), true);
  });

  test('path matcher: new-miniapp/SKILL.md is external-target', () => {
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/skills/new-miniapp/SKILL.md'), true);
  });

  test('path matcher: an unrelated agent-plugin file is NOT external-target', () => {
    assert.equal(isExternalTargetContent('packages/agent-plugin/shared/skills/debug/SKILL.md'), false);
    assert.equal(isExternalTargetContent('packages/devtools/src/unplugin/index.ts'), false);
  });

  test('template package.json devDependency is renamed by default now that devtools is npm-published (post-publish default)', () => {
    const src = '{\n  "devDependencies": {\n    "@ait-co/devtools": "^0.1.103"\n  }\n}\n';
    const { content, counts } = norm(src, 'packages/agent-plugin/shared/templates/react-vite/package.json');
    assert.equal(content, '{\n  "devDependencies": {\n    "@apps-in-toss/devtools": "^0.1.103"\n  }\n}\n');
    assert.equal(counts['scope:install-forced'], 1);
    assert.equal(counts['scope:functional-pkgjson'], undefined);
  });

  test('template vite.config.ts import specifier is renamed by default now that devtools is npm-published', () => {
    const src = "import aitDevtools from '@ait-co/devtools/unplugin';\n";
    const { content, counts } = norm(src, 'packages/agent-plugin/shared/templates/react-vite/vite.config.ts');
    assert.equal(content, "import aitDevtools from '@apps-in-toss/devtools/unplugin';\n");
    assert.equal(counts['scope:install-forced'], 1);
    assert.equal(counts['scope:functional-import'], undefined);
  });

  test('inject/references code sample (import-from form) stays consistent with the install command in the same doc — both rename together by default', () => {
    const src = [
      'pnpm add -D @ait-co/devtools            # pnpm',
      '',
      "import aitDevtools from '@ait-co/devtools/unplugin';",
      '',
    ].join('\n');
    const { content } = norm(src, 'packages/agent-plugin/shared/skills/inject/references/devtools.md');
    assert.ok(!content.includes('@ait-co/devtools'), 'install command and import sample must not disagree on scope');
    assert.equal(
      content,
      ['pnpm add -D @apps-in-toss/devtools            # pnpm', '', "import aitDevtools from '@apps-in-toss/devtools/unplugin';", ''].join(
        '\n',
      ),
    );
  });

  test('external-target files stay @ait-co/* when NORMALIZE_SCOPE_INSTALL=0 (escape hatch for a future unpublished package)', () => {
    const src = "import aitDevtools from '@ait-co/devtools/unplugin';\n";
    const { content, counts } = norm(src, 'packages/agent-plugin/shared/templates/react-vite/vite.config.ts', {
      NORMALIZE_SCOPE_INSTALL: '0',
    });
    assert.equal(content, src);
    assert.equal(counts['scope:install-blocked'], 1);
  });

  test('same file OUTSIDE the external-target path list still renames functional imports normally (no over-broadening)', () => {
    const src = "import aitDevtools from '@ait-co/devtools/unplugin';\n";
    const { content, counts } = norm(src, 'packages/devtools/vite.config.ts');
    assert.equal(content, "import aitDevtools from '@apps-in-toss/devtools/unplugin';\n");
    assert.equal(counts['scope:functional-import'], 1);
  });
});

describe('TEXT_LIKE_EXTENSIONS — shared allowlist between normalize-upstream.mjs CLI and sync-upstream.mjs runNormalize (#21)', () => {
  // 실측 근거: 예전엔 normalize-upstream.mjs의 CLI collectTargets()와
  // sync-upstream.mjs의 runNormalize()가 각자 다른 확장자 목록을 하드코딩했고,
  // 둘 다 .sh를 빠뜨렸다 — 두 layer가 서로 다른 목록을 들고 있던 것 자체가
  // #21의 원인 중 하나였다(하나만 고쳐선 다른 쪽이 여전히 갭). 지금은
  // sync-upstream.mjs가 이 export를 그대로 import해서 쓴다(단일 출처).
  test('.sh is included', () => {
    assert.equal(TEXT_LIKE_EXTENSIONS.has('.sh'), true);
  });

  test('.html and .webmanifest are deliberately NOT included (see docs/upstream-sync.md "수동 확인이 필요한 항목")', () => {
    assert.equal(TEXT_LIKE_EXTENSIONS.has('.html'), false);
    assert.equal(TEXT_LIKE_EXTENSIONS.has('.webmanifest'), false);
  });

  test('core code/doc extensions remain included', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.yaml', '.yml']) {
      assert.equal(TEXT_LIKE_EXTENSIONS.has(ext), true, `expected ${ext} to be text-like`);
    }
  });
});

describe('CLI robustness — trailing slash on the root path must not defeat path-anchored rules (regression)', () => {
  test('invoking with vs. without a trailing slash on the root directory yields the same dry-run report', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-cli-trailing-slash-'));
    try {
      const targetDir = path.join(tmpDir, 'packages', 'agent-plugin', 'shared', 'templates', 'fixture-tpl');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, 'package.json'),
        '{\n  "devDependencies": {\n    "@ait-co/devtools": "^0.1.0"\n  }\n}\n',
        'utf8',
      );

      const scriptPath = path.join(__dirname, '..', 'normalize-upstream.mjs');
      const rootNoSlash = path.join(tmpDir, 'packages');
      const rootWithSlash = `${rootNoSlash}/`;

      const outNoSlash = execFileSync('node', [scriptPath, rootNoSlash], { encoding: 'utf8' });
      const outWithSlash = execFileSync('node', [scriptPath, rootWithSlash], { encoding: 'utf8' });

      assert.equal(outWithSlash, outNoSlash, 'a trailing slash on the root arg must not change the dry-run report');
      // scope-install is on by default (devtools is npm-published) — the CLI runs
      // without env overrides, so the external-target package.json IS flagged as
      // changed here; the invariant under test is slash-insensitivity, not this count.
      assert.match(outNoSlash, /변경: 1/, 'external-target template package.json is renamed by default now');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('preserved eval-gate / provenance tokens (regression guard)', () => {
  test('ait-devtools MCP server key is never touched', () => {
    const src = "disallowedTools: ['mcp__ait-devtools__*']\n";
    const { content } = norm(src, 'packages/agent-plugin/eval/e2e/driver.test.ts');
    assert.equal(content, src);
  });

  test('aitcc blocked-pattern string is never touched', () => {
    const src = "const BLOCKED = /\\baitcc\\b/;\n";
    const { content } = norm(src, 'packages/agent-plugin/eval/e2e/driver.test.ts');
    assert.equal(content, src);
  });

  test('miniAppId 31146 literal is never touched', () => {
    const src = 'const miniAppId = 31146;\n';
    const { content } = norm(src, 'src/example.ts');
    assert.equal(content, src);
  });
});

describe('idempotency — combined realistic fixture', () => {
  test('running normalize twice yields identical output', () => {
    const src = [
      "import aitDevtools from '@ait-co/devtools/unplugin';",
      '',
      'export const DEBUGGER_DEV_BRIDGE_ID = \'@ait-co/debugger/dev-bridge\';',
      'export const LEGACY_IN_APP_ID = \'@ait-co/devtools/in-app\';',
      '',
      '(관련: [#290](https://github.com/apps-in-toss-community/devtools/issues/290))',
      'GitHub: https://github.com/apps-in-toss-community/devtools',
      '',
      '자세히: https://docs.aitc.dev/guides/relay-auth-totp',
      'guide: https://devtools.aitc.dev/guide/',
      '',
      '## License',
      '',
      'BSD 3-Clause',
      '',
      '---',
      '',
      'Community open-source project.',
      '',
    ].join('\n');

    const once = norm(src, 'packages/devtools/README.en.md');
    const twice = norm(once.content, 'packages/devtools/README.en.md');
    assert.equal(twice.content, once.content, 'second pass must be a no-op (idempotent)');

    // 그리고 정성적으로도 기대한 카테고리들이 실제로 트리거됐는지 확인.
    assert.match(once.content, /@apps-in-toss\/devtools\/unplugin/);
    assert.match(once.content, /@apps-in-toss\/debugger\/dev-bridge/);
    assert.match(once.content, /@ait-co\/devtools\/in-app/); // LEGACY 보존
    assert.match(once.content, /devtools#290/);
    assert.match(once.content, /apps-in-toss-harness\/tree\/main\/packages\/devtools/);
    assert.match(once.content, /apps-in-toss-docs MCP/);
    assert.match(once.content, /devtools\.aitc\.dev\/guide\//); // 해당 문자열을 대상으로 하는 치환 규칙이 없어 그대로 보존(PROTECTED_LITERALS 소속도 아님)
    assert.doesNotMatch(once.content, /Community open-source project\./);
  });
});
