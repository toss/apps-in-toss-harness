/**
 * validate-negative.test.ts
 *
 * Fixture-based negative tests: 각 check 가 실제로 위반 시 fire 하는지 증명한다.
 *
 * 구조:
 *   buildValidFixture(dir)   — 최소한의 clean repo root 를 fs 에 직접 기록.
 *   rulesFired(violations)   — 위반 목록에서 rule ID 만 추출하는 헬퍼.
 *   각 테스트               — valid fixture 에서 시작 → 한 가지만 깨뜨림 → rule 발화 확인.
 *
 * clean baseline test 가 먼저 등장해 fixture 자체가 올바름을 단언한다.
 * 그 이후 각 negative case 는 그 baseline 위에서 one-thing-only 변이를 적용한다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// 헬퍼: rule ID 목록 추출
// ---------------------------------------------------------------------------

type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
  level: 'error' | 'warn';
};

function rulesFired(violations: Violation[]): string[] {
  return violations.map((v) => v.rule);
}

// ---------------------------------------------------------------------------
// 헬퍼: 최소 valid fixture 생성
//
// 픽스처 요건 요약 (validate-plugin.mjs 에서 직접 읽은 구조):
//   shared/skills/<name>/SKILL.md        — 올바른 frontmatter + 올바른 body
//   shared/commands/ait-<name>.md        — 올바른 frontmatter + skill 참조
//   shared/templates/<tpl>/template.json — 올바른 JSON + substitute files 존재
//   eval/promptfoo/promptfooconfig.yaml  — skills 블록에 skill name 포함
//   .claude-plugin/plugin.json           — version 일치
//   package.json                         — version 일치
//   CHANGELOG.md                         — package.json 버전의 '## <version>' 섹션 존재
//
// 주의: fixture 의 skill name 은 EXPECTED_CMD_TO_SKILL 에 없으므로 A1/routing-mismatch
// 가 발생한다 — 이는 "스냅샷이 픽스처 skill 을 모른다"는 정상 결과이고,
// hard-fail baseline test 에서 A1/routing-mismatch 는 허용 error 로 취급한다.
// A1/routing-mismatch 를 이번 negative test 에서 직접 시험할 때는 별도로 격리한다.
// ---------------------------------------------------------------------------

const SKILL_NAME = 'fix-skill'; // EXPECTED_CMD_TO_SKILL 에 없는 이름으로 고정
const CMD_FILE = `ait-${SKILL_NAME}.md`;

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * 최소 valid SKILL.md 본문 (올바른 frontmatter + 올바른 body).
 * exempt 목록에 없는 skill 이므로 docs MCP 언급, seam 둘 다 필수.
 * seam 은 슬래시 + 자연어 동치 2표면이어야 한다 (harness#101, §9).
 */
function validSkillMd(): string {
  return `---
name: ${SKILL_NAME}
description: Fixture skill for negative tests.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

픽스처 skill 이다.

<!-- docs MCP 언급 (A2/docs-mcp-mention-required 통과용) -->
필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행

\`\`\`
/ait:new   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"
\`\`\`

## 참고

- 없음
`;
}

/**
 * 최소 valid command 파일.
 */
function validCommandMd(argumentHint = ''): string {
  return `---
description: 'Fixture command.'
argument-hint: '${argumentHint}'
---

Load the \`${SKILL_NAME}\` skill.
`;
}

/**
 * 최소 valid template.json + substitute file.
 * substitute file 이름은 "config.md" — 토큰을 포함한다.
 */
const TPL_NAME = 'fix-tpl';
const TPL_SUBFILE = 'config.md';
const TPL_TOKEN = 'app_name';

function validTemplateJson(): string {
  return JSON.stringify({
    name: TPL_NAME,
    tokens: { [TPL_TOKEN]: { description: 'App name', example: 'My App' } },
    substitute: { files: [TPL_SUBFILE] },
  });
}

function validTemplateSubFile(): string {
  return `# {{${TPL_TOKEN}}}\n`;
}

/**
 * valid promptfoo config — skills 블록에 SKILL_NAME 포함.
 */
function validPromptfooYaml(): string {
  return `description: fixture eval
providers:
  - id: anthropic:claude-agent-sdk
    config:
      model: claude-sonnet-4-5
      setting_sources: ['project']
      working_dir: ./eval/promptfoo/fixture
      skills:
        - ${SKILL_NAME}
prompts:
  - '{{utterance}}'
tests: []
`;
}

/**
 * valid CHANGELOG.md — fixture package.json 버전('0.1.0')의 '## 0.1.0' 섹션을 포함.
 */
function validChangelogMd(): string {
  return `# @apps-in-toss/agent-plugin

## 0.1.0

### Patch Changes

- fixture: 픽스처용 CHANGELOG 항목.
`;
}

/**
 * fixture root 에 최소 valid 파일들을 기록한다.
 */
function buildValidFixture(dir: string): void {
  // shared/skills
  writeFile(path.join(dir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), validSkillMd());

  // shared/commands
  writeFile(path.join(dir, 'shared', 'commands', CMD_FILE), validCommandMd(''));

  // shared/templates
  writeFile(path.join(dir, 'shared', 'templates', TPL_NAME, 'template.json'), validTemplateJson());
  writeFile(path.join(dir, 'shared', 'templates', TPL_NAME, TPL_SUBFILE), validTemplateSubFile());

  // eval/promptfoo
  writeFile(path.join(dir, 'eval', 'promptfoo', 'promptfooconfig.yaml'), validPromptfooYaml());

  // .claude-plugin/plugin.json + package.json — 버전 일치
  writeFile(
    path.join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'ait', version: '0.1.0' }),
  );
  writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@apps-in-toss/agent-plugin', version: '0.1.0' }),
  );

  // CHANGELOG.md — package.json 버전('0.1.0')의 섹션 존재
  writeFile(path.join(dir, 'CHANGELOG.md'), validChangelogMd());
}

// ---------------------------------------------------------------------------
// 테스트 픽스처 lifecycle
// ---------------------------------------------------------------------------

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ait-validate-fix-'));
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

// ---------------------------------------------------------------------------
// 임포트 (ESM dynamic import — vitest 환경)
// ---------------------------------------------------------------------------

// runChecks 를 동적 import 한다 (ESM). 전체 suite 에서 공유한다.
async function runChecks(dir: string): Promise<{ violations: Violation[]; hasErrors: boolean }> {
  const { runChecks: fn } = (await import('../../scripts/validate-plugin.mjs')) as {
    runChecks: (root: string) => { violations: Violation[]; hasErrors: boolean };
  };
  return fn(dir);
}

// ---------------------------------------------------------------------------
// 베이스라인: valid fixture 는 hard-fail (error-level, non-routing) 을 내지 않는다
// ---------------------------------------------------------------------------

/**
 * A1/routing-mismatch 는 픽스처 skill 이 EXPECTED_CMD_TO_SKILL 에 없어서 항상 발생한다.
 * 이것은 픽스처 설계상 불가피한 "허용된 노이즈"이므로 hard-fail baseline 에서 제외한다.
 * 이 제외 처리는 "fixture-internal routing 불일치"를 무시하는 것이 맞는지 확인하기 위해
 * 명시적으로 문서화한다.
 */
function hardFailsExcludingRoutingNoise(violations: Violation[]): Violation[] {
  return violations.filter(
    (v) => v.level === 'error' && v.rule !== 'A1/routing-mismatch', // 픽스처 skill 이 스냅샷에 없음 — 의도된 노이즈
  );
}

