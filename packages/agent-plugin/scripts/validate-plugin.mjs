/**
 * validate-plugin.mjs
 *
 * 구조 검증기 — shared/{skills,commands,templates} + eval/ 의 정합성을 확인.
 * 6개 그룹으로 나뉜다:
 *   A1 — frontmatter + 1:1 매핑 + 라우팅 스냅샷 (hard-fail)
 *   A2 — 본문 구조 + seam 검사 (hard-fail)
 *   A3 — 템플릿 + eval 동기화 (hard-fail)
 *   A4 — CLI 토큰 크로스체크 (optional warn, ../console-cli 없으면 skip)
 *   A5 — plugin.json ↔ package.json 버전 드리프트 (hard-fail)
 *   A6 — 링크 liveness (opt-in warn, VALIDATE_LINKS=1 일 때만 — *.aitc.dev 200 확인)
 *
 * A1–A5 는 runChecks() 가 동기로 돈다(기본 `pnpm test` 경로, 네트워크 비의존).
 * A6 는 네트워크라 CLI 진입점에서만 비동기로 돌고, VALIDATE_LINKS=1 이 아니면 skip.
 *
 * CLI:           node scripts/validate-plugin.mjs        (A1–A5; A6 skip)
 *                VALIDATE_LINKS=1 node scripts/validate-plugin.mjs   (+ A6 링크 sweep)
 * API: import { runChecks } from './scripts/validate-plugin.mjs'
 *      const { violations } = runChecks(repoRoot)        (A1–A5, 동기)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 유틸: YAML frontmatter 파서 (의존성 없는 최소 구현)
// ---------------------------------------------------------------------------

/**
 * `---\n...\n---` 블록을 파싱해 key->value 맵을 반환한다.
 * 지원:
 *   - 단순 스칼라: `key: value`
 *   - 빈 문자열: `key: ''` 또는 `key: ""`
 *   - 블록 스칼라 (|): `key: |\n  line1\n  line2`
 *
 * @param {string} src 파일 전체 텍스트
 * @returns {{ fm: Record<string,string>, body: string } | null}
 */
