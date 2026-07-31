// 실행: node --test scripts/__tests__/normalize-upstream.test.mjs
// (Node 24 내장 테스트 러너 — 의존성 추가 없음. 실행 방법은 docs/upstream-sync.md에도 기록.)
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { normalizeContent, isPreservedFile, PROTECTED_LITERALS, SCOPED_PACKAGES } from '../normalize-upstream.mjs';

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
    assert.equal(withoutFlag.counts['scope:legacy-preserved'], 1);
  });
});

describe('scope rename — install/registry paths (blockedUntilPublished)', () => {
  const cases = [
    ['npx -p install command', `npx -p @ait-co/debugger debugger\n`],
    ['pnpm add install command', `pnpm add @ait-co/debug-console\n`],
    ['npm install command', `npm install @ait-co/debug-console\n`],
    ['npm registry homepage URL', `"homepage": "https://www.npmjs.com/package/@ait-co/debug-console"\n`],
    ['install-detection grep string', `grep '"@ait-co/devtools"' package.json\n`],
  ];

  for (const [label, src] of cases) {
    test(`${label} — default skip`, () => {
      const { content, counts } = norm(src, 'README.md');
      assert.equal(content, src, 'must be left untouched by default');
      assert.ok(counts['scope:install-blocked'] >= 1);
    });

    test(`${label} — NORMALIZE_SCOPE_INSTALL=1 forces rename`, () => {
      const { content, counts } = norm(src, 'README.md', { NORMALIZE_SCOPE_INSTALL: '1' });
      assert.notEqual(content, src);
      assert.ok(SCOPED_PACKAGES.some((pkg) => content.includes(`@apps-in-toss/${pkg}`)));
      assert.ok(counts['scope:install-forced'] >= 1);
    });
  }
});

describe('scope rename — prose/comments (permanent preserve, matches real precedent)', () => {
  test('JSDoc comment mention is not renamed', () => {
    const src = ` * OPTIONAL peerDependencies of \`@ait-co/devtools\`:\n`;
    const { content, counts } = norm(src, 'src/unplugin/optional-peers.ts');
    assert.equal(content, src);
    assert.equal(counts['scope:prose-preserved'], 1);
  });

  test('README narrative mention is not renamed even with the install flag', () => {
    const src = '이 패키지는 `@ait-co/devtools`의 optional peer로 동작합니다.\n';
    const { content } = norm(src, 'README.md', { NORMALIZE_SCOPE_INSTALL: '1' });
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
    const src = 'https://devtools.aitc.dev/launcher/\n';
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
      'launcher: https://devtools.aitc.dev/launcher/',
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
    assert.match(once.content, /devtools\.aitc\.dev\/launcher\//); // 치환 금지 보존
    assert.doesNotMatch(once.content, /Community open-source project\./);
  });
});