describe('validate-plugin — fixture baseline', () => {
  it('valid fixture 는 hard-fail (routing noise 제외) 이 없어야 한다', async () => {
    buildValidFixture(tmpDir);
    const { violations } = await runChecks(tmpDir);
    const hardFails = hardFailsExcludingRoutingNoise(violations);

    if (hardFails.length > 0) {
      const lines = hardFails.map((v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`);
      throw new Error(`fixture baseline 에 unexpected hard-fail 발생:\n${lines.join('\n')}`);
    }

    expect(hardFails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A1 — frontmatter + 1:1 매핑 + 라우팅
// ---------------------------------------------------------------------------

describe('A1 negative tests', () => {
  it('대응 command 가 없는 skill 은 위반이 아니다 (A1/skill-orphan 폐지, harness#134)', async () => {
    buildValidFixture(tmpDir);
    // command 파일 제거 → skill 만 남는다. 이게 **선호 형상**이다: skill 디렉터리
    // 하나로 `/ait:<name>` 슬래시가 만들어지고 stub 은 잉여다. 종전 A1/skill-orphan
    // 은 stub 존재를 강제해 이름 충돌(=skill 본문 미로드)을 만들어내던 규칙이라
    // 폐지했다 — 그 폐지가 실수로 되돌려지지 않게 여기서 못박는다.
    fs.rmSync(path.join(tmpDir, 'shared', 'commands', CMD_FILE));
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A1/skill-orphan');
    expect(rulesFired(violations)).not.toContain('A1/cmd-name-shadows-skill');
    expect(rulesFired(violations)).not.toContain('A1/skill-name-collides-command');
  });

  it('A1/routing-mismatch — command 가 스냅샷에 없는 skill 을 참조하면 routing-mismatch 가 난다', async () => {
    buildValidFixture(tmpDir);
    // 이미 EXPECTED_CMD_TO_SKILL 에 없는 CMD_FILE → routing-mismatch 가 항상 발생
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A1/routing-mismatch');
  });

  it('A1/argument-hint-mismatch — command 와 skill 의 argument-hint 가 다르면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // command 의 argument-hint 만 변경 (skill 은 '' 유지)
    writeFile(
      path.join(tmpDir, 'shared', 'commands', CMD_FILE),
      validCommandMd('<app-name>'), // skill 은 '' 인데 command 만 다르게
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A1/argument-hint-mismatch');
  });
});

// ---------------------------------------------------------------------------
// A2 — 본문 구조 + seam
// ---------------------------------------------------------------------------

describe('A2 negative tests', () => {
  it('A2/wrong-first-h2-heading — 첫 H2 가 ## 목적 이 아니면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 개요

다른 제목으로 시작하면 안 된다.

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/wrong-first-h2-heading');
  });

  it('A2/blockquote-after-heading — 첫 heading 직후 > blockquote 는 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

> 이건 금지된 blockquote 다.

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/blockquote-after-heading');
  });

  it('A2/docs-link-banned — docs.aitc.dev 루트 링크는 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

[전체 문서](https://docs.aitc.dev)

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/docs-link-banned');
  });

  it('A2/docs-link-banned — docs.aitc.dev 주제별 deep-link 도 위반이 난다 (전면 금지, 루트/intro 한정 아님)', async () => {
    buildValidFixture(tmpDir);
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

[가이드](https://docs.aitc.dev/guides/example)

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/docs-link-banned');
  });

  it('A2/docs-mcp-mention-required — docs MCP 언급 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // docs MCP 언급 없이 seam 만 있는 SKILL.md
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문. 문서 안내 없음.

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/docs-mcp-mention-required');
  });

  it('A2/no-seam — ## 참고 이전 본문에 /ait 참조가 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // seam 을 ## 참고 뒤로 이동하거나 완전히 제거
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문. seam 없음.

필요하면 docs MCP(searchDocumentation)로 조회한다.

## 참고

- 없음
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/no-seam');
  });

  it('A2/seam-not-printed — /ait 가 산문에만 있고 fenced block 에 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // fenced block 밖 산문에만 /ait 언급
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문. 다음으로 /ait:new 를 실행하세요 (산문에만 있음).

필요하면 docs MCP(searchDocumentation)로 조회한다.
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    // /ait 가 존재하므로 no-seam 이 아닌 seam-not-printed 가 발화해야 한다
    expect(rulesFired(violations)).toContain('A2/seam-not-printed');
    expect(rulesFired(violations)).not.toContain('A2/no-seam');
  });

  it('A2/seam-nl-missing — 인쇄 seam 이 슬래시 단일 표면이면 위반이 난다 (harness#101)', async () => {
    buildValidFixture(tmpDir);
    // fenced seam 은 있으나 자연어 동치(`말로: "..."`)가 없다.
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

## 실행

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/seam-nl-missing');
    // 기존 3겹은 통과한 상태에서 확장 규칙만 발화해야 한다 (대체가 아니라 확장).
    expect(fired).not.toContain('A2/no-seam');
    expect(fired).not.toContain('A2/seam-not-printed');
  });

  it('A2/seam-nl-block-incomplete — 자연어 동치가 없는 명령 블록이 하나라도 있으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // 첫 블록은 2표면(→ seam-nl-missing 은 침묵), 둘째 블록은 슬래시 단독.
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

## 실행

\`\`\`
/ait:new   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"
\`\`\`

## 그 다음

\`\`\`
/ait:debug
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/seam-nl-block-incomplete');
    expect(fired).not.toContain('A2/seam-nl-missing');
  });

  it('A2 seam 2표면 — 산문 속 /ait 언급은 블록 검사를 발화시키지 않는다 (스코프 한정)', async () => {
    buildValidFixture(tmpDir);
    // 두 번째 블록은 줄 머리가 아닌 위치에서만 /ait 를 언급한다 → 명령 블록이 아니다.
    const ok = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

## 실행

\`\`\`
/ait:new   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"
\`\`\`

## 그 다음

\`\`\`
예: cd <project-root> && /ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), ok);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).not.toContain('A2/seam-nl-block-incomplete');
    expect(fired).not.toContain('A2/seam-nl-missing');
  });
});

// ---------------------------------------------------------------------------
// A3 — 템플릿 + eval 동기화
// ---------------------------------------------------------------------------

describe('A3 negative tests', () => {
  it('A3/token-in-tsx — .tsx 파일에 {{token}} 이 있으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // .tsx 파일에 토큰 추가
    writeFile(
      path.join(tmpDir, 'shared', 'templates', TPL_NAME, 'App.tsx'),
      `export default function App() { return <div>{{${TPL_TOKEN}}}</div>; }\n`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A3/token-in-tsx');
  });

  it('A3/token-used-not-declared — substitute file 에서 쓰는 토큰이 template.json tokens 에 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // substitute file 에 미선언 토큰 추가
    writeFile(
      path.join(tmpDir, 'shared', 'templates', TPL_NAME, TPL_SUBFILE),
      `# {{${TPL_TOKEN}}}\n\nUndeclared: {{undeclared_token}}\n`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A3/token-used-not-declared');
  });

  it('A3/promptfoo-skill-missing — disk skill 이 promptfooconfig.yaml 에 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // promptfoo yaml 에서 SKILL_NAME 제거
    const yamlWithoutSkill = `description: fixture eval
providers:
  - id: anthropic:claude-agent-sdk
    config:
      model: claude-sonnet-4-5
      setting_sources: ['project']
      working_dir: ./eval/promptfoo/fixture
      skills:
        - other-skill-not-on-disk
prompts:
  - '{{utterance}}'
tests: []
`;
    writeFile(path.join(tmpDir, 'eval', 'promptfoo', 'promptfooconfig.yaml'), yamlWithoutSkill);
    const { violations } = await runChecks(tmpDir);
    // disk 에 SKILL_NAME 있지만 yaml 에 없음 → promptfoo-skill-missing
    expect(rulesFired(violations)).toContain('A3/promptfoo-skill-missing');
  });
});

// ---------------------------------------------------------------------------
// A5 — plugin.json ↔ package.json 버전 드리프트
// ---------------------------------------------------------------------------

describe('A5 negative tests', () => {
  it('A5/plugin-json-version-drift — plugin.json 버전이 package.json 과 다르면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // plugin.json 버전만 다르게
    writeFile(
      path.join(tmpDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'ait', version: '0.0.1' }), // package.json 은 0.1.0
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A5/plugin-json-version-drift');
  });
});

// ---------------------------------------------------------------------------
// A7 — mcpServers npx args 해석 가능성
// ---------------------------------------------------------------------------

describe('A7 negative tests', () => {
  it('A7/mcp-npx-bare-bin — npx args 가 -p 없이 패키지+bin 토큰을 두면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // bare form: ["-y", "<pkg>", "<bin>"] — npm 이 bin 을 추론해야 해서 모호.
    writeFile(
      path.join(tmpDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'ait',
        version: '0.1.0', // package.json 과 일치 (A5 격리)
        mcpServers: {
          'ait-devtools': { command: 'npx', args: ['-y', '@ait-co/devtools', 'devtools-mcp'] },
        },
      }),
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A7/mcp-npx-bare-bin');
  });

  it('A7/mcp-npx-bare-bin — -p/--package 형태는 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    // 올바른 form: ["-y", "-p", "<pkg>", "<bin>"] — bin 추론 모호성 없음.
    writeFile(
      path.join(tmpDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'ait',
        version: '0.1.0',
        mcpServers: {
          'ait-devtools': {
            command: 'npx',
            args: ['-y', '-p', '@ait-co/devtools', 'devtools-mcp'],
          },
        },
      }),
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A7/mcp-npx-bare-bin');
  });
});

// ---------------------------------------------------------------------------
// A8 — seam /ait:verb 형태·해석 가능성
// ---------------------------------------------------------------------------

describe('A8 negative tests', () => {
  it('A8/seam-verb-unresolved — fenced seam 이 실재하지 않는 /ait verb 를 인쇄하면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // fenced 블록 안에 stale/typo verb (`deploy-bundle` 는 ait-deploy-bundle.md 부재).
    const broken = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait:deploy-bundle
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), broken);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A8/seam-verb-unresolved');
  });

  it('A8/seam-verb-unresolved — 합법 verb (/ait:new) 는 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    // 기본 fixture SKILL.md 의 seam 은 `/ait:new` (합법) → A8 silent.
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A8/seam-verb-unresolved');
  });

  it('A8/seam-verb-unresolved — 산문(non-fenced) 속 stale verb 는 발화하지 않는다 (스코프 한정)', async () => {
    buildValidFixture(tmpDir);
    // fenced 블록엔 합법 verb, 산문엔 stale verb — A8 은 인쇄(fenced) 토큰만 본다.
    const proseOnly = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

이전엔 /ait:deploy-bundle 를 안내했지만 지금은 아래 명령을 쓰세요 (산문 언급).

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait:new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), proseOnly);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A8/seam-verb-unresolved');
  });

  it('A8/seam-verb-space-form — 공백 형태 `/ait <verb>` 를 인쇄하면 위반이 난다 (#286)', async () => {
    buildValidFixture(tmpDir);
    // verb 자체는 합법(`new`)이지만 **형태**가 존재하지 않는 명령이다 —
    // `/ait` 라는 명령이 없어 `Unknown command: /ait` 로 끝난다.
    const spaceForm = `---
name: ${SKILL_NAME}
description: Fixture skill.
argument-hint: ''
---

# ${SKILL_NAME} skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait new
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', SKILL_NAME, 'SKILL.md'), spaceForm);
    const fired = rulesFired((await runChecks(tmpDir)).violations);
    expect(fired).toContain('A8/seam-verb-space-form');
    // 합법 verb 이므로 resolve 규칙은 조용해야 한다 — 두 규칙은 직교한다.
    expect(fired).not.toContain('A8/seam-verb-unresolved');
  });

  it('A8/seam-verb-space-form — 콜론 형태는 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    // 기본 fixture 의 seam 은 `/ait:new` (콜론 형태) → silent.
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A8/seam-verb-space-form');
  });
});

// ---------------------------------------------------------------------------
// A10 — CHANGELOG.md 버전 섹션 존재
// ---------------------------------------------------------------------------
//
// 0.1.22/0.1.23 드리프트(package.json 버전만 올라가고 CHANGELOG.md 는 그
// 전 버전에 멈춰 있던 것) 재발 방지 회귀 테스트.

describe('A10 negative tests', () => {
  it('A10/changelog-version-missing — CHANGELOG.md 에 현재 버전 섹션이 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // 버전 섹션 없는 CHANGELOG (다른 버전 섹션만 존재 — 드리프트 시뮬레이션).
    writeFile(
      path.join(tmpDir, 'CHANGELOG.md'),
      `# @apps-in-toss/agent-plugin

## 0.0.9

### Patch Changes

- fixture: 이전 버전 섹션만 남아있다.
`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A10/changelog-version-missing');

    // 복원하면(negative → positive 왕복 실증) 다시 조용해진다.
    writeFile(path.join(tmpDir, 'CHANGELOG.md'), validChangelogMd());
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A10/changelog-version-missing');
  });

  it('A10/changelog-version-missing — CHANGELOG.md 파일 자체가 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    fs.rmSync(path.join(tmpDir, 'CHANGELOG.md'));
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A10/changelog-version-missing');
  });

  it('A10/changelog-version-missing — 현재 버전 섹션이 있으면 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A10/changelog-version-missing');
  });
});

// ---------------------------------------------------------------------------
// A2/brand-guard-section-* — 토스 브랜드·UI 모방 방지 가드 절 (harness#104)
// ---------------------------------------------------------------------------
//
// 검사 대상은 BRAND_GUARD_REQUIRED_SKILLS(현재 'design')뿐이라, 여기서는
// 픽스처에 'design' 이라는 이름의 skill 을 직접 만들어 검사한다(공통
// SKILL_NAME='fix-skill' 픽스처는 대상이 아니므로 이 규칙에 무반응이어야
// 정상 — positive control 로 그것도 함께 검증한다).

const DESIGN_SKILL_NAME = 'design';
const DESIGN_CMD_FILE = `${DESIGN_SKILL_NAME}.md`;
const QUALITY_BAR_REL = path.join(
  'shared',
  'skills',
  DESIGN_SKILL_NAME,
  'references',
  'quality-bar.md',
);

/**
 * 가드 절 + 체크포인트(0단계) 를 모두 포함한 최소 valid design SKILL.md
 * (harness#104 절 + harness#137 체크포인트 절 — 둘 다 있어야 clean baseline).
 */
function validDesignSkillMd(): string {
  return `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

픽스처 design skill이다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지
- 토스 전용 본문 서체 사용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출
전에 멈추고 아래 형태로 사용자에게 알리고 답을 기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`

### 1. 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
}

function validDesignCommandMd(): string {
  return `---
description: 'Fixture design command.'
argument-hint: ''
---

Load the \`${DESIGN_SKILL_NAME}\` skill.
`;
}

/** references/quality-bar.md 의 G0 절 — G0-1~G0-5 5항목을 모두 포함한 valid 버전. */
function validQualityBarMd(): string {
  return `# 디자인 품질 판정 기준 (quality bar)

## G0 — 브랜드·IP 안전 (차단)

| # | 항목 | 근거 |
|---|---|---|
| G0-1 | 토스 로고·워드마크를 아이콘·화면·등록 자산에 쓰지 않았다 | H |
| G0-2 | 토스 브랜드 컬러를 미니앱 primary 색으로 채택하지 않았다 | H |
| G0-3 | 토스 앱 화면(특히 로그인/인증)의 구성을 복제하지 않았다 | H |
| G0-4 | "토스" 상호로 미니앱 자체를 토스 공식 제품처럼 표방하지 않았다 | H |
| G0-5 | 토스 전용 본문 서체를 쓰지 않았다 | H |

## G1 — 컨테이너 적합성

픽스처 본문.
`;
}

function writeValidQualityBar(dir: string): void {
  writeFile(path.join(dir, QUALITY_BAR_REL), validQualityBarMd());
}

describe('A2/brand-guard negative tests (harness#104)', () => {
  it('가드 절이 있는 design skill 은 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    writeValidQualityBar(tmpDir);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).not.toContain('A2/brand-guard-section-missing');
    expect(fired).not.toContain('A2/brand-guard-content-incomplete');
    // harness#137 — 집행 절차(체크포인트) + quality-bar G0 절도 clean baseline 에서는 조용해야 한다.
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-incomplete');
    expect(fired).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('A2/brand-guard-section-missing — 가드 절 자체가 사라지면 위반이 난다 (절 삭제 회귀 방지)', async () => {
    buildValidFixture(tmpDir);
    const withoutSection = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

가드 절이 삭제된 상태를 시뮬레이션한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withoutSection);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-section-missing');

    // 절을 복원하면(negative → positive 왕복 실증) 다시 조용해진다.
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-section-missing');
  });

  it('A2/brand-guard-content-incomplete — 절은 있지만 필수 항목(예: 로고 언급)이 빠지면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const incomplete = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

가드 절은 있지만 내용이 부실한 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

이것저것 조심하세요.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), incomplete);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-content-incomplete');
    // section-missing 은 아니어야 한다 — 두 규칙은 직교한다(절은 있음, 내용만 부실).
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-section-missing');
  });

  // 서체 축은 나중에 추가된 5번째 금지 항목이라, 나머지 4축이 모두 있어도
  // 이것만 빠지면 잡히는지를 따로 못 박는다. 검사 정규식을 넓게(`서체|폰트`)
  // 걸면 같은 절의 "시스템 폰트 스택" 대안 문장이 대신 매치돼 이 케이스가
  // 조용히 통과한다 — 그 회귀를 여기서 잡는다.
  it('A2/brand-guard-content-incomplete — 나머지 4축이 다 있어도 서체 금지 항목만 빠지면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const withoutFontItem = validDesignSkillMd().replace(
      '- 토스 전용 본문 서체 사용 금지\n',
      // 대안 문장은 남겨 둔다 — 넓은 정규식이면 여기에 걸려 통과해 버린다.
      '\n본문 서체는 시스템 폰트 스택을 기본으로 한다.\n',
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      withoutFontItem,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-content-incomplete');
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-section-missing');
  });

  it('BRAND_GUARD_REQUIRED_SKILLS 밖의 skill(fix-skill)은 가드 절이 없어도 발화하지 않는다 (스코프 한정)', async () => {
    buildValidFixture(tmpDir); // fix-skill 은 가드 절 없이 생성됨
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).not.toContain('A2/brand-guard-section-missing');
    expect(fired).not.toContain('A2/brand-guard-content-incomplete');
    // harness#137 — 스코프 한정은 세 규칙 모두 동일해야 한다.
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-incomplete');
    expect(fired).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });
});