function parseFrontmatter(src) {
  if (!src.startsWith('---')) return null;
  const second = src.indexOf('\n---', 3);
  if (second === -1) return null;

  const fmRaw = src.slice(4, second);
  const fmEnd = second + 4;
  const body = src.slice(fmEnd);

  /** @type {Record<string,string>} */
  const fm = {};
  const lines = fmRaw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_-][a-zA-Z0-9_-]*):\s*(.*)/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();

    if (rest === '|') {
      i++;
      const blockLines = [];
      while (i < lines.length && (lines[i].startsWith('  ') || lines[i] === '')) {
        blockLines.push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      fm[key] = blockLines.join('\n').trimEnd();
    } else {
      const unquoted = rest.replace(/^['"]|['"]$/g, '');
      fm[key] = unquoted;
      i++;
    }
  }
  return { fm, body };
}

// ---------------------------------------------------------------------------
// 유틸: 파일 시스템 헬퍼
// ---------------------------------------------------------------------------

/** @param {string} filePath @returns {string} */
function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/** @param {string} dir @returns {string[]} */
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Violation 타입
// ---------------------------------------------------------------------------

/**
 * @typedef {{ file: string, line: number, rule: string, message: string, level: 'error' | 'warn' }} Violation
 */

/**
 * @param {string} file
 * @param {number} line
 * @param {string} rule
 * @param {string} message
 * @param {'error'|'warn'} level
 * @returns {Violation}
 */
function mkv(file, line, rule, message, level = 'error') {
  return { file, line, rule, message, level };
}

// ---------------------------------------------------------------------------
// A1 — frontmatter + 1:1 매핑
// ---------------------------------------------------------------------------

/** @param {string} root @returns {Violation[]} */
function checkA1(root) {
  const violations = [];

  const skillsDir = path.join(root, 'shared', 'skills');
  const commandsDir = path.join(root, 'shared', 'commands');

  const skillDirs = listDirs(skillsDir);
  const commandFiles = listFiles(commandsDir).filter((f) => f.endsWith('.md'));

  // skill frontmatter 수집
  /** @type {Map<string, { argumentHint: string, filePath: string, hasArgumentHint: boolean }>} */
  const skillMeta = new Map();

  for (const skillName of skillDirs) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      violations.push(
        mkv(path.join('shared', 'skills', skillName), 1, 'A1/skill-no-file', 'SKILL.md 없음'),
      );
      continue;
    }
    const src = readFile(skillFile);
    const parsed = parseFrontmatter(src);
    const relFile = path.relative(root, skillFile);

    if (!parsed) {
      violations.push(mkv(relFile, 1, 'A1/skill-no-frontmatter', 'frontmatter 없음'));
      continue;
    }
    const { fm } = parsed;

    if (!fm.name) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/skill-name-missing',
          `frontmatter에 'name' 없음 (fix: name: ${skillName} 추가)`,
        ),
      );
    } else if (fm.name !== skillName) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/skill-name-mismatch',
          `name '${fm.name}' != 디렉토리 '${skillName}' (fix: name: ${skillName})`,
        ),
      );
    }

    const hasArgumentHint = 'argument-hint' in fm;
    if (!hasArgumentHint) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/skill-argument-hint-missing',
          `frontmatter에 'argument-hint' 없음 (fix: argument-hint: '' 추가)`,
        ),
      );
    }

    skillMeta.set(skillName, {
      argumentHint: fm['argument-hint'] ?? '',
      filePath: relFile,
      hasArgumentHint,
    });
  }

  // command frontmatter + skill 참조 수집
  /** @type {Map<string, { skillName: string, argumentHint: string, filePath: string }>} */
  const commandMeta = new Map();

  for (const cmdFile of commandFiles) {
    const relFile = path.join('shared', 'commands', cmdFile);
    const fullFile = path.join(commandsDir, cmdFile);
    const src = readFile(fullFile);
    const parsed = parseFrontmatter(src);

    if (!parsed) {
      violations.push(mkv(relFile, 1, 'A1/cmd-no-frontmatter', 'frontmatter 없음'));
      continue;
    }
    const { fm, body } = parsed;

    if (!fm.description) {
      violations.push(
        mkv(relFile, 1, 'A1/cmd-description-missing', `frontmatter에 'description' 없음`),
      );
    }
    if (!('argument-hint' in fm)) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/cmd-argument-hint-missing',
          `frontmatter에 'argument-hint' 없음 (fix: argument-hint: '' 추가)`,
        ),
      );
    }

    // skill 참조 파싱: "Load the `<skill>` skill" 또는 "Load the <skill> skill"
    const match = body.match(/Load the `?([a-zA-Z0-9_-]+)`? skill/);
    if (!match) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/cmd-no-skill-ref',
          `본문에서 skill 참조를 찾을 수 없음 (패턴: "Load the <skill> skill")`,
        ),
      );
      continue;
    }
    const referencedSkill = match[1];

    // 이름 shadowing 검증 (#286).
    //   설치 형상에서 command 와 skill 은 **같은 슬래시 목록**에 오른다 —
    //   command `<v>.md` 는 `ait:<v>`, skill `<v>/` 도 `ait:<v>`. 이름이 겹치면
    //   한 칸을 두고 다투고 사용자가 `/ait:<v>` 로 무엇을 얻는지가 불확정해진다.
    //   단, 겹치는 command 가 **그 같은 이름의 skill 로 위임**하면 어느 쪽이
    //   이기든 결과가 같으므로 무해하다(changeset.md → changeset skill).
    //   그래서 "겹치면 금지"가 아니라 "겹치면 자기 자신에게 위임해야 한다".
    const cmdVerb = cmdFile.replace(/\.md$/, '');
    if (skillMeta.has(cmdVerb) && referencedSkill !== cmdVerb) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/cmd-name-shadows-skill',
          `명령 이름 '${cmdVerb}' 가 같은 이름의 skill 을 가리는데 다른 skill '${referencedSkill}' 로 위임한다 — 설치 형상에서 둘 다 '/ait:${cmdVerb}' 로 올라가 충돌한다 (fix: 명령 파일명을 skill 과 겹치지 않는 verb 로 변경)`,
        ),
      );
    }

    // argument-hint 동기화 검증
    //   병합 skill(issue #273)에는 여러 command 가 서로 다른 facet 인자로 위임한다.
    //   한 skill 은 argument-hint 를 하나만 가지므로 secondary-facet stub 의 hint 와는
    //   본질적으로 어긋난다 — 그 stub 들은 sync 검사에서 면제한다(각 병합 skill 은
    //   자기 argument-hint 로 두 facet 을 커버하거나 분기한다). primary stub
    //   (skill 과 같은 verb: ait-deploy→deploy, ait-status→status)만 sync 를 강제한다.
    const skillInfo = skillMeta.get(referencedSkill);
    if (
      skillInfo?.hasArgumentHint &&
      'argument-hint' in fm &&
      !MERGED_SECONDARY_FACET_CMDS.has(cmdFile)
    ) {
      if (fm['argument-hint'] !== skillInfo.argumentHint) {
        violations.push(
          mkv(
            relFile,
            1,
            'A1/argument-hint-mismatch',
            `argument-hint '${fm['argument-hint']}' != skill '${referencedSkill}' 의 '${skillInfo.argumentHint}' (fix: 두 파일 동기화)`,
          ),
        );
      }
    }

    commandMeta.set(cmdFile, {
      skillName: referencedSkill,
      argumentHint: fm['argument-hint'] ?? '',
      filePath: relFile,
    });
  }

  // 1:1 매핑 검증: 각 command가 참조하는 skill이 존재하는지
  for (const [, meta] of commandMeta) {
    if (!skillMeta.has(meta.skillName)) {
      violations.push(
        mkv(
          meta.filePath,
          1,
          'A1/cmd-orphan-skill-ref',
          `명령이 참조하는 skill '${meta.skillName}' 이 shared/skills/ 에 없음`,
        ),
      );
    }
  }

  // 각 skill에 대응하는 command가 있는지
  const referencedSkills = new Set(Array.from(commandMeta.values()).map((m) => m.skillName));
  for (const skillName of skillDirs) {
    if (!referencedSkills.has(skillName)) {
      const relFile = path.join('shared', 'skills', skillName, 'SKILL.md');
      violations.push(
        mkv(relFile, 1, 'A1/skill-orphan', `skill '${skillName}' 에 대응하는 명령 파일이 없음`),
      );
    }
  }

  // 병합 skill: 여러 command stub이 한 skill로 위임하는 것은 의도된 many-to-one 이다
  // (skill 통합 17→14, issue #273 — 병합 자체는 command 표면 무변경. agent-plugin#280 은
  // 병합이 아니라 순수 추가라 command 표면이 17→18 로 늘었다 — inject 에 debug-console
  // facet 신설, EXPECTED_CMD_TO_SKILL 참조).
  // 어떤 command 가 어떤 skill 로 위임하는지는 아래 EXPECTED_CMD_TO_SKILL 스냅샷이
  // 권위 있게 못박으므로, "skill 이 2개 이상 command 에서 참조됨"은 그 자체로는
  // 위반이 아니다 — 스냅샷에 없는 예기치 못한 매핑만 A1/routing-mismatch 로 잡는다.

  // 라우팅 스냅샷 검증: commandMeta 가 EXPECTED_CMD_TO_SKILL 과 일치하는지
  for (const [cmdFile, expectedSkill] of Object.entries(EXPECTED_CMD_TO_SKILL)) {
    const actual = commandMeta.get(cmdFile);
    if (!actual) {
      violations.push(
        mkv(
          path.join('shared', 'commands', cmdFile),
          1,
          'A1/routing-mismatch',
          `라우팅 스냅샷: '${cmdFile}' 가 shared/commands/ 에 없음 (fix: 파일 추가 또는 EXPECTED_CMD_TO_SKILL 갱신)`,
        ),
      );
    } else if (actual.skillName !== expectedSkill) {
      violations.push(
        mkv(
          actual.filePath,
          1,
          'A1/routing-mismatch',
          `라우팅 스냅샷 불일치: '${cmdFile}' 가 skill '${actual.skillName}' 을 참조하지만 기대값은 '${expectedSkill}' (fix: skill 참조 또는 EXPECTED_CMD_TO_SKILL 갱신)`,
        ),
      );
    }
  }
  for (const [cmdFile] of commandMeta) {
    if (!(cmdFile in EXPECTED_CMD_TO_SKILL)) {
      violations.push(
        mkv(
          path.join('shared', 'commands', cmdFile),
          1,
          'A1/routing-mismatch',
          `라우팅 스냅샷: '${cmdFile}' 가 EXPECTED_CMD_TO_SKILL 에 없음 (fix: 상수에 항목 추가)`,
        ),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A2 — 본문 구조
// ---------------------------------------------------------------------------

// seam 검사 면제 skill: harness 외부 메인테이너 도구 (next-station seam 없음이 정상)
// aitcc 전제 skill 제거(register/deploy/status/setup-bundle) + 불필요 skill 제거
// (docs/auth-setup/changeset) 이후 남은 8개는 전부 next-station seam을 갖는다 —
// 면제 대상 없음(harness#N aitcc 정리).
const SEAM_EXEMPT_SKILLS = new Set();

/**
 * fenced code block 안에 있는 라인 번호(1-based) 집합을 반환한다.
 * @param {string[]} lines
 * @returns {Set<number>}
 */
function fencedCodeLineNumbers(lines) {
  const inFence = new Set();
  let insideFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!insideFence) {
      const m = line.match(/^(`{3,}|~{3,})/);
      if (m) {
        insideFence = true;
        fenceChar = m[1][0];
        fenceLen = m[1].length;
      }
    } else {
      // closing fence: same char, at least same length, optional trailing whitespace
      const closeRe = new RegExp(`^${fenceChar === '`' ? '`' : '~'}{${fenceLen},}\\s*$`);
      if (closeRe.test(line)) {
        insideFence = false;
        fenceChar = '';
        fenceLen = 0;
      } else {
        inFence.add(i + 1);
      }
    }
  }
  return inFence;
}

// docs link allowlist — 이제 어떤 skill 도 docs.aitc.dev 루트/intro 링크를
// 직접 인쇄하지 않는다(아래 DOCS_MCP_MENTION_RE 참조: docs MCP 도구로 대체).
// 빈 Set 이라 A2/docs-root-link 검사가 전 skill 에 균일하게 적용된다.
const DOCS_LINK_ALLOWLIST = new Set();

// A2 docs-mcp-mention-required (positive) — docs GitBook MCP(`apps-in-toss-docs`,
// searchDocumentation/getPage)가 manifest 기본 포함되면서, skill 말미의 문서
// 안내는 docs.aitc.dev deep-link 대신 "docs MCP로 조회" 안내로 통일됐다
// (harness — aitcc 전제 skill 제거와 함께 `docs` skill 자체도 제거: MCP tool이
// 대체). 잔존 8개 skill 은 전부 문서 참조가 있으므로 면제 없음 — 새 skill을
// 추가할 때 정말 문서 참조가 무관하면 여기에 등재한다.
const DOCS_MCP_MENTION_EXEMPT = new Set();

// "docs MCP" 언급 검출 — searchDocumentation/getPage 도구를 가리키는 관용 표현.
const DOCS_MCP_MENTION_RE = /docs MCP/;

// ---------------------------------------------------------------------------
// A1 라우팅 스냅샷 — 명령 파일 ↔ skill 매핑 기대값
// shared/commands/ 전수를 열거한다. 변경 시 이 상수도 함께 갱신.
// ---------------------------------------------------------------------------

// 9개 command stub → 8개 skill 매핑. aitcc 전제 skill 4종(register/deploy/status/
// setup-bundle) + 대응 facet stub(ait-register·ait-deploy·ait-status·ait-setup-bundle·
// deploy-key·logs) 은 콘솔 MCP(`apps-in-toss-console`) 기본 포함으로 제거됐다(등록=
// miniapp_create, 번들 업로드=bundle_upload/bundle_upload_complete, 상태=
// miniapp_get_status). 불필요 skill 3종(docs/auth-setup/changeset) + 대응 stub도
// 함께 제거됐다 — docs 는 docs MCP(`apps-in-toss-docs`)가, auth-setup 은 oidc 제거
// 방침이, changeset 은 harness-external 메인테이너 도구 정리가 근거다(harness
// aitcc 정리 — 19→10 command, 15→8 skill). 이후 polyfill facet 이 공식 harness
// 스코프 밖 패키지(monorepo 에서 제거된 `polyfill`)를 안내한다는 이유로 제거되면서
// 10→9로 한 번 더 줄었다(skill 수는 무변 — inject 는 남은 2 facet 으로 계속 존재).
// 병합 1건만 남는다(command 표면은 무변경):
//   ait-inject-devtools      → inject  (inject-devtools+inject-debug-console 2-facet
//   ait-inject-debug-console → inject   병합: 둘 다 기존 프로젝트 빌드 셋업 패치 —
//                                        병합 skill 이름은 중립적 `inject`)
// 병합 skill 의 secondary-facet command stub (primary 는 skill 과 같은 verb — inject
// 는 대응 primary stub 이 없어 2개 모두 secondary 취급).
// 이 stub 들은 argument-hint sync 검사에서 면제된다 — 병합 skill 은 hint 를
// 하나만 가지므로 secondary facet 의 hint 와는 본질적으로 어긋나기 때문.
const MERGED_SECONDARY_FACET_CMDS = new Set([
  'inject-devtools.md', // → inject
  'inject-debug-console.md', // → inject
]);

/** @type {Record<string, string>} */
const EXPECTED_CMD_TO_SKILL = {
  'debug.md': 'debug',
  'design.md': 'design',
  'plan.md': 'plan',
  'setup-debugger.md': 'setup-debugger',
  'setup-phone-preview.md': 'setup-phone-preview',
  'welcome.md': 'welcome',
  'inject-debug-console.md': 'inject',
  'inject-devtools.md': 'inject',
  'new.md': 'new-miniapp',
};

/** @param {string} root @returns {Violation[]} */
function checkA2(root) {
  const violations = [];
  const skillsDir = path.join(root, 'shared', 'skills');
  const skillDirs = listDirs(skillsDir);

  for (const skillName of skillDirs) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const relFile = path.relative(root, skillFile);
    const src = readFile(skillFile);
    const parsed = parseFrontmatter(src);
    if (!parsed) continue;

    const { body } = parsed;
    const srcLines = src.split('\n');
    const bodyLines = body.split('\n');

    // 첫 번째 H2 heading은 ## 목적 이어야 한다 (H1 skill-title 은 제외)
    const firstH2Line = bodyLines.find((l) => l.startsWith('## ') || l.trim() === '##');
    if (firstH2Line === undefined) {
      violations.push(mkv(relFile, 1, 'A2/no-h2-heading', '## 목적 H2 heading 없음'));
    } else if (firstH2Line.trim() !== '## 목적') {
      const headingLineNo = srcLines.findIndex((l) => l.startsWith('## ') || l.trim() === '##') + 1;
      violations.push(
        mkv(
          relFile,
          headingLineNo,
          'A2/wrong-first-h2-heading',
          `첫 H2 heading이 '## 목적' 이어야 함, 실제: '${firstH2Line.trim()}' (fix: ## 목적 으로 시작하도록)`,
        ),
      );
    }

    // 첫 heading 직후 > blockquote 금지
    {
      let foundFirstH = false;
      for (let i = 0; i < srcLines.length; i++) {
        const line = srcLines[i];
        if (!foundFirstH && line.startsWith('#')) {
          foundFirstH = true;
          continue;
        }
        if (foundFirstH) {
          if (line.trim() === '') continue;
          if (line.startsWith('>')) {
            violations.push(
              mkv(
                relFile,
                i + 1,
                'A2/blockquote-after-heading',
                `첫 heading 직후 '>' blockquote 금지 (umbrella §1.3 규칙 7)`,
              ),
            );
          }
          break;
        }
      }
    }

    // fenced block 내 ✅ 선행 이모지 검출
    {
      const fencedLines = fencedCodeLineNumbers(srcLines);
      for (const lineNo of fencedLines) {
        const line = srcLines[lineNo - 1];
        if (line.startsWith('✅')) {
          // ✅
          violations.push(
            mkv(
              relFile,
              lineNo,
              'A2/emoji-in-completion-block',
              `완료 블록 출력에 ✅ 이모지 선행 금지 (fix: '✅ ' 제거, 단순 텍스트로)`,
            ),
          );
        }
      }
    }

    // docs 링크 루트/intro 검출 (allowlist 제외)
    if (!DOCS_LINK_ALLOWLIST.has(skillName)) {
      for (let i = 0; i < srcLines.length; i++) {
        const line = srcLines[i];
        if (
          line.includes('docs.aitc.dev/intro') ||
          /docs\.aitc\.dev\/?\s*[)\]'"\s]/.test(line) ||
          /docs\.aitc\.dev\/$/.test(line)
        ) {
          violations.push(
            mkv(
              relFile,
              i + 1,
              'A2/docs-root-link',
              `docs.aitc.dev 루트/intro 링크 금지 — 주제별 deep-link 사용 (fix: docs.aitc.dev/guides/<slug> 등으로)`,
            ),
          );
        }
      }
    }

    // docs MCP 언급 존재 강제 (positive — §1.3.4 "문서 참조 필수"를 코드로,
    // docs.aitc.dev deep-link → docs MCP 안내로 전환된 뒤의 형태):
    // exempt 가 아닌 skill 은 본문 어딘가에 "docs MCP" 언급이 최소 1개 있어야
    // 한다. (음성 검사 A2/docs-root-link 와 짝 — 그건 "루트 링크 금지", 이건
    // "docs MCP 안내가 있어야 함". 둘 다 통과해야 §1.3.4 충족.)
    if (!DOCS_MCP_MENTION_EXEMPT.has(skillName)) {
      if (!DOCS_MCP_MENTION_RE.test(src)) {
        violations.push(
          mkv(
            relFile,
            1,
            'A2/docs-mcp-mention-required',
            `docs MCP 안내 없음 — §1.3.4 위반. 본문에 "docs MCP" 언급(searchDocumentation/getPage로 조회) 필요 (정말 문서 참조가 무관한 skill 이면 DOCS_MCP_MENTION_EXEMPT 에 등재)`,
          ),
        );
      }
    }

    // next-station seam 검사: ## Out of scope / ## 참고 이전 본문에 /ait: 가 있어야 한다.
    // read-only skill(status·logs)도 분기 표에서 /ait: 를 참조하므로 자연히 통과한다.
    // 토큰이 '/ait ' 가 아니라 '/ait:' 인 이유는 A8 주석 참조 (#286).
    if (!SEAM_EXEMPT_SKILLS.has(skillName)) {
      // 본문에서 ## Out of scope 또는 ## 참고 이전 영역만 검사
      const seamBodyEndIdx = bodyLines.findIndex(
        (l) => l.startsWith('## Out of scope') || l.startsWith('## 참고'),
      );
      const seamBody = seamBodyEndIdx === -1 ? body : bodyLines.slice(0, seamBodyEndIdx).join('\n');
      if (!seamBody.includes('/ait:')) {
        violations.push(
          mkv(
            relFile,
            1,
            'A2/no-seam',
            `다음 station seam 없음: skill 본문(## Out of scope / ## 참고 이전)에 '/ait:' 참조 필요 (umbrella §1.3 규칙 3)`,
          ),
        );
      } else {
        // §1.3 rule 3 강화: seam 은 "완료/요약 출력"(인쇄되는 fenced 블록) 안에
        // 있어야 한다 — 산문 속 우연한 `/ait` 언급만으로는 부족하다. 전 skill
        // 조사 결과 16/16 이 완료 블록을 fenced 로 인쇄하므로 이 불변은
        // false-positive 없이 "실제 인쇄 seam vs 본문 언급"을 구별한다.
        // (welcome 의 완료 블록이 ## 참고 뒤로 밀려 산문 언급만으로 통과하던
        // 갭을 닫는다 — issue #241.)
        const fencedLines = fencedCodeLineNumbers(bodyLines);
        const seamEnd = seamBodyEndIdx === -1 ? bodyLines.length : seamBodyEndIdx;
        const seamInFence = bodyLines.some(
          (l, i) => i < seamEnd && fencedLines.has(i + 1) && l.includes('/ait:'),
        );
        if (!seamInFence) {
          violations.push(
            mkv(
              relFile,
              1,
              'A2/seam-not-printed',
              `seam 이 산문에만 있음: 다음 station '/ait' 명령을 완료/요약 fenced 블록(## 참고 이전)에 인쇄해야 한다 (umbrella §1.3 규칙 3 — "본문 마지막 블록(완료/요약 출력)")`,
            ),
          );
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A3 — 템플릿 + eval 동기화
// ---------------------------------------------------------------------------

/**
 * 파일 내용에서 {{token}} 패턴을 추출한다.
 * 알파벳/숫자/언더스코어로만 구성된 key 만 추출 (JSX 객체 리터럴 제외).
 * @param {string} content
 * @returns {Set<string>}
 */
function extractTokens(content) {
  const tokens = new Set();
  const re = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  for (const m of content.matchAll(re)) {
    tokens.add(m[1]);
  }
  return tokens;
}

/**
 * 디렉토리를 재귀적으로 순회하며 파일 경로를 yield한다.
 * @param {string} dir
 * @returns {Iterable<string>}
 */
function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

/** @param {string} root @returns {Violation[]} */
function checkA3(root) {
  const violations = [];

  // 1. 템플릿 검증
  const templatesDir = path.join(root, 'shared', 'templates');
  const templateNames = listDirs(templatesDir);

  for (const tplName of templateNames) {
    const tplDir = path.join(templatesDir, tplName);
    const tplJsonPath = path.join(tplDir, 'template.json');
    const relJson = path.relative(root, tplJsonPath);

    if (!fs.existsSync(tplJsonPath)) {
      violations.push(mkv(relJson, 1, 'A3/template-no-json', 'template.json 없음'));
      continue;
    }

    /** @type {{ tokens?: Record<string,unknown>, substitute?: { files?: string[] } }} */
    let tplMeta;
    try {
      tplMeta = JSON.parse(readFile(tplJsonPath));
    } catch {
      violations.push(mkv(relJson, 1, 'A3/template-json-invalid', 'template.json 파싱 실패'));
      continue;
    }

    const declaredTokens = new Set(Object.keys(tplMeta.tokens ?? {}));
    const substituteFiles = tplMeta.substitute?.files ?? [];

    // substitute.files 에 있는 파일에서 실제 토큰 수집
    const foundTokensInSubFiles = new Set();
    for (const subFile of substituteFiles) {
      const subFilePath = path.join(tplDir, subFile);
      if (!fs.existsSync(subFilePath)) {
        violations.push(
          mkv(
            relJson,
            1,
            'A3/substitute-file-missing',
            `substitute.files 의 '${subFile}' 이 템플릿 디렉터리에 없음 — template.json 갱신 또는 파일 복원`,
          ),
        );
        continue;
      }
      const content = readFile(subFilePath);
      for (const tok of extractTokens(content)) {
        foundTokensInSubFiles.add(tok);
      }
    }

    // 모든 파일 순회: substitute.files 밖 파일 + tsx/jsx 토큰 검출
    for (const filePath of walkFiles(tplDir)) {
      if (filePath === tplJsonPath) continue;
      const relToTpl = path.relative(tplDir, filePath);
      const isSubFile = substituteFiles.includes(relToTpl);
      const isTsx = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
      const content = readFile(filePath);
      const tokens = extractTokens(content);

      if (tokens.size === 0) continue;

      if (isTsx) {
        const relFull = path.relative(root, filePath);
        for (const tok of tokens) {
          violations.push(
            mkv(
              relFull,
              1,
              'A3/token-in-tsx',
              `{{${tok}}} 토큰이 .tsx/.jsx 파일에 있음 — JSX 파싱 오류 유발 (fix: 토큰 제거)`,
            ),
          );
        }
      } else if (!isSubFile) {
        const relFull = path.relative(root, filePath);
        for (const tok of tokens) {
          violations.push(
            mkv(
              relFull,
              1,
              'A3/token-outside-substitute-files',
              `{{${tok}}} 토큰이 substitute.files 밖 파일에 있음 (fix: template.json substitute.files 에 '${relToTpl}' 추가 또는 토큰 제거)`,
            ),
          );
        }
      }
    }

    // 선언된 토큰 vs 실제 사용 토큰 비교
    for (const declared of declaredTokens) {
      if (!foundTokensInSubFiles.has(declared)) {
        violations.push(
          mkv(
            relJson,
            1,
            'A3/token-declared-not-used',
            `토큰 '{{${declared}}}' 이 template.json tokens 에 선언됐지만 substitute.files 에서 발견 안 됨`,
          ),
        );
      }
    }
    for (const used of foundTokensInSubFiles) {
      if (!declaredTokens.has(used)) {
        violations.push(
          mkv(
            relJson,
            1,
            'A3/token-used-not-declared',
            `토큰 '{{${used}}}' 이 substitute.files 에서 사용되지만 template.json tokens 에 선언 안 됨`,
          ),
        );
      }
    }
  }

  // 2. promptfoo eval 동기화
  const promptfooConfig = path.join(root, 'eval', 'promptfoo', 'promptfooconfig.yaml');
  const relPromptfoo = path.relative(root, promptfooConfig);

  if (!fs.existsSync(promptfooConfig)) {
    violations.push(mkv(relPromptfoo, 1, 'A3/promptfoo-missing', 'promptfooconfig.yaml 없음'));
  } else {
    const yamlSrc = readFile(promptfooConfig);

    // providers.*.skills 블록에서 skill 목록 파싱
    const configSkills = new Set();
    const skillsBlockMatch = yamlSrc.match(/\bskills:\s*\n((?:[ \t]+-[ \t]+\S+\n?)+)/);
    if (skillsBlockMatch) {
      for (const m of skillsBlockMatch[1].matchAll(/^[ \t]+-[ \t]+(\S+)/gm)) {
        configSkills.add(m[1]);
      }
    }

    const diskSkills = new Set(listDirs(path.join(root, 'shared', 'skills')));

    for (const s of configSkills) {
      if (!diskSkills.has(s)) {
        violations.push(
          mkv(
            relPromptfoo,
            1,
            'A3/promptfoo-skill-unknown',
            `promptfooconfig.yaml에 '${s}' 가 있지만 shared/skills/ 에 없음`,
          ),
        );
      }
    }
    for (const s of diskSkills) {
      if (!configSkills.has(s)) {
        violations.push(
          mkv(
            relPromptfoo,
            1,
            'A3/promptfoo-skill-missing',
            `shared/skills/ 의 '${s}' 가 promptfooconfig.yaml skills 목록에 없음 (fix: skills 블록에 '- ${s}' 추가)`,
          ),
        );
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A4 — CLI 토큰 크로스체크 (optional warn)
// ---------------------------------------------------------------------------

/** @param {string} root @returns {Violation[]} */
function checkA4(root) {
  const candidates = [path.join(root, '..', 'console-cli')];

  let consoleCLIRoot = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      consoleCLIRoot = c;
      break;
    }
  }

  if (!consoleCLIRoot) {
    return [
      mkv('', 0, 'A4/skipped', '../console-cli 를 찾을 수 없어 A4 건너뜀 (CI에서는 정상)', 'warn'),
    ];
  }

  const violations = [];

  // console-cli 명령 surface 추출 (citty defineCommand 패턴)
  // console-cli 의 실제 구조: export const fooCommand = defineCommand({ meta: { name: 'foo' }, ... })
  // cli.ts 의 top-level subCommands 에 등록된 이름(key)이 실제 aitcc <subcmd> surface 다.
  // 여기서는 meta.name 을 src/commands/*.ts 에서 수집해 Set 을 채운다.
  const cmdSrcDir = path.join(consoleCLIRoot, 'src', 'commands');
  /** @type {Set<string>} */
  const aitccSubcmds = new Set();
  if (fs.existsSync(cmdSrcDir)) {
    // citty pattern: meta: { ... name: 'foo' ... }
    const cittyMetaNameRe = /meta:\s*\{[^}]*name:\s*['"]([a-zA-Z0-9_-]+)['"]/gs;
    for (const entry of fs.readdirSync(cmdSrcDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.js')) continue;
      if (entry.name.includes('.test.')) continue;
      const content = readFile(path.join(cmdSrcDir, entry.name));
      for (const m of content.matchAll(cittyMetaNameRe)) {
        aitccSubcmds.add(m[1]);
      }
    }
  }

  // SKILL.md 파일에서 CLI 혼동 패턴 + 알 수 없는 aitcc 서브커맨드 검출
  // "현재 미구현" 문맥 또는 frontmatter `aitcc-surface-skip: true` 가 있으면 억제
  const skillsDir = path.join(root, 'shared', 'skills');
  // aitcc <subcmd> 토큰에서 제외할 known-deferred/intentional 서브커맨드
  // (console-cli 에 없지만 skill 에서 안내 목적으로 언급되는 것들)
  const AITCC_SUBCMD_SKIP = new Set(['logs']);
  for (const skillName of listDirs(skillsDir)) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const relFile = path.relative(root, skillFile);
    const src = readFile(skillFile);
    const parsed = parseFrontmatter(src);
    // frontmatter 의 aitcc-surface-skip: true 가 있으면 unknown subcmd 경고 전체 억제
    const skipSurfaceCheck = parsed?.fm?.['aitcc-surface-skip'] === 'true';
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // `aitcc app deploy <...>.ait` 패턴: .ait 파일 업로드는 ait (번들러 CLI)
      if (/aitcc\s+app\s+deploy\s+\S+\.ait/.test(line)) {
        violations.push(
          mkv(
            relFile,
            i + 1,
            'A4/aitcc-deploy-ait-path',
            `'aitcc app deploy <path>.ait' — .ait 파일 업로드는 'ait deploy' (번들러 CLI) 가 담당 (fix: 역할 구분 명확화)`,
            'warn',
          ),
        );
      }
      // aitcc app deploy --request-review 에 --release-notes 누락
      if (
        /aitcc\s+app\s+deploy\s+.*--request-review/.test(line) &&
        !line.includes('--release-notes')
      ) {
        violations.push(
          mkv(
            relFile,
            i + 1,
            'A4/deploy-missing-release-notes',
            `'aitcc app deploy --request-review' 에 --release-notes 누락 가능성 (fix: 확인 후 추가)`,
            'warn',
          ),
        );
      }

      // aitcc <subcmd> 토큰 크로스체크: console-cli 에 없는 서브커맨드 경고
      if (!skipSurfaceCheck && aitccSubcmds.size > 0) {
        const subcmdMatch = line.match(/\baitcc\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/);
        if (subcmdMatch) {
          const subcmd = subcmdMatch[1];
          // CLI 자체가 아니라 단어 "CLI" 등 제외; skip-list 및 already-known 도 제외
          if (
            !AITCC_SUBCMD_SKIP.has(subcmd) &&
            !aitccSubcmds.has(subcmd) &&
            subcmd !== 'CLI' &&
            subcmd !== 'app' // app 은 subCommand 로 등록된 명령이지만 meta.name 은 subcommand 에 있을 수 있음
          ) {
            // "app" 은 cli.ts subCommands 키로 등록되지만 app.ts 내부 meta.name 은 다름
            // → aitccSubcmds Set 에 없어도 cli.ts 의 키 목록에 있으면 허용
            // cli.ts 를 직접 파싱하지 않으므로 hardcode 로 보완
            const CLI_TOP_LEVEL = new Set([
              'whoami',
              'login',
              'logout',
              'auth',
              'upgrade',
              'workspace',
              'app',
              'members',
              'keys',
              'notices',
              'me',
              'completion',
            ]);
            if (!CLI_TOP_LEVEL.has(subcmd)) {
              violations.push(
                mkv(
                  relFile,
                  i + 1,
                  'A4/aitcc-unknown-subcmd',
                  `'aitcc ${subcmd}' — console-cli 에서 확인되지 않은 서브커맨드 (fix: 명령 확인 또는 frontmatter 에 'aitcc-surface-skip: true' 추가)`,
                  'warn',
                ),
              );
            }
          }
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A5 — plugin.json ↔ package.json 버전 드리프트
// ---------------------------------------------------------------------------

/** @param {string} root @returns {Violation[]} */
function checkA5(root) {
  const pkgPath = path.join(root, 'package.json');
  const pluginPath = path.join(root, '.claude-plugin', 'plugin.json');
  const relPlugin = path.relative(root, pluginPath);

  /** @type {{ version?: string }} */
  let pkg;
  try {
    pkg = JSON.parse(readFile(pkgPath));
  } catch {
    return [mkv('package.json', 1, 'A5/plugin-json-version-drift', 'package.json 파싱 실패')];
  }

  /** @type {{ version?: string }} */
  let plugin;
  try {
    plugin = JSON.parse(readFile(pluginPath));
  } catch {
    return [
      mkv(relPlugin, 1, 'A5/plugin-json-version-drift', '.claude-plugin/plugin.json 파싱 실패'),
    ];
  }

  if (pkg.version !== plugin.version) {
    return [
      mkv(
        relPlugin,
        1,
        'A5/plugin-json-version-drift',
        `버전 불일치: .claude-plugin/plugin.json '${plugin.version}' vs package.json '${pkg.version}' (fix: pnpm sync:plugin-version 실행 또는 두 파일 직접 동기화)`,
      ),
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// A7 — mcpServers npx args resolvability (hard-fail)
// ---------------------------------------------------------------------------
//
// plugin.json 의 mcpServers.<name> 가 `npx` 로 패키지의 *특정 이름 bin* 을 실행할
// 때, 패키지를 -p/--package 로 명시하지 않은 "bare" 형태(`npx [-y] <pkg> <bin>`)는
// npm 이 어느 실행파일을 돌릴지 추론하지 못해 "could not determine executable to
// run" 으로 실패할 수 있다 — 패키지가 bin 을 여러 개 게시하거나 기본 bin 이름이
// 패키지명과 다를 때. 올바른 형태는 `npx [-y] -p <pkg> <bin>`. (#248: ait-devtools
// 가 bin 2개를 게시해 bare 형태가 install 시 MCP 등록을 silently 깨뜨린 갭을 닫는다.
// A1–A5 는 mcpServers 를 전혀 검사하지 않았다.)
//
// npx 형태만 검사한다 — 다른 command(node, 절대경로 등)는 범위 밖(false-positive 회피).

/** 패키지를 명시하는 플래그 — 이게 있으면 bin 추론 모호성이 없다 */
const NPX_PACKAGE_FLAGS = new Set(['-p', '--package']);

/** @param {string} root @returns {Violation[]} */
function checkA7(root) {
  const violations = [];
  const pluginPath = path.join(root, '.claude-plugin', 'plugin.json');
  const relPlugin = path.relative(root, pluginPath);

  if (!fs.existsSync(pluginPath)) return violations; // A5 가 부재를 별도로 다룬다

  /** @type {{ mcpServers?: Record<string, { command?: string, args?: string[] }> }} */
  let plugin;
  try {
    plugin = JSON.parse(readFile(pluginPath));
  } catch {
    return violations; // A5 가 파싱 실패를 별도로 다룬다
  }

  const servers = plugin.mcpServers ?? {};
  for (const [name, server] of Object.entries(servers)) {
    if (!server || server.command !== 'npx') continue;
    const args = Array.isArray(server.args) ? server.args : [];

    // -p/--package 가 이미 있으면 bin 추론 모호성이 없다 — 통과.
    if (args.some((a) => NPX_PACKAGE_FLAGS.has(a))) continue;

    // positional 토큰 = 플래그(-로 시작)가 아닌 인자.
    // 첫 positional = 패키지 spec, 그 뒤 positional 이 하나라도 있으면 = bin 토큰.
    // (bin 토큰이 있는데 -p 가 없으면 npm 이 bin 을 추론해야 해서 모호 → bare 형태.)
    const positionals = args.filter((a) => !a.startsWith('-'));
    if (positionals.length >= 2) {
      violations.push(
        mkv(
          relPlugin,
          1,
          'A7/mcp-npx-bare-bin',
          `mcpServers.${name}: npx args 가 패키지 다음에 bin 토큰('${positionals[1]}')을 두지만 -p/--package 가 없다 — 패키지가 bin 을 여러 개 게시하면 npm 이 실행파일을 추론하지 못해 'could not determine executable to run' 으로 실패한다 (fix: ["-y", "-p", "${positionals[0]}", "${positionals[1]}"] 처럼 -p 로 패키지 명시)`,
        ),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A8 — seam-verb resolvability (hard-fail)
// ---------------------------------------------------------------------------
//
// A2 의 seam 검사는 본문에 seam 토큰이 (1) ## 참고 이전에 있고 (2) fenced
// 블록 안에 인쇄되는지만 본다 — 그 verb 가 실재 명령으로 resolve 되는지는
// 검사하지 않는다. 그래서 skill 이 `/ait:deploy-bundle` (실재는 setup-bundle)
// 같은 stale·typo verb 를 fenced seam 으로 인쇄해도 A1/A2 전부 통과하고,
// 비개발자가 그 seam 을 따라가면 존재하지 않는 명령에서 dead-end 한다.
// A8 은 인쇄되는(= fenced) seam 의 verb 가 합법 집합에 속하는지 게이트한다
// (#254 — A7 의 'mcpServers npx resolvability' 와 같은 클래스: "인쇄되는 게
// 실재하는가").
//
// #286 — A8 은 오래도록 **틀린 불변식**을 쟀다. `shared/commands/ait-<verb>.md`
// 파일이 있으면 통과시켰는데, 정작 런타임이 받는 건 파일명이 아니라 **명령 키**다.
// 설치 형상(`/plugin install`)에서 플러그인 이름이 네임스페이스가 되어 키는
// `ait:<basename>` 이 된다 — 공백 형태 `/ait <verb>` 는 어떤 형상에서도 존재한
// 적이 없고(`Unknown command: /ait`), 파일 검사만으로는 그게 안 잡혔다. 그래서
// 아래 두 가지를 함께 본다:
//   (1) 인쇄되는 형태가 `/ait:<verb>` 인가 (공백 형태는 하드 실패)
//   (2) 그 verb 가 실재 명령 키로 resolve 되는가
//
// 합법 verb 집합 = command basename ∪ skill 이름. skill 도 같은 슬래시 목록에
// `ait:<skill>` 로 오르므로(런타임 확인) 대응 stub 없이도 그 자체로 호출된다.
// 산문(non-fenced) 언급은 검사하지 않는다 — seam 계약은 '인쇄되는' 토큰에
// 한정되며(A2/seam-not-printed 와 동일 스코프), 설명문 속 우연한 `/ait` 는
// false-positive 가 되기 때문이다.

/**
 * 합법 `/ait:<verb>` 집합 = command basename ∪ skill 이름.
 * @param {string} root
 */
function legalAitVerbs(root) {
  /** @type {Set<string>} */
  const verbs = new Set();
  for (const cmdFile of Object.keys(EXPECTED_CMD_TO_SKILL)) {
    verbs.add(cmdFile.replace(/\.md$/, ''));
  }
  for (const skillName of listDirs(path.join(root, 'shared', 'skills'))) {
    verbs.add(skillName);
  }
  return verbs;
}

/** @param {string} root @returns {Violation[]} */
function checkA8(root) {
  const violations = [];
  const skillsDir = path.join(root, 'shared', 'skills');
  const legal = legalAitVerbs(root);

  for (const skillName of listDirs(skillsDir)) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const relFile = path.relative(root, skillFile);
    const src = readFile(skillFile);
    const srcLines = src.split('\n');
    const fencedLines = fencedCodeLineNumbers(srcLines);

    // 이미 보고한 verb 는 skill 당 한 번만 (노이즈 억제).
    const reported = new Set();
    for (let i = 0; i < srcLines.length; i++) {
      if (!fencedLines.has(i + 1)) continue; // 인쇄되는(fenced) 토큰만 검사
      const line = srcLines[i];

      // (1) 공백 형태는 존재하지 않는 명령이다 (#286).
      for (const match of line.matchAll(/\/ait ([a-z][a-z0-9-]*)/g)) {
        const verb = match[1];
        const key = `space:${verb}`;
        if (reported.has(key)) continue;
        reported.add(key);
        violations.push(
          mkv(
            relFile,
            i + 1,
            'A8/seam-verb-space-form',
            `인쇄된 seam '/ait ${verb}' 는 존재하지 않는 명령이다 — '/ait' 라는 명령이 없어 'Unknown command: /ait' 로 끝난다 (fix: '/ait:${verb}' 로 표기)`,
          ),
        );
      }

      // (2) 콜론 형태의 verb 가 실재 명령 키로 resolve 되는가.
      for (const match of line.matchAll(/\/ait:([a-z][a-z0-9-]*)/g)) {
        const verb = match[1];
        if (legal.has(verb) || reported.has(verb)) continue;
        reported.add(verb);
        violations.push(
          mkv(
            relFile,
            i + 1,
            'A8/seam-verb-unresolved',
            `인쇄된 seam '/ait:${verb}' 가 실재 명령으로 resolve 되지 않는다 — shared/commands/${verb}.md 도 shared/skills/${verb}/ 도 없다 (fix: verb 오타·stale rename 정정, 또는 명령 추가 + EXPECTED_CMD_TO_SKILL 갱신). 합법 verb: ${[...legal].sort().join(', ')}`,
          ),
        );
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A6 — 링크 liveness (opt-in, warn-only, 네트워크)
// ---------------------------------------------------------------------------
//
// 기본은 SKIP — 네트워크 비의존·결정적 CI 경로를 보존한다(A4 graceful-skip 동형).
// VALIDATE_LINKS=1 일 때만 실행해 skill 전반의 *.aitc.dev 링크가 실제로
// 200을 반환하는지 검사한다. 절대 error 로 올리지 않는다 — 외부 호스트라
// 비결정적이고, 어디까지나 수동 link-sweep 자동화(advisory)다.
// (#183 docs /intro 404, #185 외부 링크 rot 가 A2 정적 검사를 빠져나간 갭을 닫는다.)

// 추출했지만 검사에서 제외하는 링크 패턴 (확인된 false-positive — #181·#185 triage):
//   - placeholder/template 토큰(<...>) 포함 링크
//   - oidc-bridge.aitc.dev bare-root: tenant dispatcher 라 루트 404 가 정상 동작
const A6_SKIP_LINK_RES = [
  /[<>]/, // <tenantId>, <resolved-path> 등 placeholder
  /^https:\/\/oidc-bridge\.aitc\.dev\/?$/, // bare-root = tenant dispatcher 정상 404
];

/**
 * skills 전반에서 *.aitc.dev 링크를 파일:행과 함께 추출한다.
 * @param {string} root
 * @returns {{ url: string, file: string, line: number }[]}
 */
function collectAitcLinks(root) {
  const skillsDir = path.join(root, 'shared', 'skills');
  /** @type {{ url: string, file: string, line: number }[]} */
  const out = [];
  const linkRe = /https:\/\/[a-z0-9.-]*aitc\.dev[a-zA-Z0-9./_-]*/g;
  for (const skillName of listDirs(skillsDir)) {
    const skillFile = path.join(skillsDir, skillName, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const relFile = path.relative(root, skillFile);
    const lines = readFile(skillFile).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const m of line.matchAll(linkRe)) {
        const url = m[0].replace(/[.,)]+$/, ''); // 문장부호 trailing 제거
        // URL 바로 뒤가 placeholder 토큰(<...>)이면 잘린 prefix 라 검사 제외.
        // (linkRe 가 '<' 에서 멈추므로 https://.../t/<tenantId> 가 '.../t/' 로 캡처됨)
        const after = line.slice(m.index + m[0].length);
        if (after.startsWith('<')) continue;
        if (A6_SKIP_LINK_RES.some((re) => re.test(url))) continue;
        out.push({ url, file: relFile, line: i + 1 });
      }
    }
  }
  return out;
}

/**
 * 단일 URL liveness 확인. HEAD 우선, 405/501 등엔 GET fallback.
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number | string }>}
 */
async function probeUrl(url) {
  const tryFetch = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: ctrl.signal,
      });
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    let status = await tryFetch('HEAD');
    // 일부 호스트는 HEAD 미지원 → GET 재시도
    if (status === 405 || status === 501 || status === 403) {
      status = await tryFetch('GET');
    }
    return { ok: status >= 200 && status < 400, status };
  } catch (err) {
    return { ok: false, status: err instanceof Error ? err.name : 'fetch-error' };
  }
}

/**
 * @param {string} root
 * @returns {Promise<Violation[]>}
 */
async function checkA6(root) {
  if (process.env.VALIDATE_LINKS !== '1') {
    return [
      mkv(
        '',
        0,
        'A6/skipped',
        'VALIDATE_LINKS=1 이 아니라 링크 liveness 검사 건너뜀 (기본 동작)',
        'warn',
      ),
    ];
  }

  const links = collectAitcLinks(root);
  // 같은 URL 중복 제거하되 첫 등장 위치 보존
  /** @type {Map<string, { file: string, line: number }>} */
  const unique = new Map();
  for (const l of links) {
    if (!unique.has(l.url)) unique.set(l.url, { file: l.file, line: l.line });
  }

  const entries = [...unique.entries()];
  const results = await Promise.all(
    entries.map(async ([url, loc]) => ({ url, loc, ...(await probeUrl(url)) })),
  );

  /** @type {Violation[]} */
  const violations = [];
  for (const r of results) {
    if (!r.ok) {
      violations.push(
        mkv(
          r.loc.file,
          r.loc.line,
          'A6/dead-link',
          `링크 비정상 응답 (${r.status}): ${r.url} (fix: 살아있는 경로로 교체하거나 placeholder 면 A6_SKIP_LINK_RES 에 추가)`,
          'warn',
        ),
      );
    }
  }
  if (violations.length === 0) {
    violations.push(
      mkv(
        '',
        0,
        'A6/ok',
        `링크 liveness 통과 (${unique.size}개 *.aitc.dev 링크 전부 2xx/3xx)`,
        'warn',
      ),
    );
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 메인 실행 함수 (export)
// ---------------------------------------------------------------------------

/**
 * @param {string} [repoRoot] repo 루트 경로 (기본값: 이 스크립트 기준 상위)
 * @returns {{ violations: Violation[], hasErrors: boolean }}
 */
export function runChecks(repoRoot) {
  const root = repoRoot ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

  const allViolations = [
    ...checkA1(root),
    ...checkA2(root),
    ...checkA3(root),
    ...checkA4(root),
    ...checkA5(root),
    ...checkA7(root),
    ...checkA8(root),
  ];

  const hasErrors = allViolations.some((viol) => viol.level === 'error');
  return { violations: allViolations, hasErrors };
}

/**
 * 위반 사항을 규칙 그룹별로 콘솔에 출력한다.
 * @param {Violation[]} violations
 */
function printViolations(violations) {
  if (violations.length === 0) {
    console.log('모든 검사를 통과했습니다.');
    return;
  }

  /** @type {Map<string, Violation[]>} */
  const groups = new Map();
  for (const viol of violations) {
    const prefix = viol.rule.split('/')[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(viol);
  }

  const groupLabels = {
    A1: 'A1 — frontmatter + 1:1 매핑 + 라우팅 스냅샷',
    A2: 'A2 — 본문 구조 + seam',
    A3: 'A3 — 템플릿 + eval 동기화',
    A4: 'A4 — CLI 토큰 크로스체크 (warn)',
    A5: 'A5 — plugin.json ↔ package.json 버전 드리프트',
    A6: 'A6 — 링크 liveness (opt-in, warn)',
    A7: 'A7 — mcpServers npx args 해석 가능성',
    A8: 'A8 — seam /ait:verb 형태·해석 가능성',
  };

  for (const [prefix, items] of groups) {
    console.log(`\n${groupLabels[prefix] ?? prefix}`);
    console.log('-'.repeat(70));
    for (const item of items) {
      const loc = item.file ? `${item.file}:${item.line}` : '(전역)';
      const tag = item.level === 'warn' ? '[warn] ' : '[error]';
      console.log(`  ${loc.padEnd(58)} ${tag}  [${item.rule}]  ${item.message}`);
    }
  }

  const errors = violations.filter((viol) => viol.level === 'error');
  const warns = violations.filter((viol) => viol.level === 'warn');
  console.log(`\n요약: ${errors.length} error, ${warns.length} warn`);
}

// ---------------------------------------------------------------------------
// CLI 진입점
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('validate-plugin.mjs'));

if (isMain) {
  const { violations, hasErrors } = runChecks();
  // A6 (링크 liveness)는 opt-in async 검사 — CLI 진입점에서만 실행한다.
  // 기본은 VALIDATE_LINKS!=1 이라 즉시 skip warn 을 반환하고, runChecks 의
  // 동기 계약(vitest wrapper 가 의존)은 건드리지 않는다.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const a6 = await checkA6(root);
  const all = [...violations, ...a6];
  printViolations(all);
  if (hasErrors) process.exit(1);
}