// ---------------------------------------------------------------------------
// A2/brand-guard-checkpoint-* · A2/brand-guard-quality-bar-incomplete
// (harness#137) — "토스 브랜드·UI 모방 금지" 절은 금지 목록을 **선언**할 뿐이고,
// 그걸 산출 전에 실제로 **집행**하는 절차(0단계 체크포인트)와 산출물을
// 채점하는 두 번째 관문(quality-bar.md G0)은 harness#104 검사기가 강제하지
// 않았다 — 절만 지워도 CI가 초록이었다. 아래는 그 갭을 메우는 negative test.
// ---------------------------------------------------------------------------

describe('A2/brand-guard-checkpoint negative tests (harness#137)', () => {
  it('체크포인트 절이 있는 design skill 은 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });

  it('A2/brand-guard-checkpoint-missing — 0단계 절 자체가 사라지면 위반이 난다 (절 삭제 회귀 방지)', async () => {
    buildValidFixture(tmpDir);
    // "토스 브랜드·UI 모방 금지" 선언 절은 온전하지만, 그걸 집행하는 0단계
    // 절차가 통째로 빠진 상태를 시뮬레이션한다 — harness#137 이 잡아야 할
    // 정확히 그 갭(선언은 있고 집행은 없음).
    const withoutCheckpoint = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트 절이 삭제된 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지
- 토스 전용 본문 서체 사용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      withoutCheckpoint,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-missing');
    // 선언 절(harness#104)은 온전하므로 그 규칙들은 조용해야 한다 — 두 갭은 직교한다.
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-section-missing');
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');

    // 복원하면(negative → positive 왕복 실증) 다시 조용해진다.
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-missing');
  });

  it('A2/brand-guard-checkpoint-incomplete — "예외 아님" 문구가 빠지면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const missingException = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트는 있지만 "예외 아님" 문구가 빠진 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

걸리는 항목이 있으면 산출 전에 멈추고 아래 형태로 사용자에게 알리고 답을
기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`

### 1. 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      missingException,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/brand-guard-checkpoint-incomplete');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });

  it('A2/brand-guard-checkpoint-incomplete — 차단 메시지 템플릿(fenced 블록)이 빠지면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    const missingTemplate = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트는 있지만 차단 메시지 템플릿이 빠진 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출
전에 멈추고 사용자에게 알리고 답을 기다린다 — 다만 어떤 형태로 알리는지는
템플릿 없이 이 문장으로만 설명한다.

### 1. 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      missingTemplate,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-incomplete');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });
});

// ---------------------------------------------------------------------------
// harness#137 적대 검증 우회 재현 — 4가지 우회를 실제로 만들어서 해당 규칙이
// 정말 fire 하는지 증명한다 (+ 오탐 수정 positive control).
// ---------------------------------------------------------------------------

describe('A2/brand-guard HTML 주석 우회 negative tests (harness#137 적대 검증 우회 #1·#2)', () => {
  it('우회 #1 — G0 절에 실제로는 없는 항목을 HTML 주석 안에 채워 넣어도(디코이) 속지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    // 실제 표는 G0-1·G0-2 만 있고 G0-3·G0-4 는 없다. 대신 렌더링되면 안 보이는
    // HTML 주석 안에 4항목 전부를 나열해 substring 검사(.includes('G0-3'))를
    // 속이려는 시도를 시뮬레이션한다.
    const decoyQualityBar = `# 디자인 품질 판정 기준 (quality bar)

## G0 — 브랜드·IP 안전 (차단)

<!-- G0-1, G0-2, G0-3, G0-4 -->

| # | 항목 | 근거 |
|---|---|---|
| G0-1 | 로고·워드마크 금지 | H |
| G0-2 | 브랜드 컬러 금지 | H |

## G1 — 컨테이너 적합성

픽스처 본문.
`;
    writeFile(path.join(tmpDir, QUALITY_BAR_REL), decoyQualityBar);
    const { violations } = await runChecks(tmpDir);
    const g0Messages = violations
      .filter((v) => v.rule === 'A2/brand-guard-quality-bar-incomplete')
      .map((v) => v.message);
    // 주석 안 디코이 문자열에 속았다면 G0-3·G0-4 가 "있음"으로 판정돼 이
    // 메시지들이 비어 있어야 한다 — stripHtmlComments 가 없으면 이 assertion 이 깨진다.
    expect(g0Messages.some((m) => m.includes("'G0-3'"))).toBe(true);
    expect(g0Messages.some((m) => m.includes("'G0-4'"))).toBe(true);

    writeValidQualityBar(tmpDir);
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('우회 #2 — 0단계 절 전체를 HTML 주석으로 감싸 숨겨도 checkpoint-missing 이 발화한다', async () => {
    buildValidFixture(tmpDir);
    // 사람이 보는 GitHub PR 렌더링 diff 에서는 <!-- ... --> 안이 통째로 안
    // 보인다 — heading 까지 포함해 절 전체를 주석으로 감싸는 우회를 재현한다.
    const wholeCheckpointCommented = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

0단계 절 전체가 HTML 주석으로 숨겨진 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

<!--
### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출
전에 멈추고 아래 형태로 사용자에게 알리고 답을 기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`
-->

### 1. 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      wholeCheckpointCommented,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    // raw substring 검사였다면 주석에 감싸인 heading·내용을 그대로 찾아내
    // missing/incomplete 어느 쪽도 fire 하지 않았을 것이다.
    expect(fired).toContain('A2/brand-guard-checkpoint-missing');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-missing');
  });
});

describe('A2/brand-guard-checkpoint-incomplete — 차단 메시지 템플릿 특징 문구 negative tests (harness#137 적대 검증 우회 #3)', () => {
  it('fenced 블록은 있지만 무관한 내용(예: echo "ok")만 남으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // "블록 존재"만 보던 종전 검사는 이 fixture 를 통과시켰다 — 실제 차단
    // 메시지를 지우고 무관한 코드펜스만 남긴 우회를 재현한다.
    const irrelevantBlock = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트 fenced 블록이 무관한 내용으로 대체된 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출
전에 멈추고 사용자에게 알리고 답을 기다린다:

\`\`\`bash
echo "ok"
\`\`\`

### 1. 실행

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      irrelevantBlock,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const checkpointIncomplete = violations.filter(
      (v) => v.rule === 'A2/brand-guard-checkpoint-incomplete',
    );
    expect(checkpointIncomplete.length).toBeGreaterThan(0);
    expect(checkpointIncomplete.some((v) => v.message.includes('실제 차단 메시지 템플릿'))).toBe(
      true,
    );
    // 위치는 정상(0단계가 첫 하위 단계)이므로 not-first 는 발화하지 않는다.
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-not-first');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });
});

describe('A2/brand-guard-checkpoint-not-first negative tests (harness#137 적대 검증 우회 #4)', () => {
  it('0단계 절이 실행 순서의 첫 하위 단계가 아니면(뒤로 밀리면) 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // heading 존재 검사만으로는 0단계가 다른 단계 뒤로 밀려도 통과했다 —
    // 관문이 도구 호출보다 늦게 오는 우회를 재현한다.
    const checkpointNotFirst = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

0단계가 실행 순서의 첫 단계가 아닌 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

## 실행 순서

### 1. Figma MCP 탐지

체크포인트보다 먼저 오는 무관한 단계 — 이 단계가 먼저 실행되면 관문을 우회한다.

\`\`\`
/ait:detect
\`\`\`

### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)

사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출
전에 멈추고 아래 형태로 사용자에게 알리고 답을 기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      checkpointNotFirst,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/brand-guard-checkpoint-not-first');
    // 절 자체는 존재하고 내용도 완비돼 있으므로 다른 두 규칙은 조용해야 한다.
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-incomplete');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-not-first');
  });

  it('"## 실행 순서" heading 자체가 없으면 위치를 확인할 수 없다는 사실을 위반으로 보고한다(조용히 skip 하지 않음)', async () => {
    buildValidFixture(tmpDir);
    const noExecOrderHeading = validDesignSkillMd().replace('## 실행 순서\n\n', '');
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      noExecOrderHeading,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-not-first');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-not-first');
  });
});

// ---------------------------------------------------------------------------
// harness#137 적대 검증 **2회차** — 구조 재설계로 막은 우회 4종 + 오탐 1종.
//
// 2회차 우회는 전부 "검사기의 모델"을 노린 것이었다: 위치를 heading 절로
// 판단하는 것(우회 #1·#1b), heading 을 모양으로만 수락하는 것(우회 #2), 절의
// 끝을 다음 '### ' 토큰 하나로만 정하는 것(우회 #4). 그래서 정규식을 더 얹는
// 대신 모델을 바꿨다 — 문자 오프셋 기준 문서 전체 스캔, heading 의 뜻 판정,
// 다중 경계(진짜 heading / 강등된 단계 라벨 / 줄 수 상한).
//
// 아래 각 케이스는 **positive(우회 문서에서 발화) + negative(정상 문서에서
// 무반응)** 쌍으로 둔다. 오탐은 미탐만큼 해롭다 — 정직한 리라이팅을 벌하는
// lint 는 저자에게 검사를 우회하는 법을 가르치기 때문이다.
// ---------------------------------------------------------------------------

const DESIGN_CHECKPOINT_HEADING = '### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)';
const DESIGN_EXEC_ORDER_HEADING = '## 실행 순서';

/** 체크포인트 관련 rule 만 추린다 — 픽스처 노이즈(A1/routing-mismatch 등)와 분리. */
function checkpointRulesFired(violations: Violation[]): string[] {
  return rulesFired(violations).filter((r) => r.startsWith('A2/brand-guard'));
}

describe('A2/brand-guard-asset-before-checkpoint (harness#137 2회차 우회 #1·#1b)', () => {
  it('우회 #1 — "## 실행 순서" 아래 "### 0." heading **앞**의 산문 지시문을 잡는다 (heading 이 아니어서 종전 위치 검사가 못 봤다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const proseBeforeCheckpoint = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n\n${DESIGN_CHECKPOINT_HEADING}`,
      `${DESIGN_EXEC_ORDER_HEADING}

**먼저 자산 뼈대를 잡아 둔다** — \`Write\` 도구로 \`assets/NOTES.md\` 를 작성한다.
그리고 \`Bash\` 로 \`mkdir -p assets\` 를 실행한다.

${DESIGN_CHECKPOINT_HEADING}`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      proseBeforeCheckpoint,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
    // 절 자체는 온전하므로 존재/내용/위치 규칙은 조용해야 한다 — 직교성 확인.
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-not-first');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('우회 #1b — "## 실행 순서" **앞**에 새 H2 절을 만들어도 잡는다 (종전 스캔 범위 밖이었다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const newSectionBefore = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 자산 생성

이 절은 실행 순서보다 먼저 온다. \`Write\` 도구로 \`assets/NOTES.md\` 를 작성한다.
\`Bash\` 로 \`mkdir -p assets\` 를 실행한다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      newSectionBefore,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('관문 앞의 **인쇄되는 파일 생성 명령 블록**도 잡는다 (산문 휴리스틱과 독립인 구조 신호)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const cmdBlockBefore = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n\n${DESIGN_CHECKPOINT_HEADING}`,
      `${DESIGN_EXEC_ORDER_HEADING}

\`\`\`bash
mkdir -p assets
magick -size 600x600 xc:#6B7280 assets/logo.png
\`\`\`

${DESIGN_CHECKPOINT_HEADING}`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), cmdBlockBefore);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 도구 이름을 **금지 문맥**으로 인용하는 문단은 발화하지 않는다 (0단계 선언문 자체가 그렇다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    // 실제 shared/skills/design/SKILL.md 0단계 첫 문단을 그대로 옮겼다 —
    // 이 문단은 도구 토큰을 전부 담고 있지만 "호출하지 않는다"는 금지다.
    const prohibitionParagraph = validDesignSkillMd().replace(
      `${DESIGN_CHECKPOINT_HEADING}\n`,
      `${DESIGN_CHECKPOINT_HEADING}

**이 관문을 통과하기 전에는 자산·코드를 만드는 도구를 호출하지 않는다.**
\`Write\`·\`Edit\`은 물론 \`Bash\`로 파일을 만드는 것(\`mkdir -p assets\`,
\`cat > src/... <<'EOF'\`, \`magick\`/\`sips\`/Pillow 호출)도 전부 해당한다.
`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      prohibitionParagraph,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 도구의 **가용성**을 서술하는 의존 절(조건형 "만들려면 … 활용한다")도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const dependencySection = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 의존

- **이미지 도구 (선택, 자산 리사이즈용)**: 정확한 규격으로 PNG를 만들려면
  ImageMagick(\`magick\`/\`convert\`)이나 \`sips\`(macOS), 또는 다른 로컬 이미지
  도구가 있으면 활용한다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      dependencySection,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });
});

describe('A2/brand-guard-checkpoint-heading-negated (harness#137 2회차 우회 #2)', () => {
  it('우회 #2 — "체크포인트가 아니다"라고 명시한 heading 은 관문으로 수락하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    // 종전 정규식 `/^### 0[^\n]{0,20}?브랜드\s*체크포인트/` 는 "0" 과
    // "브랜드 체크포인트" 사이 임의 20자를 허용해 이 heading 을 수락했다 —
    // 즉 결정 절차를 통째로 지우고도 CI 가 초록이었다.
    const negatedHeading = validDesignSkillMd().replace(
      DESIGN_CHECKPOINT_HEADING,
      '### 0번 항목은 브랜드 체크포인트가 아니다',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), negatedHeading);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/brand-guard-checkpoint-heading-negated');
    // 수락되지 않았으므로 "절이 없다"도 함께 발화한다 — 조용한 무시가 아니다.
    expect(fired).toContain('A2/brand-guard-checkpoint-missing');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(checkpointRulesFired(restored)).toHaveLength(0);
  });

  it('모양이 정확히 맞아도 뜻이 부정이면("### 0. 브랜드 체크포인트가 아니다") 수락하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const shapedButNegated = validDesignSkillMd().replace(
      DESIGN_CHECKPOINT_HEADING,
      '### 0. 브랜드 체크포인트가 아니다',
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      shapedButNegated,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-heading-negated');
  });

  // harness#137 **3회차** S3 — 이 예외는 종전에 "heading 아무 데나 강조어가
  // 있으면 면제"였다. 그래서 부정 문구를 그대로 둔 채 무관한 낱말 하나만
  // 끼워 넣으면 검사가 통째로 열렸다. 규칙을 **인접성**으로 좁혔으므로 이
  // 테스트도 양방향(인접=수락 / 비인접=거부)을 함께 고정한다.
  it('negative — 의무를 강조하려고 부정어를 쓴 heading("생략 불가")은 정상 수락한다 (강조어가 부정어에 인접)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    for (const heading of [
      '### 0. 브랜드 체크포인트 — 생략 불가',
      '### 0. 브랜드 체크포인트 (제외 없음)',
      '### 0. 브랜드 체크포인트 — 건너뛰기 금지',
      '### 0. 브랜드 체크포인트 — 생략할 수 없다',
    ]) {
      writeFile(
        path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
        validDesignSkillMd().replace(DESIGN_CHECKPOINT_HEADING, heading),
      );
      const { violations } = await runChecks(tmpDir);
      expect(checkpointRulesFired(violations), `heading: ${heading}`).toHaveLength(0);
    }
  });

  it('S3 — 부정 문구를 둔 채 무관한 자리에 강조어만 끼워 넣는 것은 면제가 아니다 (인접성 요구)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());

    // 종전 규칙에서는 이 heading 이 `필수` 하나로 0 error 였다.
    const escapeHatch = validDesignSkillMd().replace(
      DESIGN_CHECKPOINT_HEADING,
      '### 0. 브랜드 체크포인트 (관문은 아니다 — 생략해도 된다, 필수 아님)',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), escapeHatch);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/brand-guard-checkpoint-heading-negated');
    // 수락되지 않았으므로 "절이 없다"도 함께 발화한다 — 조용한 무시가 아니다.
    expect(fired).toContain('A2/brand-guard-checkpoint-missing');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(checkpointRulesFired(restored)).toHaveLength(0);
  });
});

describe('A2/brand-guard-checkpoint 경계 빌려오기 (harness#137 2회차 우회 #4)', () => {
  it('우회 #4 — 다음 단계 heading 을 **굵게**로 강등해도 인접 절의 낱말을 빌려올 수 없다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    // 체크포인트 본문은 한 줄로 비우고, 필수 낱말·질문 블록은 전부 인접
    // (강등된) 절에 심는다. 종전 경계 규칙("다음 '### ' 토큰")은 강등으로
    // 사라져 인접 절까지 체크포인트 절로 읽혔다.
    const demotedNextStep = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

다음 단계 heading 이 굵은 글씨로 강등된 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

${DESIGN_EXEC_ORDER_HEADING}

${DESIGN_CHECKPOINT_HEADING}

브랜드 항목을 대조한다.

**1. 실행**

사용자가 명시적으로 요청했더라도 예외가 아니다. 산출 전에 멈추고 사용자에게
알리고 답을 기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      demotedNextStep,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-incomplete');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });

  it('negative — 체크포인트 본문의 단독 굵은 **문장**은 경계로 오인하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    // 강등 라벨은 숫자로 시작하는 라벨(`**1. …**`)만 경계로 본다. 실제
    // SKILL.md 0단계는 `**이 관문을 … 호출하지 않는다.**` 라는 단독 굵은
    // 문장으로 시작하는데, 이것을 경계로 보면 절이 한 줄로 잘려 false-fail 이다.
    const boldSentenceInside = validDesignSkillMd().replace(
      `${DESIGN_CHECKPOINT_HEADING}\n`,
      `${DESIGN_CHECKPOINT_HEADING}

**이 관문을 통과하기 전에는 자산·코드를 만드는 도구를 호출하지 않는다.**
`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      boldSentenceInside,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('A2/brand-guard-checkpoint-unbounded — 뒤따르는 heading 이 전부 사라지면 절이 무한정 늘어나지 못한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const filler = Array.from(
      { length: 70 },
      (_, i) => `무관한 본문 ${i + 1}번째 줄 — 체크포인트 절이 여기까지 삼키면 안 된다.`,
    ).join('\n\n');
    const noTerminatingHeading = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트 뒤 heading 이 전부 사라진 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

${DESIGN_EXEC_ORDER_HEADING}

${DESIGN_CHECKPOINT_HEADING}

사용자가 명시적으로 요청했더라도 예외가 아니다. 산출 전에 멈추고 사용자에게
알리고 답을 기다린다:

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
\`\`\`

${filler}

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      noTerminatingHeading,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-unbounded');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-unbounded');
  });
});

describe('A2/brand-guard-checkpoint 차단 메시지 구조 요건 (harness#137 2회차 오탐 #7)', () => {
  it('negative — 차단 메시지를 뜻은 그대로 두고 자연스럽게 리라이팅해도 false-fail 이 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    // 종전 검사는 실제 SKILL.md 문장 3종("브랜드 가드에 걸립니다" 등)을
    // 리터럴로 요구해서, 뜻을 지킨 정직한 카피 편집이 CI 를 깼다. 아래
    // 리라이팅은 그 세 문구를 하나도 쓰지 않는다.
    const rewordedTemplate = validDesignSkillMd().replace(
      '요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?',
      `말씀하신 구성 중 아래 항목이 미니앱 브랜드 기준과 충돌합니다:
  - <금지 목록 항목> ← <요청의 어느 부분인지>

만들기 전에 확인부터 받으려 합니다. 대안: <중립 색 / 자체 로고 자리>.
이대로 진행해도 괜찮을까요, 아니면 쓰고 싶은 다른 색·구성이 있으실까요?`,
    );
    // 리터럴 마커를 정말 안 쓰는지 픽스처 자체를 단언한다 — 이게 깨지면
    // 이 테스트는 아무것도 증명하지 못한다.
    for (const marker of ['브랜드 가드에 걸립니다', '먼저 여쭙습니다', '이 방향으로 진행할까요']) {
      expect(rewordedTemplate).not.toContain(marker);
    }
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      rewordedTemplate,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('질문이 없는 블록(물음표 없는 안내문)은 차단 메시지 템플릿으로 보지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir); // quality-bar 축은 이 케이스와 무관 — 노이즈 제거
    const statementOnly = validDesignSkillMd().replace(
      '요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?',
      '요청하신 내용이 브랜드 가드에 걸려 이 부분은 만들지 않았습니다.',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), statementOnly);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-incomplete');
  });
});

describe('A2/brand-guard-checkpoint-heading-re 오탐 수정 negative/positive tests (harness#137 적대 검증 오탐 #1)', () => {
  it('positive control — heading 을 관용적 표기로 자연스럽게 리라이팅해도(예: "0단계 — ") false-fail 이 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    const naturalRewrite = validDesignSkillMd().replace(
      '### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)',
      '### 0단계 — 브랜드 체크포인트, 반드시 먼저 통과해야 하는 관문',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), naturalRewrite);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).not.toContain('A2/brand-guard-checkpoint-missing');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-incomplete');
    expect(fired).not.toContain('A2/brand-guard-checkpoint-not-first');
  });

  it('넓힌 정규식이 0이 아닌 다른 단계 번호(예: "### 10.")까지 매치하지는 않는다', async () => {
    buildValidFixture(tmpDir);
    const otherStepNumber = validDesignSkillMd().replace(
      '### 0. 브랜드 체크포인트 (산출 도구 호출 전 관문)',
      '### 10. 브랜드 체크포인트 (산출 도구 호출 전 관문)',
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      otherStepNumber,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    // "10." 은 "0" 뒤 구분자가 아니라 완전히 다른 번호이므로 0단계로
    // 인정되면 안 된다 — heading 이 없는 것과 동일하게 missing 이 발화해야 한다.
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-missing');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-missing');
  });
});

describe('A2/brand-guard-quality-bar-incomplete negative tests (harness#137)', () => {
  it('G0 절 + 4항목이 모두 있는 quality-bar.md 는 발화하지 않는다 (positive control)', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    writeValidQualityBar(tmpDir);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('quality-bar.md 파일 자체가 없으면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    // quality-bar.md 를 아예 쓰지 않는다 (삭제 시뮬레이션).
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-quality-bar-incomplete');

    writeValidQualityBar(tmpDir);
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('G0 절은 있지만 heading 이 사라지면(다른 절로 대체) 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const withoutG0Heading = `# 디자인 품질 판정 기준 (quality bar)

## G1 — 컨테이너 적합성

G0 heading 이 삭제된 상태를 시뮬레이션한다. G0-1 ~ G0-4 항목 텍스트는
남아있어도 heading 자체가 없으면 이 절이 채점 관문으로 인식되지 않는다.

| # | 항목 |
|---|---|
| G0-1 | 로고 금지 |
| G0-2 | 컬러 금지 |
| G0-3 | 화면 복제 금지 |
| G0-4 | 상호 오용 금지 |
`;
    writeFile(path.join(tmpDir, QUALITY_BAR_REL), withoutG0Heading);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-quality-bar-incomplete');

    writeValidQualityBar(tmpDir);
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('G0 절은 있지만 4항목 중 일부(G0-3, G0-4)가 빠지면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const partialItems = `# 디자인 품질 판정 기준 (quality bar)

## G0 — 브랜드·IP 안전 (차단)

| # | 항목 | 근거 |
|---|---|---|
| G0-1 | 로고·워드마크 금지 | H |
| G0-2 | 브랜드 컬러 금지 | H |

## G1 — 컨테이너 적합성

픽스처 본문.
`;
    writeFile(path.join(tmpDir, QUALITY_BAR_REL), partialItems);
    const { violations } = await runChecks(tmpDir);
    const fired = rulesFired(violations);
    expect(fired).toContain('A2/brand-guard-quality-bar-incomplete');
    // 정확히 G0-3·G0-4 만 빠졌는지까지 확인 — 메시지에 항목 ID가 포함된다.
    const g0Messages = violations
      .filter((v) => v.rule === 'A2/brand-guard-quality-bar-incomplete')
      .map((v) => v.message);
    // 메시지 본문은 매번 "G0-1~G0-4 4항목 모두 필요" AC 문구를 반복하므로,
    // 실제로 빠진 항목인지는 인용부호로 감싼 `'G0-3'` 형태로 구별한다.
    expect(g0Messages.some((m) => m.includes("'G0-3'"))).toBe(true);
    expect(g0Messages.some((m) => m.includes("'G0-4'"))).toBe(true);
    expect(g0Messages.some((m) => m.includes("'G0-1'"))).toBe(false);

    writeValidQualityBar(tmpDir);
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('BRAND_GUARD_REQUIRED_SKILLS 밖의 skill(fix-skill)은 quality-bar.md 가 없어도 발화하지 않는다 (스코프 한정)', async () => {
    buildValidFixture(tmpDir); // fix-skill 은 references/quality-bar.md 자체가 없음
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });
});

// ---------------------------------------------------------------------------
// harness#137 적대 검증 **3회차** — 오탐 8종 + 구조 우회 5종.
//
// 3회차의 핵심 교훈은 방향이다: 실제 위협 모델은 검사기를 뚫으려는 적대적
// 편집자가 아니라, skill 을 고쳐 쓰다 브랜드 관문을 조용히 떨어뜨리는 **선의의
// 저자**(사람 또는 LLM)다. 그 모델에서는 **오탐이 미탐보다 해롭다** — 자연스러운
// 편집을 거부하는 lint 는 저자에게 검사를 우회하는 법을 가르치기 때문이다.
// 아래 오탐 케이스는 전부 "저자가 아무 고민 없이 할 법한 편집"이고, 고치기 전에
// 실제로 error 를 냈다(각 it 제목의 rule ID 가 당시 발화한 코드다).
//
// 규율은 2회차와 같다: 모든 변경에 positive(우회에서 발화) + negative(정상
// 문서에서 무반응) 쌍을 둔다.
// ---------------------------------------------------------------------------

/** 들여쓴 fence 로 감싼 차단 메시지 템플릿 (내용은 valid 픽스처와 동일). */
const INDENTED_TEMPLATE = `- 차단 메시지:

  \`\`\`
  요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?
  \`\`\``;

describe('harness#137 3회차 오탐 #1 / 우회 S4 — 들여쓴 fence (fence 인지의 `^` 앵커)', () => {
  it('negative — 내용 무변경인 차단 템플릿을 리스트 아이템 아래로 들여써도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const indented = validDesignSkillMd().replace(
      '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
      INDENTED_TEMPLATE,
    );
    // 픽스처가 실제로 들여쓴 fence 를 쓰는지 스스로 단언한다.
    expect(indented).toContain('\n  ```\n');
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), indented);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('S4 — 관문 앞의 파일 생성 명령 블록을 들여쓴 fence 로 숨겨도 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const hidden = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

- 자산 뼈대:

  \`\`\`bash
  mkdir -p assets
  magick -size 600x600 xc:#0064FF assets/logo.png
  \`\`\`

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), hidden);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });
});

describe('harness#137 3회차 오탐 #2 — 체크포인트 안의 더 깊은 heading 은 절을 끝내지 않는다', () => {
  it('negative — `#### 판정 절차` 소제목을 달아도 내용이 사라졌다고 보지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withSubheading = validDesignSkillMd().replace(
      '사용자가 명시적으로 요청했더라도 예외가 아니다.',
      '#### 판정 절차\n\n사용자가 명시적으로 요청했더라도 예외가 아니다.',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withSubheading);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('positive — 같은 레벨(`### `) heading 은 여전히 절을 끝낸다 (경계 완화가 아니다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    // 필수 낱말·질문 블록을 전부 다음 `### ` 절로 옮긴다 — 경계가 살아 있으면
    // 체크포인트 절은 빈 채로 남아 incomplete 가 나야 한다.
    const movedOut = validDesignSkillMd().replace(
      `${DESIGN_CHECKPOINT_HEADING}\n`,
      `${DESIGN_CHECKPOINT_HEADING}

브랜드 항목을 대조한다.

### 0-B. 세부 판정
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), movedOut);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-incomplete');
  });
});

describe('harness#137 3회차 오탐 #3 — 가드 선언 절의 대안 예시', () => {
  const REINFORCING_EXAMPLE = `예컨대
\`magick -size 600x600 xc:#6B7280 assets/logo.png\` 처럼 중립 회색으로
플레이스홀더를 만든다.`;

  it('negative — 가드를 **강화**하는 예시를 대안 문단에 덧붙여도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const reinforced = validDesignSkillMd().replace(
      '위반 의심 시 사용자에게 알리고 중단한다.',
      `위반 의심 시 사용자에게 알리고 중단한다.\n\n${REINFORCING_EXAMPLE}`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), reinforced);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('positive — 같은 문장이라도 가드 선언 절 **밖**에 있으면 잡는다 (면제는 절 범위 한정)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const outsideGuard = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 메모\n\n${REINFORCING_EXAMPLE}\n\n${DESIGN_EXEC_ORDER_HEADING}\n`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), outsideGuard);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });
});

describe('harness#137 3회차 오탐 #4 — `## 실행 순서` prefix 매칭', () => {
  it('negative — `## 실행 순서 (0~5단계)` 처럼 부연을 붙여도 not-first 가 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    for (const heading of [
      '## 실행 순서 (0~5단계)',
      '## 실행 순서 — 0단계부터',
      '## 실행 순서: 전체 흐름',
    ]) {
      writeFile(
        path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
        validDesignSkillMd().replace(`\n${DESIGN_EXEC_ORDER_HEADING}\n`, `\n${heading}\n`),
      );
      writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
      const { violations } = await runChecks(tmpDir);
      expect(checkpointRulesFired(violations), `heading: ${heading}`).toHaveLength(0);
    }
  });

  it('positive — 무관한 절 이름(`## 실행 순서도 아닌 절`)까지 기준 heading 으로 보지는 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd().replace(
        `\n${DESIGN_EXEC_ORDER_HEADING}\n`,
        '\n## 실행 순서도 아닌 절\n',
      ),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-not-first');
  });
});

describe('harness#137 3회차 오탐 #5·#6 — heading 구분자와 미수락 진단', () => {
  it('negative — 이 파일이 문서 전체에서 쓰는 가운뎃점 구분자(`0단계 · 브랜드 체크포인트`)를 수락한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd().replace(
        DESIGN_CHECKPOINT_HEADING,
        '### 0단계 · 브랜드 체크포인트 (산출 도구 호출 전 관문)',
      ),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('positive — 수락되지 않은 체크포인트 모양 heading 은 조용히 무시되지 않고 진단이 나온다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const looseOnly = '### 0단계 사전 브랜드 체크포인트 (산출 도구 호출 전 관문)';
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd().replace(DESIGN_CHECKPOINT_HEADING, looseOnly),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const unrecognized = violations.filter(
      (v) => v.rule === 'A2/brand-guard-checkpoint-heading-unrecognized',
    );
    expect(unrecognized).toHaveLength(1);
    // 진단은 **어느 heading 이 왜 안 됐는지**를 말해야 한다 — 종전에는 파일
    // 1행을 가리키는 "절이 없음" 하나뿐이라 진단이 불가능했다.
    expect(unrecognized[0].message).toContain(looseOnly);
    expect(unrecognized[0].line).toBeGreaterThan(1);

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-heading-unrecognized');
  });
});

describe('harness#137 3회차 오탐 #7 / 우회 S6 — quality-bar heading 레벨 + fence 인지', () => {
  /** G0~G6 을 `## 그룹별 판정 항목` 아래 `###` 로 묶은 재구성본. */
  function restructuredQualityBarMd(): string {
    return `# 디자인 품질 판정 기준 (quality bar)

## 그룹별 판정 항목

### G0 — 브랜드·IP 안전 (차단)

| # | 항목 | 근거 |
|---|---|---|
| G0-1 | 토스 로고·워드마크를 아이콘·화면·등록 자산에 쓰지 않았다 | H |
| G0-2 | 토스 브랜드 컬러를 미니앱 primary 색으로 채택하지 않았다 | H |
| G0-3 | 토스 앱 화면(특히 로그인/인증)의 구성을 복제하지 않았다 | H |
| G0-4 | "토스" 상호로 미니앱 자체를 토스 공식 제품처럼 표방하지 않았다 | H |
| G0-5 | 토스 전용 본문 서체를 쓰지 않았다 | H |

### G1 — 컨테이너 적합성

픽스처 본문.
`;
  }

  it('negative — G0~G6 을 상위 절 아래 `###` 로 재구성해도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    writeFile(path.join(tmpDir, QUALITY_BAR_REL), restructuredQualityBarMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('positive — `###` 재구성본에서 항목이 빠지면 여전히 잡는다 (레벨 완화 ≠ 내용 완화)', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    writeFile(
      path.join(tmpDir, QUALITY_BAR_REL),
      restructuredQualityBarMd()
        .split('\n')
        .filter((l) => !l.startsWith('| G0-4 '))
        .join('\n'),
    );
    const { violations } = await runChecks(tmpDir);
    const msgs = violations
      .filter((v) => v.rule === 'A2/brand-guard-quality-bar-incomplete')
      .map((v) => v.message);
    expect(msgs.some((m) => m.includes("'G0-4'"))).toBe(true);
  });

  it('S6 — 진짜 G0 절을 지우고 코드펜스 안 "폐지된 절"에만 남겨 두면 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const real = validQualityBarMd();
    const start = real.indexOf('## G0 — 브랜드·IP 안전 (차단)');
    const end = real.indexOf('## G1 — 컨테이너 적합성');
    const decoyed = `${real.slice(0, start)}## 폐지된 절 (참고용)

\`\`\`markdown
${real.slice(start, end).trimEnd()}
\`\`\`

${real.slice(end)}`;
    // 픽스처 자체를 단언한다 — 디코이가 정말 fence **안에만** 있어야 이
    // 테스트가 무언가를 증명한다(fence 밖에는 G0 이 한 글자도 없어야 한다).
    expect(decoyed).toContain('G0-1');
    const [beforeFence, rest] = decoyed.split('```markdown\n');
    const afterFence = rest.split('```\n')[1];
    expect(beforeFence).not.toContain('G0');
    expect(afterFence).not.toContain('G0');
    writeFile(path.join(tmpDir, QUALITY_BAR_REL), decoyed);
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-quality-bar-incomplete');

    writeValidQualityBar(tmpDir);
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });

  it('negative — 인쇄용 출력 형식 예시 블록이 G0 을 언급해도 정상 문서는 조용하다', async () => {
    buildValidFixture(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    writeFile(
      path.join(tmpDir, QUALITY_BAR_REL),
      `${validQualityBarMd()}
## 자기 점검 출력 형식

\`\`\`
품질 점검 (quality bar)
  브랜드 (G0)     통과 — G0-1~G0-4 이상 없음
\`\`\`
`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-quality-bar-incomplete');
  });
});

describe('harness#137 3회차 오탐 #8 / 우회 S1 — 절의 끝 경계와 줄 수 상한', () => {
  /** 체크포인트 본문을 `extraLines` 줄만큼 늘린 SKILL.md. */
  function grownCheckpoint(extraLines: number): string {
    const filler = Array.from(
      { length: extraLines },
      (_, i) => `${i + 4}. 추가 결정 항목 ${i + 1} — 참고 이미지의 로고·색·레이아웃도 대조한다.`,
    ).join('\n');
    return validDesignSkillMd().replace(
      '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
      `${filler}\n\n\`\`\`\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n\`\`\``,
    );
  }

  it('negative — 다음 단계 heading 이 제자리에 있으면 절이 60줄을 넘어도 unbounded 가 아니다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const grown = grownCheckpoint(80);
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), grown);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('S1(a) — 체크포인트를 비우고 그 뒤를 전부 지워 파일이 거기서 끝나도 잡는다 (EOF ≠ 경계)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    // 종전 `boundedByCap = capIdx < lines.length` 는 절이 파일 끝 60줄 안에
    // 들어오면 경계가 없어도 아무 오류를 내지 않았다 — 0 error 였다.
    const truncated = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

체크포인트를 비우고 그 뒤를 전부 지운 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

${DESIGN_EXEC_ORDER_HEADING}

${DESIGN_CHECKPOINT_HEADING}

예외 없이 산출 전에 중단하고 사용자에게 알리고 답을 기다린다.

\`\`\`
요청하신 내용이 브랜드 가드에 걸립니다. 진행할까요?
\`\`\`

\`\`\`
/ait:new   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"
\`\`\`
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), truncated);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-unbounded');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-unbounded');
  });

  it('S1(b) — `### 1.` 을 번호 없는 굵은 라벨로 강등해 1단계를 삼키면 잡는다 (절이 짧아도)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    // 체크포인트 본문은 한 줄로 비우고, 필수 낱말·질문 블록은 전부 강등된
    // 1단계 본문에서 빌려 온다. 2회차 우회 #4 와 달리 강등 라벨에 **번호가
    // 없어서** DEMOTED_STEP 경계에 걸리지 않고, 절이 60줄 안이라 줄 수
    // 상한에도 걸리지 않는다 — 그래서 종전에는 0 error 였다.
    const swallowed = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

1단계 라벨이 번호 없는 굵은 글씨로 강등된 상태를 시뮬레이션한다.

## 토스 브랜드·UI 모방 금지

금지 목록:
- 로고·워드마크 사용 금지
- 브랜드 컬러를 primary로 채택 금지
- 토스 로그인 화면 복제 금지
- "토스" 상호 오용 금지

위반 의심 시 사용자에게 알리고 중단한다.

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

${DESIGN_EXEC_ORDER_HEADING}

${DESIGN_CHECKPOINT_HEADING}

요청받은 색·로고·문구를 금지 목록에 대조한다.

**Figma MCP 탐지 + 디자인 입력 수집**

먼저 Figma MCP server 가 있는지 확인한다. 없으면 에러로 중단하지 말고 수동
경로를 사용자에게 알리고 답을 기다린다. MCP 미설정은 예외 상황이 아니다.

\`\`\`
Figma MCP server가 감지되지 않았습니다. 어느 쪽으로 진행할까요?
\`\`\`

### 2. 앱인토스 UX 제약으로 매핑

\`\`\`
/ait:new   # 말로: "앱인토스 미니앱 새로 하나 만들어줘"
\`\`\`

## 참고

- 없음
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), swallowed);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    const swallow = violations.filter((v) => v.rule === 'A2/brand-guard-checkpoint-swallows-step');
    expect(swallow).toHaveLength(1);
    expect(swallow[0].message).toContain('### 2.');

    // 1단계 라벨을 되돌리면 조용해진다 (negative → positive 왕복 실증).
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      swallowed.replace(
        '**Figma MCP 탐지 + 디자인 입력 수집**',
        '### 1. Figma MCP 탐지 + 디자인 입력 수집',
      ),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-swallows-step');
  });

  it('negative — 정상 문서(0단계 → 1단계)는 swallows-step 이 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-swallows-step');
  });
});

describe('harness#137 3회차 우회 S5 — 3조건 AND 의 금지 다리와 어휘 목록', () => {
  it('S5(금지 다리) — 불릿 하나의 `않는다` 가 다른 불릿의 산출 지시를 면제하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const bulletList = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

- 없는 가이드를 지어내지 않는다.
- \`Bash\` 로 \`mkdir -p assets\` 를 실행한다. 그리고 \`magick\` 으로 로고 PNG를 만든다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), bulletList);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 금지 마커가 지시 동사와 **같은 문장**에서 앞에 오면 여전히 면제한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const sameSentence = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

- 없는 가이드를 지어내지 않는다.
- 관문을 통과하기 전에는 \`Bash\` 로 \`mkdir -p assets\` 를 실행하지 말고 \`magick\` 으로 로고 PNG를 만들지 않는다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), sameSentence);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('S5(어휘 목록) — 목록에 없던 도구(`python3`/`printf`)·종결형(`만들어야 한다`)도 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const newLexicon = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

먼저 \`python3\` 로 Pillow 를 써서 \`assets/logo.png\` 플레이스홀더를 만들어야 한다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), newLexicon);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 넓힌 어휘가 `## 의존`·`## 목적` 류의 정상 서술을 잡지는 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const prose = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 의존

- **이미지 도구 (선택)**: 정확한 규격으로 PNG를 만들려면 ImageMagick
  (\`magick\`/\`convert\`)이나 \`sips\`, \`python3\` 의 Pillow, \`node\` 의 canvas 가
  있으면 활용한다. 없으면 사용자에게 export 규격을 안내해 직접 채우게 한다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), prose);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });
});

describe('harness#137 3회차 우회 S7 — 차단 템플릿의 물음표 줄', () => {
  it('S7 — 셸 명령/주석 줄의 물음표(`echo "ok"   # ready?`)는 질문으로 보지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const shellQuestion = validDesignSkillMd().replace(
      '요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?',
      'echo "ok"   # ready?',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), shellQuestion);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-incomplete');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-incomplete');
  });

  it('negative — `#` 로 시작하는 산문 줄이 섞여 있어도 진짜 질문 줄이 있으면 통과한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const mixed = validDesignSkillMd().replace(
      '요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?',
      '# 브랜드 가드 알림\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), mixed);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// A1/cmd-name-shadows-skill — 명령 이름이 같은 이름 skill 을 가리는 경우 (#286)
// ---------------------------------------------------------------------------

describe('A1/cmd-name-shadows-skill negative tests', () => {
  it('명령 basename 이 다른 skill 이름과 겹치면 위반이 난다', async () => {
    buildValidFixture(tmpDir);
    // `other-skill` 이라는 skill 을 하나 더 두고, 그 이름의 command 가 엉뚱하게
    // fix-skill 로 위임한다 — 설치 형상에서 둘 다 `ait:other-skill` 로 올라간다.
    writeFile(
      path.join(tmpDir, 'shared', 'skills', 'other-skill', 'SKILL.md'),
      `---
name: other-skill
description: Another fixture skill.
argument-hint: ''
---

# other-skill

## 목적

본문.

필요하면 docs MCP(searchDocumentation)로 조회한다.

\`\`\`
/ait:new
\`\`\`
`,
    );
    writeFile(
      path.join(tmpDir, 'shared', 'commands', 'other-skill.md'),
      `---
description: 'Shadowing command.'
argument-hint: ''
---

Load the \`${SKILL_NAME}\` skill.
`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A1/cmd-name-shadows-skill');
  });

  it('자기 자신에게 위임하는 겹침도 위반이다 (harness#134 — 종전 면제 폐지)', async () => {
    buildValidFixture(tmpDir);
    // 종전 이 케이스는 "어느 쪽이 이기든 결과가 같으므로 무해"로 면제됐다.
    // 실측이 그 전제를 반박했다 — command 가 이기고 그 본문이 불활성 문자열로
    // 주입될 뿐이라 skill 본문은 세션 내내 로드되지 않는다. 그래서 예외 없이 잡는다.
    writeFile(
      path.join(tmpDir, 'shared', 'commands', `${SKILL_NAME}.md`),
      `---
description: 'Self-delegating command.'
argument-hint: ''
---

Load the \`${SKILL_NAME}\` skill.
`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A1/cmd-name-shadows-skill');
  });

  it('A1/skill-name-collides-command — 겹침을 skill 쪽에도 앵커해 잡는다', async () => {
    buildValidFixture(tmpDir);
    // 반대 방향 회귀(기존 command 와 같은 verb 로 skill 디렉터리가 새로 생기는 경우)를
    // 작성자가 만진 파일에 보고하기 위한 미러 규칙.
    writeFile(
      path.join(tmpDir, 'shared', 'commands', `${SKILL_NAME}.md`),
      `---
description: 'Self-delegating command.'
argument-hint: ''
---

Load the \`${SKILL_NAME}\` skill.
`,
    );
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A1/skill-name-collides-command');
    const fired = violations.filter((v) => v.rule === 'A1/skill-name-collides-command');
    expect(fired[0]?.file).toBe(path.join('shared', 'skills', SKILL_NAME, 'SKILL.md'));
  });
});

// ---------------------------------------------------------------------------
// harness#137 4회차 — 4라운드 적대 검증(PR #140 마지막 코멘트)이 특정한
// 잔여 결함 F-a ~ F-g.
// ---------------------------------------------------------------------------

describe('harness#137 4회차 F-a — 인용(>) 접두 fence', () => {
  it('F-a — 관문 앞의 파일 생성 명령을 인용된 코드블록(`> \\`\\`\\`bash`)으로 숨겨도 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const hidden = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

> \`\`\`bash
> mkdir -p assets
> magick -size 600x600 xc:#0064FF assets/logo.png
> \`\`\`

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), hidden);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('F-a — 중첩 인용(`> > `)으로 숨겨도 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const hidden = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

> > \`\`\`bash
> > mkdir -p assets
> > magick -size 600x600 xc:#0064FF assets/logo.png
> > \`\`\`

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), hidden);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 인용된 차단 메시지 템플릿(정상적인 quote 스타일)도 정상 인식한다', async () => {
    // F-a 가 fence 인식을 넓힌 부작용으로, 체크포인트 자신의 차단 메시지
    // 템플릿을 인용 스타일로 적었을 때 "템플릿 없음"으로 오탐하지 않는지도
    // 함께 확인한다(내용 검사도 인용 접두를 지우고 봐야 한다).
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const quotedTemplate = validDesignSkillMd().replace(
      '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
      '> ```\n> 요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n> ```',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), quotedTemplate);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });
});

describe('harness#137 4회차 F-b — SKILL.md heading 스캔의 fence 인지', () => {
  it('negative — 문서 앞부분 예시 fence 안의 데코이 heading 에 속지 않고 실제 절을 찾는다', async () => {
    // "## 목적" 절에 문서 작성 관례를 설명하는 예시 코드펜스를 두고, 그 안에
    // 실제 heading 문자열(가드 절 heading·체크포인트 heading)을 그대로
    // 인용한다 — fence 인지 없이 raw 텍스트를 스캔하면 이 데코이가
    // headingIdx/checkpointIdx 로 먼저 잡혀 실제 절 파싱이 어긋난다.
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withDecoy = validDesignSkillMd().replace(
      '픽스처 design skill이다.',
      `픽스처 design skill이다. 아래는 문서 작성 예시일 뿐 실제 절이 아니다:

\`\`\`markdown
## 토스 브랜드·UI 모방 금지

(예시 — 실제 절은 파일 하단에 있다)

### 0. 브랜드 체크포인트

(이 fence 는 데코이다. 진짜 절이 아니다)
\`\`\``,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withDecoy);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-section-missing');
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');
  });

  it('positive — 데코이만 있고 진짜 절이 없으면 여전히 잡는다 (fence 무시가 과잉 면제가 아님을 확인)', async () => {
    buildValidFixture(tmpDir);
    const decoyOnly = `---
name: ${DESIGN_SKILL_NAME}
description: Fixture design skill.
argument-hint: ''
---

# ${DESIGN_SKILL_NAME} skill

## 목적

\`\`\`markdown
## 토스 브랜드·UI 모방 금지
### 0. 브랜드 체크포인트
\`\`\`

필요하면 docs MCP(searchDocumentation/getPage)로 조회한다.

\`\`\`
/ait:new
\`\`\`

## 참고

- 없음
`;
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), decoyOnly);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-section-missing');
  });
});

describe('harness#137 4회차 F-c — 위조 번호 라벨로 상한을 피하는 우회', () => {
  /** 체크포인트를 늘리고, 다음 단계 heading 을 번호가 정확한 강등 라벨로 바꾼 SKILL.md. */
  function grownAndForgedCheckpoint(extraLines: number): string {
    const filler = Array.from(
      { length: extraLines },
      (_, i) => `${i + 4}. 추가 결정 항목 ${i + 1} — 참고 이미지의 로고·색·레이아웃도 대조한다.`,
    ).join('\n');
    return validDesignSkillMd()
      .replace(
        '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
        `${filler}\n\n\`\`\`\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n\`\`\``,
      )
      .replace('### 1. 실행', '**1. 실행**');
  }

  it('F-c — 강등 라벨에 정확한 다음 단계 번호("1.")를 위조해도 swallow 는 물론 상한도 피할 수 없다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const forged = grownAndForgedCheckpoint(80);
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), forged);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    // 번호가 정확히 "1"이라 swallow(번호 불일치) 는 나지 않는다 — 종전
    // 코드는 여기서 상한도 스킵해 0 error 였다.
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-swallows-step');
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-unbounded');

    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      validDesignSkillMd(),
    );
    const { violations: restored } = await runChecks(tmpDir);
    expect(rulesFired(restored)).not.toContain('A2/brand-guard-checkpoint-unbounded');
  });

  it('negative — 실제 heading(`### 1.`)이 정확한 번호로 제자리에 있으면 아무리 길어도 상한에 걸리지 않는다 (오탐 #8 유지 확인)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const filler = Array.from(
      { length: 80 },
      (_, i) => `${i + 4}. 추가 결정 항목 ${i + 1} — 참고 이미지의 로고·색·레이아웃도 대조한다.`,
    ).join('\n');
    const grown = validDesignSkillMd().replace(
      '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
      `${filler}\n\n\`\`\`\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n\`\`\``,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), grown);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-unbounded');
  });
});

describe('harness#137 4회차 F-d — 중단 어휘 활용형 + 실행 순서 heading 오인', () => {
  it('F-d — 체크포인트 절이 "멈춘" 활용형만 써도 중단 절차 요건을 만족한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출\n전에 멈추고 아래 형태로 사용자에게 알리고 답을 기다린다:',
      '사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출\n전에 즉시 멈춘 뒤 아래 형태로 사용자에게 알리고 답을 기다린다:',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('F-d — 가드 선언 절이 "멈추" 활용형만 써도(중단 낱말 없이) 요건을 만족한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '위반 의심 시 사용자에게 알리고 중단한다.',
      '위반 의심 시 사용자에게 알리고 즉시 멈추어야 한다.',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');
  });

  it('F-d — "## 실행 순서 요약" 같은 개관 절을 실행 순서 절 자체로 오인하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withSummary = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 실행 순서 요약

### 개요

0단계는 브랜드 체크포인트, 1단계는 실행이다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withSummary);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-not-first');
  });

  it('negative — "## 실행 순서 (0~5단계)" 처럼 부연 괄호가 붙은 진짜 절은 여전히 인식된다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withParen = validDesignSkillMd().replace(
      DESIGN_EXEC_ORDER_HEADING,
      '## 실행 순서 (0~5단계)',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withParen);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-checkpoint-not-first');
  });
});

describe('harness#137 4회차 F-e/F-f — 오탐 방지 확인', () => {
  it('F-e — "## 실행 순서" 바로 아래 목차 블록을 추가해도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withToc = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n\n${DESIGN_CHECKPOINT_HEADING}`,
      `${DESIGN_EXEC_ORDER_HEADING}

전체 흐름은 다음과 같다:
- 0단계: 브랜드 체크포인트
- 1단계: 실행

${DESIGN_CHECKPOINT_HEADING}`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withToc);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('F-f — 체크포인트 안에 "#### 판정 절차" 소제목 + 판정 항목을 추가해도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withSubsection = validDesignSkillMd().replace(
      '사용자가 명시적으로 요청했더라도 예외가 아니다.',
      `#### 판정 절차

- 로고·워드마크·브랜드 컬러·상호 오용 여부를 대조한다.
- 애매하면 보수적으로 판단한다.

사용자가 명시적으로 요청했더라도 예외가 아니다.`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withSubsection);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('F-f — 가운뎃점 heading·들여쓴 차단 템플릿처럼 이 파일이 이미 쓰는 스타일도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const styled = validDesignSkillMd()
      .replace(DESIGN_CHECKPOINT_HEADING, '### 0 · 브랜드 체크포인트')
      .replace(
        '```\n요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n```',
        '- 차단 메시지:\n\n  ```\n  요청하신 내용이 브랜드 가드에 걸립니다. 이 방향으로 진행할까요?\n  ```',
      );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), styled);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });
});

describe('harness#137 5회차 F3 — 중단·정지 어휘 동의어 오탐', () => {
  it('negative — 체크포인트 절의 "멈추고"를 동의어 "중지하고"로 바꿔도 발화하지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출\n전에 멈추고 아래 형태로 사용자에게 알리고 답을 기다린다:',
      '사용자가 명시적으로 요청했더라도 예외가 아니다. 걸리는 항목이 있으면 산출\n전에 중지하고 아래 형태로 사용자에게 알리고 답을 기다린다:',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  it('negative — 선언 절의 "중단"을 동의어 "중지"로 바꿔도 A2/brand-guard-content-incomplete 가 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '위반 의심 시 사용자에게 알리고 중단한다.',
      '위반 의심 시 사용자에게 알리고 중지한다.',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');
  });
});

describe('harness#137 5회차 F4 — 상호/브랜드 컬러 동의어 오탐 + 공허화 방지', () => {
  it('negative — "브랜드 컬러"를 동의어 "브랜드 색상"으로 바꿔도 A2/brand-guard-content-incomplete 가 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '- 브랜드 컬러를 primary로 채택 금지',
      '- 브랜드 색상을 primary로 채택 금지',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');
  });

  it('negative — "토스" 상호를 "토스"라는 명칭으로 바꿔도 A2/brand-guard-content-incomplete 가 나지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const rewritten = validDesignSkillMd().replace(
      '- "토스" 상호 오용 금지',
      '- "토스"라는 명칭 오용 금지',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), rewritten);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-content-incomplete');
  });

  // 공허화 방지 — 동의어까지 받도록 넓힌 정규식이 ❌ 항목 자체가 삭제된
  // 경우까지 통과시키면 검사가 무의미해진다(harness#137 5회차 F4 fix_spec).
  it('positive — ❌ 컬러 항목 불릿을 통째로 삭제하면 여전히 발화한다 (넓힌 정규식이 공허화되지 않는다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withoutColorItem = validDesignSkillMd().replace(
      '- 브랜드 컬러를 primary로 채택 금지\n',
      '',
    );
    writeFile(
      path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'),
      withoutColorItem,
    );
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-content-incomplete');
  });

  it('positive — ❌ 상호 항목 불릿을 통째로 삭제하면 여전히 발화한다 (넓힌 정규식이 공허화되지 않는다)', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withoutSangho = validDesignSkillMd().replace('- "토스" 상호 오용 금지\n', '');
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withoutSangho);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-content-incomplete');
  });
});

describe('harness#137 5회차 F5 — 체크포인트 heading 의 하이픈 단계 표기', () => {
  it('negative — "0-단계" 처럼 번호와 단계 사이에 하이픈이 있어도 체크포인트로 수락한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const hyphenated = validDesignSkillMd().replace(
      DESIGN_CHECKPOINT_HEADING,
      '### 0-단계 브랜드 체크포인트 (산출 도구 호출 전 관문)',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), hyphenated);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(checkpointRulesFired(violations)).toHaveLength(0);
  });

  // 기존 데코이 거부는 유지된다 — 하이픈을 넓혀 받아들이는 회귀가 부정어
  // 회피까지 함께 열지 않는지 확인한다.
  it('positive — "0번 항목은 브랜드 체크포인트가 아니다" 데코이는 여전히 거부한다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const decoy = validDesignSkillMd().replace(
      DESIGN_CHECKPOINT_HEADING,
      '### 0번 항목은 브랜드 체크포인트가 아니다',
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), decoy);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-checkpoint-missing');
  });
});

describe('harness#137 5회차 F1 — 무-fence 인라인 명령 나열 (bypass-structural)', () => {
  it('positive — fence 없이 인라인 코드로만 나열된 산출 명령("## 사전 준비")을 잡는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withPrep = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 사전 준비

- \`mkdir -p assets\` 로 디렉터리를 만든다.
- \`magick -size 600x600 xc:#0064FF assets/logo.png\` 로 로고 플레이스홀더를 만든다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withPrep);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — "## 의존" 절식 맨이름 도구 나열(`magick`/`convert`/`sips`, 인자 없음)은 잡지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withDeps = validDesignSkillMd().replace(
      `${DESIGN_EXEC_ORDER_HEADING}\n`,
      `## 의존

정확한 규격으로 PNG를 만들려면 ImageMagick(\`magick\`/\`convert\`)이나 \`sips\`
(macOS), 또는 다른 로컬 이미지 도구가 있으면 활용한다.

${DESIGN_EXEC_ORDER_HEADING}
`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withDeps);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });

  it('negative — 체크포인트 절 안의 금지 인용(`mkdir -p assets` 등)은 잡지 않는다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    const withQuote = validDesignSkillMd().replace(
      `${DESIGN_CHECKPOINT_HEADING}\n\n사용자가 명시적으로 요청했더라도 예외가 아니다.`,
      `${DESIGN_CHECKPOINT_HEADING}

**이 관문을 통과하기 전에는 자산·코드를 만드는 도구를 호출하지 않는다.**
\`Write\`·\`Edit\`은 물론 \`Bash\`로 파일을 만드는 것(\`mkdir -p assets\`,
\`cat > src/foo.ts <<'EOF'\`)도 전부 해당한다.

사용자가 명시적으로 요청했더라도 예외가 아니다.`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), withQuote);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });
});

// F-g — 산문 면제 구간(브랜드 가드 선언 절)의 끝 경계는 "다음 '## ' heading"
// 이다. 편집자가 그 뒤를 잇는 절(예: '## 의존'·'## 입력')을 '###' 로
// 격하하면 guardSectionEnd 탐색이 그 절을 건너뛰고 그 다음 '## ' 까지
// 면제 구간을 넓힌다 — asset-before-checkpoint 산문 검사가 그만큼 무뎌진다.
// 이 스캔은 (F-b 로) fence 는 인지하지만 heading **레벨 격하**까지 막으려면
// "그 뒤 절이 원래 '## ' 였는가"를 알아야 하는데, 정적 텍스트 검사에는 그
// 정보가 없다(브랜드 가드 선언 절 뒤에 어떤 절이 와야 하는지는 skill 마다
// 다르고 강제된 스냅샷이 없다). 강제하려면 skill 마다 "가드 절 다음 절 이름"
// 스냅샷을 새로 도입해야 하는데, 그 비용은 이 회귀가 실제로 여는 구멍
// (면제 구간이 넓어져도 asset-before-checkpoint 산문 휴리스틱 하나만
// 무뎌질 뿐, 구조 신호인 인쇄 명령 블록 검사(a)·체크포인트 자체의 내용·
// 위치 검사는 전부 그대로 살아있다)에 비해 크다고 판단해 받아들인다 —
// 문서화된 한계로 남긴다(harness#137 4회차 F-g).
describe('harness#137 4회차 F-g — 산문 면제 경계 확장 (문서화된 한계)', () => {
  it('알려진 한계 — "## 의존" 을 "###" 로 격하하면 산문 면제 구간이 늘어난다', async () => {
    buildValidFixture(tmpDir);
    writeValidQualityBar(tmpDir);
    // 가드 선언 절 바로 뒤에 '### 의존' (원래는 '##' 이어야 정상) 을 두고,
    // 그 안에 금지 문맥 없는 산출 지시문을 심는다. 격하 전이었다면 이
    // 지시문은 가드 선언 절 밖(guardSectionEnd 이후)이라 asset-before-
    // checkpoint 가 잡아야 하지만, 격하로 면제 구간에 들어가 버린다.
    const demoted = validDesignSkillMd().replace(
      '위반 의심 시 사용자에게 알리고 중단한다.',
      `위반 의심 시 사용자에게 알리고 중단한다.

### 의존

\`Write\` 도구로 \`assets/README.md\` 를 만든다.`,
    );
    writeFile(path.join(tmpDir, 'shared', 'skills', DESIGN_SKILL_NAME, 'SKILL.md'), demoted);
    writeFile(path.join(tmpDir, 'shared', 'commands', DESIGN_CMD_FILE), validDesignCommandMd());
    const { violations } = await runChecks(tmpDir);
    // 문서화된 한계: 이 산출 지시문은 asset-before-checkpoint 로 잡히지
    // 않는다. 이 assert 는 "잡아야 한다"가 아니라 "지금은 이렇게 동작한다"를
    // 고정해, 이 한계가 향후 조용히 사라지거나 반대로 새 회귀와 뒤섞이지
    // 않게 한다.
    expect(rulesFired(violations)).not.toContain('A2/brand-guard-asset-before-checkpoint');
  });
});
