/**
 * validate-plugin.mjs
 *
 * 구조 검증기 — shared/{skills,commands,templates} + eval/ 의 정합성을 확인.
 * 10개 그룹으로 나뉜다 (A4 — CLI 토큰 크로스체크는 대상이 없어져 제거됨, harness
 * 절단 이후 이 repo에는 console-cli/aitcc 크로스체크 대상이 존재하지 않는다):
 *   A1 — frontmatter + 1:1 매핑 + 라우팅 스냅샷 (hard-fail)
 *   A2 — 본문 구조 + seam 검사 (슬래시·자연어 2표면 포함, hard-fail)
 *   A3 — 템플릿 + eval 동기화 (hard-fail)
 *   A5 — plugin.json ↔ package.json 버전 드리프트 (hard-fail — `.claude-plugin`·
 *        `.cursor-plugin` 두 어댑터 매니페스트 모두 대상)
 *   A6 — aitc.dev 링크 부재 검사 (opt-in warn, VALIDATE_LINKS=1 일 때만 —
 *        허용 목록 외 aitc.dev 링크가 남아있지 않은지 확인. 네트워크 비의존)
 *   A7 — mcpServers npx args 해석 가능성 (hard-fail)
 *   A8 — seam /ait:verb 형태·해석 가능성 (hard-fail)
 *   A9 — skill 본문 실제 주입 여부 (opt-in, VALIDATE_SKILL_LOAD=1 일 때만 —
 *        skill 8개 각각에 대해 `claude -p` 세션을 하나씩 띄워 `Skill(ait:<v>)`
 *        호출 후 세션에 실제로 주입된 텍스트를 디스크 SKILL.md 와 글자 단위로
 *        비교한다. harness#134(6/8 skill 이 3주간 본문 미주입 — 이름이 같은
 *        command stub 이 skill 을 가려서 불활성 문자열만 주입됨. 라우팅
 *        eval·e2e eval·정적 검증기 전부 green 이었다)의 **증상**을 원인과
 *        무관하게 직접 잡는 회귀 가드. 정적 검사(A1/cmd-name-shadows-skill)는
 *        harness#134 가 실제로 겪은 원인(이름 충돌)만 잡지만, 이건 "호출된
 *        skill 의 본문이 세션에 실제로 들어왔는가"라는 결과 자체를 잰다.
 *        CLI 세션 8회가 필요해 느리고 인증된 구독 세션이 전제라 CI 에는 못
 *        올린다 — §A9 상세 주석 참조)
 *   A10 — CHANGELOG.md 버전 섹션 존재 (hard-fail — 0.1.22/0.1.23 드리프트:
 *        버전만 올라가고 CHANGELOG 미기록으로 재발 방지. changesets 워크플로상
 *        "changeset 누적 중 + 버전 미변경"은 정상 상태라 예외를 두는 대신,
 *        불변식을 "현재 package.json 버전 섹션이 CHANGELOG.md 에 있는가"
 *        하나로 단순화한다 — 버전을 올리는 경로가 무엇이든(수동/`changeset
 *        version`/스크립트) CHANGELOG 동반 기록을 강제한다)
 *   A11 — 어댑터 manifest 정합성, .cursor-plugin ↔ .claude-plugin (hard-fail —
 *        `.cursor-plugin/plugin.json` 이 `.claude-plugin/plugin.json` 과 이름·
 *        skills 경로·mcpServers 를 어긋나게 들고 가지 않는지, 루트 marketplace
 *        2종에 이 패키지 항목이 정합하게 등록돼 있는지 확인. `keywords` 는
 *        의도적으로 대조하지 않는다)
 *
 * A1–A3·A5·A7·A8·A10·A11 은 runChecks() 가 동기로 돈다(기본 `pnpm test` 경로,
 * 네트워크 비의존). A6·A9 는 CLI 진입점에서만 opt-in 으로 돌고, 각각의
 * 환경변수가 아니면 skip — A6 는 네트워크가 필요 없어졌지만(§A6 참조) 기존
 * CLI 계약과의 호환을 위해, A9 는 CLI 세션 비용이 커서 opt-in 게이트를
 * 유지한다.
 *
 * CLI:           node scripts/validate-plugin.mjs        (A1–A3·A5·A7·A8·A10·A11; A6·A9 skip)
 *                VALIDATE_LINKS=1 node scripts/validate-plugin.mjs      (+ A6 링크 부재 sweep)
 *                VALIDATE_SKILL_LOAD=1 node scripts/validate-plugin.mjs (+ A9 skill 본문 주입 실측)
 * API: import { runChecks } from './scripts/validate-plugin.mjs'
 *      const { violations } = runChecks(repoRoot)        (A1–A3·A5·A7·A8·A10·A11, 동기)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  probeAllSkills,
  SKILL_LOAD_DEFAULT_JOBS,
  SKILL_LOAD_DEFAULT_MODEL,
} from './skill-load-probe.mjs';

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

    // 이름 shadowing 검증 (#286 → harness#133 재판정).
    //   설치 형상에서 command 와 skill 은 **같은 슬래시 목록**에 오르고, 이름이
    //   겹치면 **command 가 이긴다** — 그러면 그 skill 의 SKILL.md 는 세션 안에서
    //   한 번도 로드되지 않는다. `Skill(ait:<v>)` 호출도 command 본문(`Load the
    //   \`<v>\` skill.`)을 주입할 뿐이고, 이후 재호출은 "already loaded;
    //   instructions unchanged" 로 dedup 되어 본문이 영영 안 들어온다.
    //   (실측 claude 2.1.235, 사본 두 벌 단일변수 대조 — 충돌 6종은 24~58바이트
    //   stub 본문, 비충돌 2종은 SKILL.md 전문 28226·5615바이트.)
    //
    //   종전 이 자리의 주석은 "자기 자신과 같은 이름의 skill 로 위임하면 어느
    //   쪽이 이기든 결과가 같으므로 무해하다"고 적었으나 **그 전제가 틀렸다** —
    //   위임 문장은 지시문이 아니라 불활성 문자열로 주입될 뿐이다. 그래서 예외
    //   없이 금지한다. skill 디렉터리만으로 `/ait:<v>` 슬래시·`$ARGUMENTS`
    //   치환·frontmatter(description·argument-hint)가 전부 재현되므로 겹치는
    //   command 파일은 삭제가 정답이다.
    //
    //   본문 파싱보다 **먼저** 판정한다 — 본문이 깨져 있어도 충돌은 잡혀야 한다.
    const cmdVerb = cmdFile.replace(/\.md$/, '');
    if (skillMeta.has(cmdVerb)) {
      violations.push(
        mkv(
          relFile,
          1,
          'A1/cmd-name-shadows-skill',
          `명령 이름 '${cmdVerb}' 가 같은 이름의 skill 을 가린다 — 설치 형상에서 command 가 이기고 skill 본문은 세션 내내 로드되지 않는다 (fix: 이 명령 파일을 삭제하라. skill 디렉터리만으로 '/ait:${cmdVerb}' 슬래시·$ARGUMENTS·frontmatter 가 전부 재현된다)`,
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

  // 대응 command 가 **없는** skill 은 정상이다 — 오히려 그게 선호 형상이다.
  //   skill 디렉터리 하나로 `/ait:<name>` 슬래시가 만들어지고 `$ARGUMENTS` 도
  //   그대로 전달되므로 stub 은 잉여이고, 이름이 겹치면 위 A1/cmd-name-shadows-skill
  //   이 잡는 실제 결함이 된다. 종전 A1/skill-orphan(대응 명령 파일 없음 = 위반)은
  //   바로 그 충돌을 강제로 만들어내던 규칙이라 폐지했다(harness#133).

  // 반대 방향 shadowing: 기존 command 와 같은 verb 로 skill 디렉터리가 새로 생기면
  // 작성자가 만진 파일(SKILL.md) 쪽에 앵커해 잡는다. 위 규칙만 있으면 그 회귀가
  // 엉뚱하게 command 파일에만 보고된다.
  for (const skillName of skillDirs) {
    if (commandMeta.has(`${skillName}.md`)) {
      const relFile = path.join('shared', 'skills', skillName, 'SKILL.md');
      violations.push(
        mkv(
          relFile,
          1,
          'A1/skill-name-collides-command',
          `skill '${skillName}' 이 같은 이름의 명령 파일 'shared/commands/${skillName}.md' 와 겹친다 — 설치 형상에서 command 가 이겨 이 SKILL.md 는 로드되지 않는다 (fix: 그 명령 파일을 삭제하라)`,
        ),
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
// (docs/auth-setup/changeset) + 환경 2 제거로 setup-phone-preview까지 빠진 뒤
// `test-on-device` 신설(harness#98)까지 반영한 8개는 전부 next-station seam을
// 갖는다 — 면제 대상 없음.
const SEAM_EXEMPT_SKILLS = new Set();

// fence 여는 줄 — **선행 공백을 허용한다**. 리스트 아이템 안의 코드블록은
// 마커 너비만큼 들여쓰이는 것이 마크다운의 정상 형태이고(CommonMark), 실제
// design SKILL.md 도 2·5칸 들여쓴 fence 를 5곳에서 쓴다. 종전 `^` 앵커는 그런
// fence 를 전부 "fence 아님"으로 봐서 두 방향의 결함을 동시에 만들었다
// (harness#137 3회차):
//   - 오탐 #1: 차단 메시지 템플릿을 `- 차단 메시지:` 아래로 들여쓰기만 해도
//     "템플릿(fenced 블록)이 없음" 이 발화했다 — 내용은 한 글자도 안 바뀌었는데.
//   - 우회 S4: 관문 앞의 파일 생성 명령 블록을 들여쓰면 fence 인지 규칙에서
//     통째로 사라져 asset-before-checkpoint 구조 검사가 못 봤다.
// 한 군데를 고치면 둘 다 닫힌다.
//
// **인용(`>`) 접두도 허용한다, 중첩 포함** (harness#137 4회차 F-a) — 종전
// `/^\s*.../` 는 `>` 를 공백으로 보지 않아서 인용된 코드블록(`> \`\`\`bash`)
// 을 "fence 아님"으로 봤다. 실측 우회: asset-before-checkpoint 가 감시하는
// 파일 생성 명령을 `>` 인용 블록 안에 두면 그 블록이 fence 로 인식되지 않아
// 통째로 스캔 밖이었다. `(?:\s*>)*` 로 `>`·`> >` 등 임의 깊이의 인용 접두를
// 소비한 뒤 남은 선행 공백까지 허용한다.
const FENCE_QUOTE_PREFIX_SRC = '(?:\\s*>)*\\s*';
const FENCE_OPEN_RE = new RegExp(`^${FENCE_QUOTE_PREFIX_SRC}(\`{3,}|~{3,})`);

/**
 * 여는 fence 와 짝이 맞는 닫는 fence 정규식을 만든다. 여는 줄과 같은 인용
 * 접두 허용 규칙을 쓴다(harness#137 4회차 F-a) — 인용된 fence 는 닫는 줄도
 * 보통 같은 깊이로 인용되기 때문.
 * @param {string} fenceChar
 * @param {number} fenceLen
 * @returns {RegExp}
 */
function fenceCloseRe(fenceChar, fenceLen) {
  const ch = fenceChar === '`' ? '`' : '~';
  return new RegExp(`^${FENCE_QUOTE_PREFIX_SRC}${ch}{${fenceLen},}\\s*$`);
}

// 인용 접두 제거용 — fence 를 인용 접두와 함께 인식하는 것만으로는 부족하다
// (harness#137 4회차 F-a 후속). 블록 **내용**을 line-anchored 정규식으로
// 검사하는 곳들(파일 생성 명령 탐지 `ASSET_CREATING_CMD_RE`, 차단 메시지
// info-string 판정 `BRAND_GUARD_TEMPLATE_INERT_INFO_RE`)은 전부 `^` 앵커를
// 쓰는데, 인용 부호 `>` 는 그 어떤 것도 공백으로 취급하지 않는다 — fence 는
// 이제 인용된 채로 인식되지만, 그 안의 `> mkdir …` 같은 줄은 여전히 "줄
// 시작이 mkdir 이 아님"으로 읽혀 명령 탐지를 피해간다. 그래서 내용을 그
// 정규식들에 넣기 전에 각 줄의 인용 접두를 지운다 — fence 인식 규칙과 동일한
// 접두 정의를 재사용해 "무엇을 인용으로 보는가"가 두 곳에서 어긋나지 않는다.
const FENCE_QUOTE_STRIP_RE = new RegExp(`^${FENCE_QUOTE_PREFIX_SRC}`);

/**
 * @param {string} line
 * @returns {string}
 */
function stripFenceQuotePrefix(line) {
  return line.replace(FENCE_QUOTE_STRIP_RE, '');
}

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
      const m = line.match(FENCE_OPEN_RE);
      if (m) {
        insideFence = true;
        fenceChar = m[1][0];
        fenceLen = m[1].length;
      }
    } else {
      // closing fence: same char, at least same length, optional leading/trailing whitespace
      const closeRe = fenceCloseRe(fenceChar, fenceLen);
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

/**
 * fenced code block 의 범위 목록을 반환한다 (0-based, 여는/닫는 fence 제외한 내용).
 * `fencedCodeLineNumbers` 와 같은 fence 규칙을 쓰되, "블록 단위" 검사가 필요한
 * 규칙(A2/seam-nl-block-incomplete)을 위해 경계를 보존한다.
 * @param {string[]} lines
 * @returns {{ fenceIdx: number, start: number, end: number }[]} start/end 는 내용의 [start, end)
 */
function fencedBlockRanges(lines) {
  /** @type {{ fenceIdx: number, start: number, end: number }[]} */
  const blocks = [];
  let insideFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!insideFence) {
      const m = line.match(FENCE_OPEN_RE);
      if (m) {
        insideFence = true;
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        fenceIdx = i;
      }
    } else {
      const closeRe = fenceCloseRe(fenceChar, fenceLen);
      if (closeRe.test(line)) {
        blocks.push({ fenceIdx, start: fenceIdx + 1, end: i });
        insideFence = false;
        fenceChar = '';
        fenceLen = 0;
        fenceIdx = -1;
      }
    }
  }
  // 닫히지 않은 fence: 파일 끝까지를 블록으로 본다 (fencedCodeLineNumbers 와 동일 취급).
  if (insideFence) blocks.push({ fenceIdx, start: fenceIdx + 1, end: lines.length });
  return blocks;
}

/**
 * 산문 "문단"의 범위 목록을 반환한다 (0-based, [start, end)).
 *
 * 문단 = 빈 줄로 구분되는 연속된 비-fenced 줄 묶음. fenced code block 안의
 * 줄과 fence 구분선 자체는 어떤 문단에도 속하지 않는다(블록 단위 검사는
 * `fencedBlockRanges` 가 따로 한다).
 *
 * **줄이 아니라 문단이 단위인 이유** (harness#137 우회 #1 대응): 금지 문맥은
 * 문단 안에서 줄을 넘나든다. 예컨대 design SKILL.md 0단계의
 *   `**… 도구를 호출하지 않는다.**`  ← 부정어가 이 줄에
 *   `` `Write`·`Edit`은 물론 `Bash`로 파일을 만드는 것(`mkdir -p assets`, ``
 * 는 한 문단이고, 줄 단위로 보면 둘째 줄만 떼어 "도구 + 생성"으로 오인한다.
 * 문단을 단위로 삼아야 부정 문맥이 함께 읽힌다.
 * @param {string[]} lines
 * @returns {{ start: number, end: number }[]}
 */
function paragraphRanges(lines) {
  const fenced = fencedCodeLineNumbers(lines);
  /** @type {{ start: number, end: number }[]} */
  const out = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const isFenceDelim = FENCE_OPEN_RE.test(lines[i]);
    const skip = isFenceDelim || fenced.has(i + 1) || lines[i].trim() === '';
    if (skip) {
      if (start !== -1) {
        out.push({ start, end: i });
        start = -1;
      }
      continue;
    }
    if (start === -1) start = i;
  }
  if (start !== -1) out.push({ start, end: lines.length });
  return out;
}

/**
 * 각 줄의 시작 **문자 오프셋**(0-based)을 반환한다. 길이는 `lines.length + 1`
 * 이며 마지막 원소는 문서 끝 오프셋(sentinel)이다.
 *
 * 브랜드 체크포인트 위치 판정은 전부 이 오프셋으로 한다 — "지금 어느 heading
 * 절 안인가"로 판단하면 절 밖에 심은 지시문이 스캔 범위에서 통째로 빠진다
 * (harness#137 우회 #1b).
 * @param {string[]} lines
 * @returns {number[]}
 */
function lineStartOffsets(lines) {
  const offsets = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  offsets.push(acc);
  return offsets;
}

/**
 * HTML 주석(`<!-- ... -->`)을 제거하되 줄 수(따라서 line-number 정렬)는
 * 보존한다 — 주석 안의 문자는 개행만 남기고 지운다.
 *
 * 브랜드 가드 관련 substring 검사(harness#137 적대 검증 우회 #1·#2)는 전부
 * 이 함수를 거친 텍스트를 봐야 한다. 이유가 둘이다:
 *   (a) `<!-- G0-1, G0-2 -->` 처럼 렌더링되면 안 보이는 주석 안에 필수
 *       키워드를 채워 넣어 substring 검사를 속이는 시도를 무력화한다 —
 *       주석이 지워지면 그 안의 가짜 키워드도 함께 지워진다.
 *   (b) 절 본문 전체(heading 포함)를 `<!-- -->` 로 감싸 GitHub PR 렌더링
 *       diff 에서는 안 보이게 숨기는 시도도 막는다 — heading 탐색을 이
 *       함수를 거친 라인 배열에서 하면, 주석에 감싸인 heading 자체가
 *       사라져 "절 자체가 없음"으로 정확히 잡힌다.
 * @param {string} s
 * @returns {string}
 */
function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
}

/**
 * fenced code block 안의 줄과 fence 구분선 자체를 빈 줄로 바꾼다 — 줄 수
 * (따라서 line-number 정렬)는 보존한다.
 *
 * `stripHtmlComments` 와 같은 목적이다: **렌더링되는 지시문**만 남기고,
 * 인용·예시로 인쇄되는 텍스트가 substring 검사를 만족시키는 것을 막는다.
 * 종전 quality-bar 스캔은 원본 줄을 그대로 읽어서 fence 도 주석도 보지
 * 않았고, 그래서 진짜 G0 절을 지우고 ```markdown 블록 안에 "폐지된 절
 * (참고용)" 로 옮겨 두기만 해도 통과했다(harness#137 3회차 우회 S6).
 * SKILL.md 쪽 검사가 이미 주석을 제거하고 fence 를 구분하던 것과 달리
 * quality-bar 만 두 축 모두 빠져 있던 비대칭이었다.
 * @param {string[]} lines
 * @returns {string[]}
 */
function blankFencedLines(lines) {
  const fenced = fencedCodeLineNumbers(lines);
  return lines.map((l, i) => (fenced.has(i + 1) || FENCE_OPEN_RE.test(l) ? '' : l));
}

// A2 seam 이중 표면 (harness#101) — 인쇄되는 seam 은 슬래시 명령 단독이 아니라
// **자연어 동치 문장**을 함께 인쇄해야 한다. 이유는 표면 불일치다: `/ait:<verb>`
// 네임스페이스는 Claude Code 설치 형상의 것이고, 플러그인 명령을 skill 로 변환해
// 얹는 에이전트(Codex)에는 슬래시 목록이 그대로 오지 않는다(`$ARGUMENTS` 를 쓰는
// `new`·`plan` 은 변환에서 아예 빠진다 — 루트 README "Codex에서 쓰기"). 그래서
// 슬래시 단일 표면 seam 은 기계적으로 강제돼 있어도 그런 사용자에게는 dead-end 가
// 된다. 규약: 인쇄 블록 안에 `말로: "<발화>"` 형태로 동치 발화를 함께 둔다
// (`말로 하려면:` · `말로 해도 됩니다:` 같은 변형도 허용).
const SEAM_NL_RE = /말로[^"\n]{0,16}:\s*"[^"]{2,}"/;

// 인쇄되는 "명령 줄" — 줄 머리에 `/ait:<verb>` 가 오는 형태만 본다. 산문 속
// 언급(`… 확인은 /ait:debug 로`)까지 요구하면 false-positive 가 된다 (A8 의
// 스코프 한정과 같은 이유).
const SEAM_CMD_LINE_RE = /^\s*\/ait:[a-z][a-z0-9-]*/;

// docs link allowlist — 이제 어떤 skill 도 docs.aitc.dev 링크를(루트/intro
// 뿐 아니라 주제별 deep-link 포함 전부) 직접 인쇄하지 않는다(아래
// DOCS_MCP_MENTION_RE 참조: docs MCP 도구로 대체). 빈 Set 이라
// A2/docs-link-banned 검사가 전 skill 에 균일하게 적용된다.
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

// A2 brand-guard-section-required (harness#104) — 토스 브랜드·UI 모방 방지
// 가드가 명시된 skill. 화면·자산을 실제로 산출하는 skill이 대상이다. 지금은
// `design`(등록 이미지 자산 + UX 매핑) 하나뿐 — 다른 skill(new-miniapp 등)이
// 화면을 직접 만드는 축으로 커지면 여기 추가한다. skill 산출물(텍스트) 존재
// 검사만 가능하고, 실제 생성물(사용자 프로젝트의 화면 코드)이 이 원칙을
// 지키는지는 이 스크립트가 검사할 수 없다 — 그건 skill 런타임 지침(에이전트가
// 그 순간 따르는가)의 몫이다. 이 검사는 그 지침 자체가 문서에서 삭제되는
// 회귀를 잡는다.
const BRAND_GUARD_REQUIRED_SKILLS = new Set(['design']);

// 가드 절의 정확한 heading — 이 문자열이 사라지면(오탈자·rename 포함)
// A2/brand-guard-section-missing 이 발화한다.
const BRAND_GUARD_HEADING = '## 토스 브랜드·UI 모방 금지';

// 중단·정지 어휘 — "멈추다"의 활용형 전반(멈추-/멈춘-/멈춤) + 통상 동의어
// (중단·중지·정지)를 함께 잡는다(harness#137 4회차 F-d, 5회차 F3). 종전에는
// 이 절 아래 상수가 `/멈춘다|중단/`, 체크포인트 쪽 형제 상수
// (BRAND_GUARD_CHECKPOINT_REQUIRED_CONTENT)가 `/멈추|중단/` 로 서로 다른
// 음절만 매치해서, "멈추고"(체크포인트 쪽 통과, 이 절 쪽 실패)나 "멈춘다"
// (반대) 처럼 어간이 갈리면 어느 한쪽만 인식하지 못했다 — 정직한 활용형
// 리라이팅이 검사기를 갈랐다는 뜻이다. 두 상수 **모두** 이 하나를 참조해
// 일치를 강제한다. 5회차에서는 "중단"을 뜻이 같은 "중지"로 바꿔 쓰기만 해도
// 두 상수 모두 놓치는 것을 확인해 "중지"·"정지"까지 넓혔다.
const BRAND_GUARD_STOP_WORD_RE = /멈추|멈춘|멈춤|중단|중지|정지/;

// 가드 절 본문에 최소한 있어야 하는 요소 — (검사용 키워드, 실패 메시지).
// 금지 목록(로고·워드마크·브랜드 컬러·화면 복제·상호 오용) + 대안 제시 +
// 위반 의심 시 절차(사용자 고지 + 중단)를 모두 포함해야 issue #104 AC를
// "명시"한 것으로 본다.
const BRAND_GUARD_REQUIRED_CONTENT = [
  [/로고/, '로고 사용 금지 언급 없음'],
  [/워드마크/, '워드마크 사용 금지 언급 없음'],
  // `색` 단독까지 넓히지 않는다 — 같은 절 대안 문단(design SKILL.md의
  // "사용자가 실제 브랜드 색을 알려주면")이 ❌ 항목 삭제 후에도 매치돼 검사가
  // 공허해진다(아래 서체 항목 주석과 같은 실패 모드, harness#137 5회차 F4).
  [/브랜드\s*(?:컬러|색상)/, '브랜드 컬러/색상(primary 채택 금지) 언급 없음'],
  [/로그인/, '토스 로그인/인증 화면 모방 금지 언급 없음'],
  // `이름`·`명칭` 단독으로 넓히지 않는다 — 같은 불릿의 "미니앱 이름"이 항목
  // 삭제 후에도 매치된다(harness#137 5회차 F4).
  [/상호|토스[^\n]{0,8}?(?:명칭|브랜드명)/, '"토스" 상호/명칭 오용 금지 언급 없음'],
  // 넓게 `서체|폰트`로 잡으면 같은 절의 "시스템 폰트 스택" 대안 문장이 대신
  // 매치돼, ❌ 금지 항목이 삭제돼도 통과한다 — 금지 쪽에만 나오는 표현을 건다.
  [/Toss Product Sans|토스 전용 (본문 )?서체/, '토스 전용 본문 서체 사용 금지 언급 없음'],
  [BRAND_GUARD_STOP_WORD_RE, '위반 의심 시 중단 절차 언급 없음'],
  [/사용자에게/, '위반 의심 시 사용자 고지 절차 언급 없음'],
];

// A2 brand-guard-checkpoint-required (harness#137) — "토스 브랜드·UI 모방 금지"
// 절은 금지 목록을 **선언**할 뿐이고, 에이전트가 산출 전에 실제로 멈추게 하는
// 지침은 "실행 순서"의 0단계(브랜드 체크포인트)다. 위 A2/brand-guard-section-*
// 는 선언 절의 존재만 봐서, 0단계를 통째로 지워도 CI가 초록이었다
// (harness#137 갭 리포트). 아래 규칙들이 그 회귀를 **탐지**한다 — 에이전트
// 행동을 집행하는 것이 아니다(checkA2 안의 "보장하는 것/못하는 것" 주석 참조).
//
// heading 은 exact-match 가 아니라 정규식이다 — "(산출 도구 호출 전 관문)"
// 같은 괄호 부연은 저자가 자연스럽게 다듬을 수 있는 부분이라 여기까지 강제하면
// 사소한 리라이팅마다 CI가 깨진다. "0 + 브랜드 체크포인트"라는 핵심 개념만
// 살아있으면 통과시키고, 그 개념 자체가 사라지거나 다른 절로 대체되면
// (오탈자·rename 포함) 잡는다.
//
// **좁히는 방향으로 고쳤다** (harness#137 적대 검증 2회차 우회 #2): 종전
// `/^### 0[^\n]{0,20}?브랜드\s*체크포인트/` 는 "0" 과 "브랜드 체크포인트"
// 사이에 임의의 20자를 허용해서 `### 0번 항목은 브랜드 체크포인트가 아니다`
// 까지 체크포인트로 **수락**했다 — 즉 "이건 체크포인트가 아니다"라고 명시한
// 절이 체크포인트 자리를 차지했다. 그래서 "0" 뒤에는 단계 표기(`단계`/`번째`)
// 와 구분자(`.`/`)`/`:`/`—`/공백)만 허용한다. 관용 표기(`0단계 —`, `0)`,
// `0:`)는 그대로 통과하고(오탐 #1 회귀 방지), 임의 산문이 끼어드는 형태는
// 더 이상 통과하지 않는다. anchor 가 `0` 이라 `### 10.` 같은 다른 단계
// 번호는 애초에 매치될 수 없다.
//
// 구분자 목록에 가운뎃점(`·`)을 넣은 것은 harness#137 3회차 오탐 #5 대응이다 —
// 이 파일이 문서 전체에서 자기 구분자로 쓰는 문자(`토스 브랜드·UI 모방 금지`,
// `safe-area / swipe-back / PageHeader / 토큰 일관성`)를 heading 에서만 거부하면,
// 저자가 파일의 관례를 따랐다는 이유로 CI 가 깨진다. `•` 도 같은 이유로 받는다.
//
// "0" 과 "단계"/"번째" 사이의 하이픈·공백도 받는다(harness#137 5회차 F5) —
// 문서가 이미 다른 단계 라벨에 `2-B`·`2-C` 처럼 하이픈 관례를 쓰기 때문에
// "0-단계 브랜드 체크포인트" 같은 정직한 표기까지 거부하면 그 관례를 따른
// 저자만 벌한다.
const BRAND_GUARD_CHECKPOINT_HEADING_RE =
  /^###\s+0(?:\s*[-–—]?\s*(?:단계|번째))?\s*[.):：·•\-–—]?\s*브랜드\s*체크포인트/;

// 위 STRICT 수락 정규식과 짝을 이루는 **진단용** 후보 정규식(종전 넓은 형태).
// 수락에는 쓰지 않는다 — "체크포인트처럼 생겼지만 수락되지 않는 heading" 을
// 조용히 무시하는 대신 그 사실 자체를 보고하기 위한 것이다. 조용한 무시는
// "왜 절이 없다고 하지?" 라는 진단 불가 오류를 만든다.
const BRAND_GUARD_CHECKPOINT_HEADING_LOOSE_RE = /^#{1,6}\s+0[^\n]{0,20}?브랜드\s*체크포인트/;

// heading 의 **의미**를 본다 — 모양만 맞고 뜻이 부정인 heading("…가 아니다",
// "…하지 않는다", "제외", "취소")은 체크포인트로 수락하지 않는다. 이 검사기가
// 할 수 있는 의미 판정은 딱 이 정도다(부정어 표층 검출) — 문장 전체의 의미
// 반전은 잡지 못한다(위 "보장하지 못하는 것" 주석 참조).
const BRAND_GUARD_HEADING_NEGATION_RE =
  /아니다|아닙니다|아님|않는다|않습니다|않음|제외|취소|폐지|생략|무시|건너뛰|삭제|더\s*이상/;

// 다만 "생략 불가"·"제외 없음"·"건너뛰기 금지" 처럼 **의무를 강조하려고**
// 부정어를 쓰는 heading 은 정상이다. 그런 강조어가 있으면 부정으로 보지
// 않는다 — 이 예외가 없으면 정직한 강조가 CI 를 깬다.
//
// **인접성을 요구하도록 좁혔다** (harness#137 3회차 우회 S3): 종전
// `/금지|불가|없음|필수|반드시|먼저|무조건/` 는 heading 아무 데나 있기만 하면
// 면제여서, 부정 문구를 그대로 둔 채 무관한 낱말 하나만 끼워 넣으면 검사가
// 통째로 열렸다 — 실측: `### 0. 브랜드 체크포인트 (관문은 아니다 — 생략해도
// 된다)` 는 2 error 인데 여기 `필수 아님` 을 덧붙이면 0 error 였다. 게다가
// `금지` 는 보호 대상 절의 주제어라 이 heading 에 자연히 등장할 수 있다.
// 그래서 강조 어휘가 **부정어 바로 뒤**에 붙어 한 덩어리를 이룰 때만
// 면제한다("생략 불가", "제외 없음", "건너뛰기 금지", "생략할 수 없다").
// 사이에 끼어들 수 있는 글자는 조사·보조어간 정도(8자)로 제한한다.
//
// **남는 구멍**(harness#137 5회차 F1): 면제는 heading **단위** 불리언이라,
// 인접 쌍("생략 불가") 하나가 있으면 그 heading 안의 **다른** 부정어(예:
// "아니다"/"더 이상"/"않는다")까지 함께 면제된다 — 실측: `### 0. 브랜드
// 체크포인트가 아니다 — 생략 불가` 는 진짜 부정어("아니다")가 남아 있는데도
// 인접 쌍 하나로 negation 검사가 통째로 면제돼 0 error 다. 이 라벨 데코
// 면제는 의도적 회피 클래스이며, 트리거별로 개별 면제를 강제하도록 좁히면
// "생략하지 않는다" 류의 정직한 heading 을 새로 벌하는 오탐 위험이 있어
// 정적 린트에서는 닫지 않는다 — PreToolUse 훅 이슈가 추적한다.
const BRAND_GUARD_HEADING_MANDATORY_ADJACENT_RE =
  /(?:생략|제외|취소|폐지|무시|삭제|건너뛰기|건너뜀|건너뛰)[^\n]{0,8}?(?:불가|금지|없음|없다|없이|불허|안\s*된다|안\s*됨)/;

// 강등된(demoted) 단계 라벨 — `### N. 제목` 을 `**N. 제목**` 으로 바꿔 절의 끝
// 경계를 지우는 우회(harness#137 적대 검증 2회차 우회 #4)를 막기 위해 이것도
// 경계로 인정한다. **숫자 라벨을 요구하는 것은 정밀도 선택이다**: 본문의
// 정상 강조(`**이 관문을 통과하기 전에는 … 호출하지 않는다.**` — design
// SKILL.md 0단계 실제 문장)를 경계로 오인하면 절이 한 줄로 잘려 false-fail 이
// 되고, false-fail 은 저자가 검사를 우회하도록 가르친다. 숫자 없는 강등
// (`**Figma MCP 탐지**`)은 이 규칙이 못 잡고, 그 경우는 아래 줄 수 상한이
// 2차 방어다.
const BRAND_GUARD_DEMOTED_STEP_RE =
  /^\*\*\s*\d+(?:\s*[-–—][A-Za-z0-9]+)?\s*(?:단계|번째)?\s*[.):：\-–—]?\s*[^*\n]*\*\*\s*$/;

// "번호 붙은 단계 라벨"에서 그 번호를 뽑는다 — heading(`### 2-B. …`)과 강등
// 라벨(`**1. 실행**`) 양쪽을 같은 규칙으로 읽는다. 번호를 못 읽으면 null.
//
// 이것이 필요한 이유는 harness#137 3회차 S1(b) 다: 체크포인트 절의 끝 경계가
// **지워졌다는 사실**은 "절이 길다"가 아니라 "0단계 바로 다음에 와야 할 1단계
// 라벨이 안 보인다"로 나타난다. 경계로 만난 라벨의 번호가 2 이상이면 그
// 사이의 단계가 통째로 절 안에 삼켜졌다는 뜻이고, 삼켜진 단계의 낱말이
// 체크포인트 요건 충족에 빌려 쓰인다(실측 우회: `### 1.` 을 번호 없는
// `**Figma MCP 탐지 …**` 로 강등하면 짧은 0단계가 `### 2.` 까지 삼키면서
// 1단계의 `예외`·`중단`·`알리는`·물음표 fence 를 그대로 빌려 0 error).
/**
 * @param {string} line
 * @returns {number | null}
 */
function stepLabelNumber(line) {
  const m = line
    .trim()
    .match(
      /^(?:#{1,6}\s+|\*\*\s*)(\d+)(?:\s*[-–—][A-Za-z0-9]+)?\s*(?:(?:단계|번째)\s*[.):：·•\-–—]?|[.):：·•\-–—])/,
    );
  return m ? Number(m[1]) : null;
}

// 체크포인트 절의 줄 수 상한 — 경계 heading 이 전부 지워졌을 때 절이 문서
// 끝까지 늘어나 인접 절의 낱말을 "빌려오지" 못하게 하는 **2차** 방어다.
// 실측: design SKILL.md 의 0단계 절은 35줄.
//
// **1차 방어가 아니다** (harness#137 3회차 S1·오탐 #8): 이 상한은 절이 *길
// 때* 발화하는데 공격은 절을 *비운다* — 방향이 반대다. 그래서 종전처럼
// "60줄 안에 안 끝나면 무조건 위반"으로 쓰면 (a) 결정 항목이나 예시를 하나
// 더 붙였을 뿐인 정직한 증보를 "사라진 heading 을 되돌려라"라는 엉뚱한 문구로
// 벌하고, (b) 정작 절을 비우는 공격은 못 잡는다. 지금은 경계를 **먼저** 찾고,
//   - 경계가 다음 단계 라벨(1단계)이면 → 절이 아무리 길어도 정상(오탐 #8),
//   - 경계가 그 밖의 것이면 → 이 상한을 넘을 때만 "경계를 못 찾겠다"로 보고,
//   - 경계가 문서 끝까지 아예 없으면 → 길이와 무관하게 위반(S1(a)),
//   - 경계 라벨 번호가 2 이상이면 → 삼킴으로 따로 보고(S1(b))
// 하는 방식으로 쓴다.
const BRAND_GUARD_CHECKPOINT_MAX_LINES = 60;

// 체크포인트 절 본문에 최소한 있어야 하는 요소 — 개념 수준 키워드로 잡는다
// (정규식을 좁게 잡으면 저자가 문장을 자연스럽게 다듬을 때마다 깨져서 결국
// 무력화된다). 아래 3개는 harness#137 AC의 핵심:
//   (a) 사용자의 명시 요청도 예외가 아니라는 취지
//   (b) 산출 전에 멈추는 절차
//   (c) 차단 시 사용자에게 알리는 절차
// 실제 차단 메시지 "템플릿"(fenced 블록) 존재는 별도로 구조 검사한다(아래).
const BRAND_GUARD_CHECKPOINT_REQUIRED_CONTENT = [
  [/예외/, '"사용자의 명시 요청은 예외가 아니다" 취지 언급 없음'],
  [BRAND_GUARD_STOP_WORD_RE, '산출 전에 멈추는 절차 언급 없음'],
  [/알리|고지/, '차단 시 사용자에게 알리는 절차 언급 없음'],
];

// 차단 메시지 "템플릿"(fenced 블록)의 요건 — **리터럴 문구가 아니라 구조**로
// 잡는다 (harness#137 적대 검증 2회차 오탐 #7).
//
// 종전에는 실제 SKILL.md 문장 3개("브랜드 가드에 걸립니다" 등)를 그대로
// 리터럴 마커로 요구했다. 그 결과 **뜻을 그대로 두고 문장만 자연스럽게 고쳐
// 쓰면 CI 가 깨졌다** — 정직한 카피 편집을 벌하는 lint 는 저자에게 검사를
// 우회하는 법을 가르친다. 그래서 요건을 "이 블록이 무엇을 하는가"로 바꾼다:
//
//   (a) 정보 문자열(info string)이 없거나 비실행 텍스트(`text`/`md` 등)인
//       fenced 블록 — ```bash 처럼 실행 코드로 태그된 블록은 사용자에게
//       그대로 보여줄 "메시지"가 아니다.
//   (b) 그 블록 안에 물음표로 끝나는 줄이 최소 1개 — 곧 사용자에게 답을
//       요구하는 **질문**을 던진다.
//
// 이 두 조건은 어떤 어휘로 다시 써도 유지되는 반면, 우회 #3(무관한
// ```bash\necho "ok"\n``` 블록으로 교체)은 (a)·(b) 어느 쪽도 만족하지 않는다.
const BRAND_GUARD_TEMPLATE_INERT_INFO_RE =
  /^\s*(?:`{3,}|~{3,})\s*(?:text|txt|plain|plaintext|markdown|md|none)?\s*$/i;
const BRAND_GUARD_TEMPLATE_QUESTION_RE = /[?？]\s*$/;

// 물음표 줄이 **사용자에게 던지는 질문**인지 가리는 최소 필터 (harness#137
// 3회차 우회 S7). info string 검사는 ```bash 같은 실행 태그를 이미 막지만,
// 태그 없는 ``` fence 안에 셸 한 줄을 넣는 형태는 그대로 통과했다 — 실측:
// ```␤echo "ok"   # ready?␤``` 로 템플릿을 통째 교체해도 0 error.
// 그래서 (a) 주석으로 시작하는 줄과 (b) 첫 토큰이 실행 명령인 줄은 질문
// 후보에서 제외한다.
//
// **여기까지가 오탐 없이 조일 수 있는 한계다.** 더 조이려면 낱말 수·길이·
// 어휘를 봐야 하는데, 그건 "진행할까요?" 한 줄짜리 정직한 템플릿(테스트
// 픽스처가 바로 그 형태다)을 깨뜨린다. 즉 `ok?` 같은 한 낱말 물음표 줄은
// 지금도 통과한다 — 오탐 하나와 맞바꿀 만한 이득이 아니라고 판단해 남겨 둔다.
const BRAND_GUARD_TEMPLATE_NON_QUESTION_LINE_RE =
  /^\s*(?:#|\/\/|\$\s|>\s*\$)|^\s*(?:echo|printf|cat|ls|cd|pwd|node|python3?|npm|pnpm|npx|yarn|magick|convert|sips|mkdir|touch|cp|mv|rm|curl|wget|grep|sed|awk|tee|export|source|true|false|exit)\b/;

// ---------------------------------------------------------------------------
// A2 brand-guard-asset-before-checkpoint (harness#137 적대 검증 2회차 우회
// #1·#1b) — 관문이 끝나기 **전에** 자산·코드를 만들라는 지시가 문서 어디에
// 있으면 안 된다. 종전 위치 검사는 "'## 실행 순서' 절 안에서 heading 순서"만
// 봐서, (a) '### 0.' heading 앞의 heading 아닌 산문과 (b) '## 실행 순서'
// 앞에 새로 만든 H2 절이 스캔 범위에서 통째로 빠졌다. 아래 검사는 heading
// 절이 아니라 **문서 전체를 문자 오프셋으로** 훑는다.
// ---------------------------------------------------------------------------

// 파일을 만드는 도구·명령 토큰. 이 낱말이 나오는 것 **자체는 문제가 아니다**
// — 금지 목록과 관문 선언이 바로 이 낱말들을 인용하기 때문이다. "지시문"으로
// 판정하려면 아래 IMPERATIVE 와 같은 문단에 있고 PROHIBITION 문맥이 아니어야
// 한다(3조건 AND).
//
// 목록이 빠져 있으면 그 도구를 쓰는 지시문은 3조건 AND 의 첫 다리에서 통째로
// 빠진다(harness#137 3회차 S5) — 실측 우회: "`python3` 로 … 플레이스홀더를
// 만들어야 한다" 는 0 error 였다. 그래서 design SKILL.md 3단계가 실제로
// 안내하는 백엔드(python3/node)와, 파일을 만드는 흔한 CLI·에디터 도구를
// 채워 넣는다. `node` 는 소문자 명령 형태만 본다 — 산문의 `Node canvas`
// 까지 잡으면 오탐이 된다.
const ASSET_TOOL_TOKEN_RE =
  /\bWrite\b|\bEdit\b|\bMultiEdit\b|\bNotebookEdit\b|\bBash\b|\bmkdir\b|\btouch\b|\bmagick\b|\bconvert\b|\bsips\b|\bsharp\b|\bsvgexport\b|\bffmpeg\b|\bprintf\b|\btee\b|\bpython3\b|\bnode\b|\bPillow\b|\bImage\.new\b|writeFileSync|cat\s*>/;

// 평서 종결형 지시("…한다/…하라/…해라/…합니다")만 본다. 관형형(`만드는`)·
// 조건형(`만들려면`)까지 넓히면 `## 의존` 절의 "정확한 규격으로 PNG를
// 만들려면 ImageMagick(`magick`/`convert`)이나 `sips` … 있으면 활용한다"
// 같은 정상 서술이 걸린다(실측 — design SKILL.md).
//
// 종결형 변형이 빠져 있어도 같은 우회가 성립한다(harness#137 3회차 S5) —
// `만들어야 한다`·`만듭니다` 처럼 뜻이 같은 다른 종결형은 종전 목록에
// 없었다. 아래 추가분은 전부 **평서 종결형**이라는 원래 기준을 유지한다.
const ASSET_CREATE_IMPERATIVE_RE =
  /만든다|만들어라|만들라|만들어야\s*한다|만듭니다|만들어\s*(?:준다|줍니다|둔다|둬라|놓는다|둡니다)|생성한다|생성하라|생성해라|생성합니다|호출한다|호출하라|호출해라|실행한다|실행하라|실행해라|작성한다|작성하라|작성합니다|저장한다|배치한다|산출한다|준비한다|완성한다|채운다|내보낸다/;

// 금지·부정 문맥 — 금지 목록과 관문 선언이 자기 자신에게 걸리는 것을
// 막는다(design SKILL.md 0단계의 "`Write`·`Edit`은 물론 `Bash`로 파일을
// 만드는 것 … 도 전부 해당한다" 문단이 정확히 이 경우다).
//
// **적용 범위가 문단이 아니라 문장이다** (harness#137 3회차 S5) — 종전에는
// 문단 어디에든 이 마커가 하나 있으면 문단 전체가 면제였다. 불릿 목록은
// 통째로 한 문단이라, 무관한 불릿 하나의 `않는다` 가 나머지 모든 불릿을
// 면제했다(실측 우회: "- 없는 가이드를 지어내지 않는다." 뒤에 "- `Bash` 로
// `mkdir -p assets` 를 실행한다." 를 두면 0 error). 게다가 `금지` 는 보호
// 대상 절의 주제어라 자연히 근처에 등장한다. 지금은 지시 동사가 있는 **그
// 문장**에서, 그 동사보다 **앞**에 마커가 있을 때만 면제한다.
const ASSET_PROHIBITION_RE =
  /않는다|않아야|않고|않으며|안\s*된다|금지|말고|말라|마라|하지\s*마|전에는|미통과|돌아간다/;

// fenced 블록 안의 파일 생성 명령 — 위 산문 휴리스틱과 **독립인 구조 신호**다.
// 인쇄되는 명령 블록은 산문보다 훨씬 또렷하게 "이걸 실행하라"를 뜻한다.
const ASSET_CREATING_CMD_RE =
  /^\s*(?:mkdir|touch|cp|mv|magick|convert|sips|install)\b|\bcat\s*>|>\s*[\w./-]+\.(?:png|jpg|md|ts|tsx|js|json|css)\b|Image\.new|writeFileSync|\.save\(/m;

// 인라인 코드 span(`` `…` ``) 안의 파일 생성 명령 — 위 (a) fenced 블록 검사와
// 독립인 세 번째 구조 신호다(harness#137 5회차 F1). fenced 블록 없이 불릿마다
// 인라인 코드로만 명령을 나열하면 (a)는 못 잡는다. **인자(`\s+\S`)를 반드시
// 요구하는 것이 핵심** — 그래야 '## 의존' 절이 도구 이름만 맨이름으로 언급하는
// 정상 문장(`magick`/`convert`/`sips` 가 있으면 활용한다)이 걸리지 않는다.
const ASSET_CREATING_INLINE_CMD_RE =
  /^\s*(?:mkdir|touch|cp|mv|magick|convert|sips|install|python3?|node)\b\s+\S|^\s*cat\s*>\s*\S|>\s*[\w./-]+\.(?:png|jpg|jpeg|svg|md|ts|tsx|js|json|css)\b|writeFileSync|Image\.new/;

/**
 * 문단 안에서 **금지 문맥에 놓이지 않은** 산출 지시 동사가 하나라도 있는지
 * 본다. 문단 전체가 아니라 **문장 단위**로 판정하는 것이 핵심이다
 * (harness#137 3회차 S5 — 상수 ASSET_PROHIBITION_RE 주석 참조).
 *
 * 문장 경계는 (a) 종결 부호(`.`/`!`/`?`/`。`) + 공백, (b) 불릿·번호 목록
 * 아이템의 시작 줄로 본다. 지시 동사 위치에서 뒤로 훑어 가장 가까운 경계까지가
 * 그 동사의 문맥이고, 그 범위 안에 금지 마커가 있어야 면제한다 — 마커가 동사
 * **뒤에** 나오는 것은 면제가 아니다("… 만든다. 다만 …는 하지 않는다" 는
 * 앞 문장이 여전히 산출 지시다).
 * @param {string} paraText
 * @returns {boolean}
 */
function hasUnguardedAssetImperative(paraText) {
  const re = new RegExp(ASSET_CREATE_IMPERATIVE_RE.source, 'g');
  for (const m of paraText.matchAll(re)) {
    const at = m.index ?? 0;
    let start = 0;
    for (let i = at - 1; i >= 0; i--) {
      const ch = paraText[i];
      if (ch === '\n') {
        // 목록 아이템의 첫 줄이면 거기서부터가 새 문장이다.
        if (/^[ \t]*(?:[-*+]|\d+[.)])\s/.test(paraText.slice(i + 1))) {
          start = i + 1;
          break;
        }
        continue;
      }
      if (ch === '.' || ch === '!' || ch === '?' || ch === '。') {
        const next = paraText[i + 1];
        if (next === undefined || /\s/.test(next)) {
          start = i + 1;
          break;
        }
      }
    }
    const scope = paraText.slice(start, at + m[0].length);
    if (!ASSET_PROHIBITION_RE.test(scope)) return true;
  }
  return false;
}

// A2 brand-guard-checkpoint-not-first (harness#137) — 체크포인트(0단계)가
// "실행 순서"의 첫 하위 단계인지 위치를 검사하는 기준 heading. 이 문자열은
// design 전용이 아니라 8개 skill 전부가 공유하는 관례다(grep 실측:
// debug·new-miniapp·test-on-device·setup-debugger·plan·welcome 도 정확히
// 이 문자열을 쓴다) — 그래서 상수로 분리해도 design 만의 우연이 아니다.
// 존재만 보던 종전 검사(A2/brand-guard-checkpoint-missing)는 0단계 절을
// 파일 맨 끝(예: 자산 생성 단계보다 뒤)으로 옮겨도 통과시켰다 — 관문이
// 도구 호출보다 먼저 온다는 보장이 없었다는 뜻이다. 이 heading 바로 다음에
// 오는 첫 "### " 가 체크포인트여야 한다는 위치 제약이 그 갭을 메운다.
const BRAND_GUARD_EXEC_ORDER_HEADING = '## 실행 순서';

// **정확 일치가 아니라 prefix 매칭이다** (harness#137 3회차 오탐 #4) — 종전
// `l.trim() === '## 실행 순서'` 는 `## 실행 순서 (0~5단계)` 처럼 저자가
// 부연을 덧붙이는 순간 "heading 을 찾을 수 없음" 으로 오해해서, 절이 멀쩡히
// 제자리에 있는데도 checkpoint-not-first 를 냈다. 다른 heading 상수들이
// 이미 정규식 prefix 매칭인 것과 같은 이유다. 뒤에 올 수 있는 것은 공백·
// 괄호·구분자·줄끝으로 한정해 `## 실행 순서도 …` 같은 다른 절은 안 잡는다.
//
// **"뒤에 아무 공백"을 허용하지 않는다** (harness#137 4회차 F-d) — 종전
// `(?:\s|$|[(...])` 는 대안 중 `\s` 하나만으로 "실행순서" 뒤에 공백이 있으면
// 뒤에 뭐가 오든 매치했다. 그래서 `## 실행 순서 요약`·`## 실행 순서 개요`
// 처럼 실행 순서 절을 요약·개관하는 **다른** 절까지 실행 순서 절 자체로
// 오인했다 — execOrderIdx 가 그 개관 절을 가리키면 그 바로 다음 "### " 가
// 체크포인트가 아닐 수 있어 checkpoint-not-first 오탐(또는 반대로 우회)이
// 난다. 지금은 "실행순서" 뒤에 공백이 오더라도 그 다음이 구분자거나 줄이
// 끝나야만 매치한다 — `## 실행 순서 (0~5단계)`(공백+괄호)는 그대로 인식되고,
// `## 실행 순서 요약`(공백+글자)은 인식되지 않는다.
const BRAND_GUARD_EXEC_ORDER_HEADING_RE = /^##\s+실행\s*순서(?:\s*[(（[{:：·•\-–—]|\s*$)/;

// A2 brand-guard-quality-bar-required (harness#137) — quality-bar.md 의 G0
// 절(브랜드·IP 안전)이 사라지거나 5항목(G0-1~G0-5) 중 일부가 빠지면 잡는다.
// heading 도 위와 같은 이유로 prefix 매칭("(차단)" 같은 부연은 유연하게).
//
// **레벨도 고정하지 않는다** (harness#137 3회차 오탐 #7) — G0~G6 를 `## 그룹별
// 판정 항목` 아래 `###` 로 묶는 재구성은 판정 내용을 한 글자도 안 바꾸는
// 순수 문서 정리인데, `^## G0\b` 는 그것을 "'## G0' 절이 없음" 으로 벌했다.
// 절의 끝은 매치된 heading 과 같거나 더 얕은 레벨의 heading 으로 잡는다.
//
// **하드코딩 배열을 유지한다 — quality-bar.md 자체에서 항목 ID 를 스캔해
// 도출하는 방식은 쓰지 않는다.** 검사 대상 문서 자체에서 "G0-N 이 몇 개까지
// 있는가"를 세면, G0-5 를 통째로 지운 문서는 자기 자신을 기준으로 "4개가
// 전부"라고 스스로 증명해 버려 원래 결함(design-quality-g7-g8 diff 검증
// blocker — G0-5 삭제가 0 error 로 통과)이 그대로 재발한다. 필수 항목
// 개수는 검사 대상과 독립된 이 상수가 정본이다 — G0 항목이 느는·주는
// 대로 이 배열을 함께 갱신한다(항목 5개였던 것이 이번에 G0-5 를 더해
// 5개가 됐다 — quality-bar.md:45 참고).
const QUALITY_BAR_G0_HEADING_RE = /^(#{1,6})\s+G0\b/;
const QUALITY_BAR_G0_REQUIRED_ITEMS = ['G0-1', 'G0-2', 'G0-3', 'G0-4', 'G0-5'];

// A2/render-rules-tier1-incomplete (N2) — design skill 의
// references/render-rules.md 는 1층(하드 규칙) 판정·자동 수정의 정본이다.
// 1-1~1-10 10항목이 전부 `### 1-N ` H3 heading 앵커로 남아 있어야 한다.
//
// **`includes` 로 검사하지 않는다** — `1-1` 은 `1-10` 의 접두 문자열이라,
// `### 1-1` 절만 지우고 `### 1-10` 만 남겨도 `text.includes('1-1')` 는
// `### 1-10` 안에서 여전히 참이 된다. 그래서 각 id 뒤에 숫자가 더 오지
// 않는지 negative lookahead 로 확인하는 `^###\s+<id>(?![0-9])` 형태의
// 정규식을 heading 라인 전체 텍스트에 `m` 플래그로 매칭한다.
const TIER1_REQUIRED_ITEMS = [
  '1-1',
  '1-2',
  '1-3',
  '1-4',
  '1-5',
  '1-6',
  '1-7',
  '1-8',
  '1-9',
  '1-10',
];

// A2/quality-bar-blocking-groups-mismatch (N1) — design 의
// references/quality-bar.md 는 항목별 `등급`(차단/권장) 모델이다. "차단 등급
// 항목에 조정 필요가 남으면 완료가 아니고 design 이 직접 고친다"가 이 skill 의
// 생성형 계약이므로, **어느 그룹이 차단 항목을 갖는가**가 세 곳에 중복 기재된다:
//   ① 이 상수  ② 완료 판정 규칙 2 의 부기 줄  ③ 표 `등급` 열의 실측 집합
// 셋이 어긋나면 "차단인 줄 알았는데 권장"(또는 그 반대) 이라는 조용한 드리프트가
// 난다 — 등급을 하나 바꿔 놓고 규칙 줄을 안 고치면 아무도 안 잡는다.
//
// **heading 접미사는 대조하지 않는다.** 등급이 그룹이 아니라 항목에 붙는
// 모델이라 '## G1 — 컨테이너 적합성 (완료 차단)' 같은 그룹 단위 라벨 자체가
// 성립하지 않고, 실제로 현행 접미사도 불균일했다('(차단)' vs '(완료 차단)').
const QUALITY_BAR_BLOCKING_GROUPS = ['G0', 'G1', 'G2', 'G3', 'G4', 'G7', 'G8'];

// ② 를 찾는 앵커. 문면은 '차단 항목을 가진 그룹: G0·G1·…' 이고, 그 줄에서
// 'G<숫자>' 를 전부 뽑아 선언 집합으로 쓴다.
const QUALITY_BAR_BLOCKING_RULE_RE = /차단\s*항목을\s*가진\s*그룹/;

// ③ 을 읽는 표 행 판정. 첫 셀이 'G<그룹>-<번호>' 인 행만 항목 행으로 보고,
// 그 행의 어떤 셀이 **정확히** '차단' 일 때만 센다 — 산문·근거 열의 '완료
// 차단'·'차단 등급' 같은 표현이 오탐을 만들지 않게 셀 전체 일치로 본다.
const QUALITY_BAR_ITEM_ID_RE = /^(G\d+)-\d+$/;

/** 두 문자열 집합이 같은지. N1 3자 대조 전용(작은 집합이라 정렬 비교로 충분). */
function sameGroupSet(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** 진단 메시지용 그룹 집합 표기. */
function fmtGroupSet(s) {
  const arr = [...s].sort();
  return arr.length === 0 ? '(없음)' : arr.join('·');
}

// A2/design-icon-asset-invalid (N3) — design skill 이 프로젝트에 심는
// 아이콘 6종의 정본 경로(shared/skills/design/assets/project/icons/).
// 1층(1-9)이 "이동·진입 꺾쇠는 텍스트 글리프가 아니라 SVG, 색은
// currentColor 로 상속"을 요구하므로, 우리가 동봉하는 자산 자체가 색을
// 하드코딩하면 자기 규칙을 어긴 자산을 배포하는 셈이다. 파일명 ↔
// icons.tsx named export 매핑도 여기서 아이콘 path(`d`)·`circle` 파리티
// 검사에 함께 쓴다(별도 가드로 쪼개지 않는다).
const DESIGN_ICON_SPECS = [
  { file: 'chevron-right', component: 'ChevronRight' },
  { file: 'chevron-left', component: 'ChevronLeft' },
  { file: 'chevron-down', component: 'ChevronDown' },
  { file: 'chevron-up', component: 'ChevronUp' },
  { file: 'close', component: 'Close' },
  { file: 'search', component: 'Search' },
];

// SVG/TSX 양쪽에서 "모양"을 뽑아 비교하기 위한 서명 — `d="..."` path 값과
// `<circle>` 의 cx/cy/r 을 순서대로 이어 붙인다. 값이 하나라도 다르면(예:
// icons.tsx 를 손으로 고치다 좌표 하나를 오타 내면) 서명이 달라져 잡힌다.
/** @param {string} src @returns {string} */
function extractIconShapeSignature(src) {
  const ds = [...src.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1].trim().replace(/\s+/g, ' '));
  const circles = [...src.matchAll(/<circle\b[^>]*\/?>/g)].map((m) => {
    const attrs = m[0];
    const cx = (attrs.match(/cx="([^"]+)"/) ?? ['', ''])[1];
    const cy = (attrs.match(/cy="([^"]+)"/) ?? ['', ''])[1];
    const r = (attrs.match(/r="([^"]+)"/) ?? ['', ''])[1];
    return `circle(${cx},${cy},${r})`;
  });
  return [...ds, ...circles].join('|');
}

// icons.tsx 안에서 한 아이콘의 named export 블록만 잘라낸다(다음
// `export function`/`export const` 전까지). 컴포넌트를 못 찾으면 null.
/** @param {string} tsxSrc @param {string} componentName @returns {string | null} */
function extractIconComponentBlock(tsxSrc, componentName) {
  const startRe = new RegExp(`export (?:function|const)\\s+${componentName}\\b`);
  const m = startRe.exec(tsxSrc);
  if (!m) return null;
  const restStart = m.index + m[0].length;
  const rest = tsxSrc.slice(restStart);
  const nextExportRe = /export (?:function|const)\s+[A-Za-z]/;
  const next = nextExportRe.exec(rest);
  const end = next ? restStart + next.index : tsxSrc.length;
  return tsxSrc.slice(m.index, end);
}

// ---------------------------------------------------------------------------
// A1 라우팅 스냅샷 — 명령 파일 ↔ skill 매핑 기대값
// shared/commands/ 전수를 열거한다. 변경 시 이 상수도 함께 갱신.
// ---------------------------------------------------------------------------

// 4개 command stub → 2개 skill 매핑. aitcc 전제 skill 4종(register/deploy/status/
// setup-bundle) + 대응 facet stub(ait-register·ait-deploy·ait-status·ait-setup-bundle·
// deploy-key·logs) 은 콘솔 MCP(`apps-in-toss-console`) 기본 포함으로 제거됐다(등록=
// miniapp_create, 번들 업로드=bundle_upload/bundle_upload_complete, 상태=
// miniapp_get_status). 불필요 skill 3종(docs/auth-setup/changeset) + 대응 stub도
// 함께 제거됐다 — docs 는 docs MCP(`apps-in-toss-docs`)가, auth-setup 은 oidc 제거
// 방침이, changeset 은 harness-external 메인테이너 도구 정리가 근거다(harness
// aitcc 정리 — 19→10 command, 15→8 skill). 이후 polyfill facet 이 공식 harness
// 스코프 밖 패키지(monorepo 에서 제거된 `polyfill`)를 안내한다는 이유로 제거되면서
// 10→9로 한 번 더 줄었다(skill 수는 무변 — inject 는 남은 2 facet 으로 계속 존재).
// 이후 환경 2(PWA launcher) 전면 제거(harness#103)로 `setup-phone-preview` skill 과
// 대응 stub 이 함께 빠지며 9→8 command / 8→7 skill 이 됐다. 그 다음 실기기 확인의
// 정규 경로(번들 업로드 → 콘솔 컴파일 → 토스 앱)를 담는 `test-on-device` skill 과
// 대응 stub 이 신설되며 8→9 command / 7→8 skill 이 됐다(harness#98).
// 마지막으로 **skill 과 이름이 겹치던 stub 6개(debug/design/plan/setup-debugger/
// test-on-device/welcome)가 삭제되며 9→3 command 가 됐다**(harness#134). 겹치면
// command 가 이기고 그 본문이 불활성 문자열로 주입돼 skill 의 SKILL.md 가 세션에
// 아예 안 들어온다 — 삭제해도 `/ait:<verb>` 사용자 표면은 무변경이다(skill 자체가
// 그 키로 오르고, $ARGUMENTS 치환·description·argument-hint 전부 skill 쪽에 있다).
// 남는 3개는 전부 대응 skill 과 이름이 다르다(new→new-miniapp, inject-* → inject).
// 이후 inject skill 에 3번째 facet(tossface — Tossface 이모지 서체 CDN/번들 배선)이
// 추가되며 대응 stub 이 신설돼 3→4 command 가 됐다(skill 수는 무변). 병합 1건에
// facet 이 하나 더 붙는다(command 표면은 무변경):
//   ait-inject-devtools      → inject  (inject-devtools+inject-debug-console+
//   ait-inject-debug-console → inject   inject-tossface 3-facet 병합: 전부 기존
//   ait-inject-tossface      → inject   프로젝트 빌드/자산 셋업 패치 — 병합 skill
//                                        이름은 중립적 `inject`)
// 병합 skill 의 secondary-facet command stub (primary 는 skill 과 같은 verb — inject
// 는 대응 primary stub 이 없어 3개 모두 secondary 취급).
// 이 stub 들은 argument-hint sync 검사에서 면제된다 — 병합 skill 은 hint 를
// 하나만 가지므로 secondary facet 의 hint 와는 본질적으로 어긋나기 때문.
const MERGED_SECONDARY_FACET_CMDS = new Set([
  'inject-devtools.md', // → inject
  'inject-debug-console.md', // → inject
  'inject-tossface.md', // → inject
]);

/** @type {Record<string, string>} */
const EXPECTED_CMD_TO_SKILL = {
  'inject-debug-console.md': 'inject',
  'inject-devtools.md': 'inject',
  'inject-tossface.md': 'inject',
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
                `첫 heading 직후 '>' blockquote 금지 (docs/design/skill-conventions.md §8)`,
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

    // docs.aitc.dev 링크 전면 금지 검출 (allowlist 제외) — 루트/intro 뿐
    // 아니라 주제별 deep-link 포함 어떤 docs.aitc.dev 언급도 금지. 문서
    // 조회는 전부 docs MCP(`apps-in-toss-docs`)의 searchDocumentation/getPage
    // 로 안내한다(아래 A2/docs-mcp-mention-required 와 짝).
    if (!DOCS_LINK_ALLOWLIST.has(skillName)) {
      for (let i = 0; i < srcLines.length; i++) {
        const line = srcLines[i];
        if (/docs\.aitc\.dev\b/.test(line)) {
          violations.push(
            mkv(
              relFile,
              i + 1,
              'A2/docs-link-banned',
              `docs.aitc.dev 링크 금지 — docs MCP(apps-in-toss-docs)의 searchDocumentation/getPage로 조회하도록 안내 (fix: 링크를 지우고 "docs MCP로 조회한다" 식 문구로 대체)`,
            ),
          );
        }
      }
    }

    // docs MCP 언급 존재 강제 (positive — `docs/design/skill-conventions.md`
    // §4 "문서 참조 필수"를 코드로, docs.aitc.dev deep-link → docs MCP 안내로
    // 전환된 뒤의 형태): exempt 가 아닌 skill 은 본문 어딘가에 "docs MCP"
    // 언급이 최소 1개 있어야 한다. (음성 검사 A2/docs-link-banned 와 짝 —
    // 그건 "docs.aitc.dev 링크 금지", 이건 "docs MCP 안내가 있어야 함". 둘
    // 다 통과해야 §4 충족.)
    if (!DOCS_MCP_MENTION_EXEMPT.has(skillName)) {
      if (!DOCS_MCP_MENTION_RE.test(src)) {
        violations.push(
          mkv(
            relFile,
            1,
            'A2/docs-mcp-mention-required',
            `docs MCP 안내 없음 — docs/design/skill-conventions.md §4 위반. 본문에 "docs MCP" 언급(searchDocumentation/getPage로 조회) 필요 (정말 문서 참조가 무관한 skill 이면 DOCS_MCP_MENTION_EXEMPT 에 등재)`,
          ),
        );
      }
    }

    // 토스 브랜드·UI 모방 방지 가드 절 존재 강제 (harness#104 — positive,
    // docs-mcp-mention-required 와 같은 방식). 대상 skill(현재 design)에서만
    // 절 자체와 최소 필수 내용이 사라지지 않았는지 본다 — 실제 생성물(사용자
    // 프로젝트 화면)이 원칙을 지키는지는 이 스크립트가 검사할 수 없다.
    if (BRAND_GUARD_REQUIRED_SKILLS.has(skillName)) {
      // =====================================================================
      // 이 검사기가 보장하는 것 / 보장하지 못하는 것 (harness#137)
      // ---------------------------------------------------------------------
      // 아래 A2/brand-guard-* 는 전부 **회귀 탐지(regression detection)**다.
      // 집행(enforcement)이 아니다. 구별이 중요하다:
      //
      //   - 탐지하는 것: 브랜드 관문을 구성하는 **텍스트 구조**가 문서에서
      //     사라지거나, 관문보다 앞에 산출 지시가 새로 생기거나, 관문 절의
      //     경계가 넓어져 인접 절의 낱말을 빌려오는 형태의 **문서 변경**.
      //     요컨대 "누가 편집하다 관문을 조용히 없앴다"를 CI 에서 잡는다.
      //
      //   - 보장하지 **못하는** 것 (알려진 미탐 — 시도하지 않는다):
      //       (1) **의미 반전**. 세 결정 항목의 뜻을 뒤집어도(예: "예외로
      //           인정한다" / "멈추지 않는다" / "사후 고지한다") 낱말은
      //           그대로라 통과한다. 부분 문자열·구조 검사는 극성을
      //           구별할 수 없다.
      //       (2) **인용 문맥**. 필수 문구를 그 뜻을 부정하는 인용 안에만
      //           남겨도(예: "예전 문서에는 '…'라는 표현이 있었으나 지금은
      //           안 쓴다") 통과한다. 이 검사기는 진짜 지시와 인용된 지시를
      //           구별할 수 없다.
      //       (3) **키워드 우연 충족** (harness#137 3회차 S2). 세 결정
      //           항목을 통째로 지우고, 남은 산문이 우연히 갖고 있는
      //           `예외`·`중단`·`알리`만으로 CHECKPOINT_REQUIRED_CONTENT 를
      //           만족시키는 형태. 필수 요소를 "낱말 존재"로 재는 한 낱말을
      //           남기는 방법은 항상 있고, 낱말 대신 문장 구조를 요구하면
      //           정직한 리라이팅이 먼저 깨진다.
      //       (4) **문단 쪼개기** (harness#137 3회차 S5-splitting). 하나의
      //           산출 지시를 두 문단에 나눠 써서 asset-before-checkpoint 의
      //           3조건 AND 가 어느 한 문단에서도 동시에 성립하지 않게 만드는
      //           형태(도구 토큰만 있는 문단 + 지시 동사만 있는 문단).
      //           스코프를 문단 밖으로 넓히면 문서 전체가 한 덩어리가 되어
      //           금지 목록 자체가 자기 자신에게 걸린다.
      //       (5) **heading 부정어 라벨 데코** (harness#137 5회차 F1). 부정
      //           heading 면제(BRAND_GUARD_HEADING_MANDATORY_ADJACENT_RE)가
      //           heading **단위** 불리언이라, "생략 불가" 처럼 강조어와
      //           인접한 부정어 쌍 하나만 있으면 같은 heading 안의 **다른**
      //           진짜 부정어("아니다" 등)까지 함께 면제된다(예: "### 0.
      //           브랜드 체크포인트가 아니다 — 생략 불가"). 트리거별로 개별
      //           면제를 강제하면 "생략하지 않는다" 류의 정직한 heading 을
      //           새로 벌하는 오탐이 생겨 여기서는 닫지 않는다.
      //     이 다섯은 텍스트 lint 로 닫을 수 있는 종류의 구멍이 아니다.
      //     정규식을 더 얹어도 우회 문장이 하나 더 생길 뿐이고, 그 과정에서
      //     정직한 리라이팅을 벌하는 오탐만 늘어난다. **오탐이 미탐보다
      //     해롭다** — 실제 위협 모델은 적대적 편집자가 아니라 skill 을
      //     고쳐 쓰다 관문을 조용히 떨어뜨리는 선의의 저자이고, 자연스러운
      //     편집을 거부하는 lint 는 그 저자에게 검사를 우회하는 법을 가르친다.
      //
      //   - 그래서 실제 **에이전트 행동의 집행**은 여기가 아니라 런타임
      //     훅의 몫이다 — 산출 도구(Write/Edit/Bash) 호출 시점에 관문 통과
      //     여부를 확인하는 PreToolUse 계층. 텍스트 lint 는 그 훅을 대체할
      //     수 없고, 이 파일은 그런 척하지 않는다.
      //
      // 위치 판정은 전부 **문자 오프셋**으로 한다 — "지금 어느 heading 절
      // 안인가"로 판단하면 절 밖(우회 #1b)이나 heading 아닌 산문(우회 #1)에
      // 심은 지시문이 스캔 범위에서 통째로 빠진다.
      // =====================================================================

      // HTML 주석을 제거한(줄 수는 보존) 버전 — 아래 브랜드 가드 검사는 전부
      // 이걸 쓴다(원본 bodyLines 를 직접 쓰지 않는다). 이유는
      // stripHtmlComments 주석 참조(harness#137 1회차 우회 #1·#2). 줄 번호
      // 계산은 srcLines.indexOf(...) 대신 frontmatter 오프셋을 쓴다 — 클린
      // 텍스트가 원본과 달라지면 indexOf 매칭이 깨지기 때문(seam 검사가 이미
      // 쓰는 fmOffset 패턴과 동일).
      const cleanBodyLines = stripHtmlComments(body).split('\n');
      const cleanLineOffsets = lineStartOffsets(cleanBodyLines);
      const fmOffset = srcLines.length - bodyLines.length;

      // heading **탐색**(존재/판정 여부) 전용 뷰 — fenced code block 안의 줄은
      // 빈 줄로 지운다(harness#137 4회차 F-b). quality-bar.md 쪽 G0 스캔은
      // 처음부터 `blankFencedLines`를 거친 텍스트 위에서 돌았는데(우회 S6
      // 대응), SKILL.md 쪽의 heading 탐색(headingIdx·체크포인트 LOOSE/STRICT·
      // execOrderIdx·firstSubheadingIdx)은 raw `cleanBodyLines` 를 그대로
      // 읽어서 그 대칭이 깨져 있었다 — fenced 블록 안에 가짜 heading 을 심어
      // 구조 검사를 속이는 데코이 우회와, fenced 블록 안의 실제 heading 텍스트
      // 예시(예: 인용된 `### 0. …` 설명 블록)를 절 경계로 오인하는 오탐(GF5)을
      // 동시에 닫는다. **줄 수는 보존**하므로 여기서 찾은 인덱스는 그대로
      // `cleanBodyLines`(원문 보존 뷰)에 대응한다 — 내용 추출(sectionText·
      // checkpointText 등)은 계속 `cleanBodyLines` 를 쓴다.
      const headingScanLines = blankFencedLines(cleanBodyLines);

      const headingIdx = headingScanLines.findIndex((l) => l.trim() === BRAND_GUARD_HEADING);
      // 선언 절의 범위 — 아래 asset-before-checkpoint 산문 검사가 이 범위를
      // 건너뛴다(사유는 그 자리 주석).
      let guardSectionEnd = -1;
      if (headingIdx === -1) {
        violations.push(
          mkv(
            relFile,
            1,
            'A2/brand-guard-section-missing',
            `'${BRAND_GUARD_HEADING}' 절이 없음 — harness#104: 토스 브랜드·UI 모방 방지 가드는 이 skill에 명시돼 있어야 한다 (fix: 절을 복원하고 금지 목록 + 대안 + 위반 시 절차를 포함)`,
          ),
        );
      } else {
        // 다음 H2 heading 전까지를 절 본문으로 본다.
        let sectionEnd = cleanBodyLines.length;
        for (let j = headingIdx + 1; j < cleanBodyLines.length; j++) {
          if (headingScanLines[j].startsWith('## ')) {
            sectionEnd = j;
            break;
          }
        }
        guardSectionEnd = sectionEnd;
        const sectionText = cleanBodyLines.slice(headingIdx, sectionEnd).join('\n');
        for (const [re, msg] of BRAND_GUARD_REQUIRED_CONTENT) {
          if (!re.test(sectionText)) {
            violations.push(
              mkv(
                relFile,
                fmOffset + headingIdx + 1,
                'A2/brand-guard-content-incomplete',
                `'${BRAND_GUARD_HEADING}' 절 내용 불완전: ${msg} (harness#104 AC — 금지 목록 + 대안 + 위반 시 절차 모두 명시 필요)`,
              ),
            );
          }
        }
      }

      // --- 체크포인트(0단계) heading 판정 ---
      // 모양(LOOSE)으로 후보를 모으고, 뜻이 부정인 heading 은 수락하지 않는다.
      // 수락은 STRICT 로만 한다. 조용히 무시하지 않고 negated 를 따로
      // 보고하는 이유는 진단 가능성이다 — "왜 절이 없다고 하지?" 를 없앤다.
      /** @type {number[]} */
      const negatedHeadingIdxs = [];
      /** @type {number[]} */
      const looseOnlyHeadingIdxs = [];
      let checkpointIdx = -1;
      for (let i = 0; i < headingScanLines.length; i++) {
        const headingLine = headingScanLines[i].trim();
        if (!BRAND_GUARD_CHECKPOINT_HEADING_LOOSE_RE.test(headingLine)) continue;
        if (
          BRAND_GUARD_HEADING_NEGATION_RE.test(headingLine) &&
          !BRAND_GUARD_HEADING_MANDATORY_ADJACENT_RE.test(headingLine)
        ) {
          negatedHeadingIdxs.push(i);
          continue;
        }
        if (!BRAND_GUARD_CHECKPOINT_HEADING_RE.test(headingLine)) {
          // 모양은 체크포인트인데 STRICT 를 못 넘긴 heading. **조용히 넘기지
          // 않는다** (harness#137 3회차 오탐 #6) — 종전에는 여기서 그냥
          // continue 라, 저자는 "절이 없음(파일 1행)" 이라는, 어느 줄이
          // 문제인지도 안 알려주는 오류만 받았다. 위 negated 를 따로 보고하는
          // 이유(진단 가능성)와 같은 이유로 이 경우도 보고한다.
          looseOnlyHeadingIdxs.push(i);
          continue;
        }
        if (checkpointIdx === -1) checkpointIdx = i;
      }
      for (const idx of negatedHeadingIdxs) {
        violations.push(
          mkv(
            relFile,
            fmOffset + idx + 1,
            'A2/brand-guard-checkpoint-heading-negated',
            `'브랜드 체크포인트'처럼 생겼지만 뜻이 부정인 heading 은 0단계 관문으로 인정하지 않는다: '${cleanBodyLines[idx].trim()}' — harness#137: 부정형 heading("…가 아니다"/"제외"/"취소")을 수락하면 "이건 관문이 아니다"라고 명시한 절이 관문 자리를 차지한다 (fix: heading 에서 부정어를 빼라. 의무를 강조하려는 것이면 "생략 불가"·"제외 없음"처럼 부정어 **바로 뒤에** 붙는 형태로 써라 — heading 아무 데나 '필수'를 끼워 넣는 것으로는 면제되지 않는다)`,
          ),
        );
      }
      if (checkpointIdx === -1) {
        for (const idx of looseOnlyHeadingIdxs) {
          violations.push(
            mkv(
              relFile,
              fmOffset + idx + 1,
              'A2/brand-guard-checkpoint-heading-unrecognized',
              `'브랜드 체크포인트'처럼 보이지만 0단계 관문 heading 형식이 아니어서 수락하지 않았다: '${cleanBodyLines[idx].trim()}' — harness#137: 수락 형식은 '### 0' + (선택)하이픈/공백 + (선택)'단계'/'번째' + (선택)구분자(. ) : · — ) + '브랜드 체크포인트' 다. 번호와 '브랜드 체크포인트' 사이에 다른 낱말이 끼면 다른 절과 구별할 수 없다 (fix: '### 0. 브랜드 체크포인트 …' / '### 0단계 · 브랜드 체크포인트 …' / '### 0-단계 브랜드 체크포인트 …' 형태로 되돌려라)`,
            ),
          );
        }
      }
      if (checkpointIdx === -1) {
        violations.push(
          mkv(
            relFile,
            1,
            'A2/brand-guard-checkpoint-missing',
            `'### 0. 브랜드 체크포인트' 절이 없음 — harness#137: "토스 브랜드·UI 모방 금지" 절은 금지 목록을 선언할 뿐이고, 에이전트가 산출 도구 호출 전에 멈추게 하는 지침은 "실행 순서" 0단계다 (fix: 산출 도구 호출 전 판정 절차 + 차단 시 알림 절차를 담은 0단계를 복원하라)`,
          ),
        );
      } else {
        // --- 절의 끝 경계 산정 ---
        // 종전에는 "다음 '## '/'### ' 토큰"만 봤다. 그래서 다음 단계 heading 을
        // **굵게**로 강등하면 경계가 사라지고, 체크포인트 절이 인접 절까지
        // 삼켜 **인접 절의 낱말을 자기 요건 충족에 빌려 쓸 수** 있었다
        // (harness#137 2회차 우회 #4). 경계는 둘이다:
        //   (1) 체크포인트 heading 과 **같거나 얕은 레벨**의 진짜 heading.
        //       더 깊은 레벨(`#### `)은 경계가 **아니다** — 절 안에 소제목을
        //       다는 것은 정상 편집인데 종전에는 그 순간 절이 잘려 "내용이
        //       전부 없다"는 4건이 한꺼번에 났다(3회차 오탐 #2).
        //   (2) 강등된 단계 라벨 — 한 문단을 통째로 차지하는 `**N. …**`.
        // 줄 수 상한은 경계가 아니라 **경계 부재를 재는 보조 지표**로만 쓴다
        // (상수 주석 참조).
        const cleanFenced = fencedCodeLineNumbers(cleanBodyLines);
        const checkpointLevel = (cleanBodyLines[checkpointIdx].match(/^\s*(#{1,6})/) ?? [
          '',
          '###',
        ])[1].length;
        let checkpointEnd = cleanBodyLines.length;
        /** @type {string | null} */
        let boundaryLine = null;
        // 경계가 **진짜 heading** 인지(vs 강등 라벨)도 함께 기록한다 —
        // 아래 상한 판정(harness#137 4회차 F-c)이 이걸로 위조 번호 라벨을
        // 구별한다.
        let boundaryIsHeading = false;
        for (let j = checkpointIdx + 1; j < cleanBodyLines.length; j++) {
          if (cleanFenced.has(j + 1)) continue; // 코드펜스 안의 '### ' 은 heading 이 아니다
          const hm = cleanBodyLines[j].match(/^(#{1,6})\s/);
          const isHeading = hm !== null && hm[1].length <= checkpointLevel;
          const isDemotedStep =
            BRAND_GUARD_DEMOTED_STEP_RE.test(cleanBodyLines[j].trim()) &&
            (cleanBodyLines[j - 1] ?? '').trim() === '' &&
            (cleanBodyLines[j + 1] ?? '').trim() === '';
          if (isHeading || isDemotedStep) {
            checkpointEnd = j;
            boundaryLine = cleanBodyLines[j];
            boundaryIsHeading = isHeading;
            break;
          }
        }
        const checkpointText = cleanBodyLines.slice(checkpointIdx, checkpointEnd).join('\n');
        const checkpointHeadingLine = fmOffset + checkpointIdx + 1;
        const checkpointSpan = checkpointEnd - checkpointIdx;
        const boundaryStep = boundaryLine === null ? null : stepLabelNumber(boundaryLine);
        const checkpointStep = stepLabelNumber(cleanBodyLines[checkpointIdx]) ?? 0;
        // 경계가 상한 검사를 면제받으려면 **진짜 heading**이면서 번호가
        // 정확히 "다음 단계"여야 한다 — 강등된 굵은 라벨(`**1. …**`)은
        // 번호를 정확히 위조해도 면제받지 못한다(harness#137 4회차 F-c 아래
        // 참조).
        const boundaryIsGenuineNextStep = boundaryIsHeading && boundaryStep === checkpointStep + 1;

        if (boundaryLine === null) {
          // (S1(a)) 경계가 문서 끝까지 하나도 없다. 종전 코드는 이 경우
          // `boundedByCap = capIdx < lines.length` 때문에 **아무 오류도 내지
          // 않았다** — 체크포인트를 한 줄로 비우고 그 뒤를 통째로 지우면
          // 0 error 였다는 뜻이다(실측). 상한과 무관하게 위반으로 본다.
          violations.push(
            mkv(
              relFile,
              checkpointHeadingLine,
              'A2/brand-guard-checkpoint-unbounded',
              `'0. 브랜드 체크포인트' 절의 끝 경계를 문서 끝까지 찾지 못함 — 뒤따르는 단계 heading 이 전부 사라졌거나 강등된 것으로 보인다 (harness#137: 경계가 없으면 절이 문서 끝까지 늘어나 인접 절의 낱말을 요건 충족에 빌려 쓴다. 파일이 체크포인트로 끝나는 형태도 여기 해당한다 — 관문 다음에 와야 할 단계가 통째로 없다는 뜻이다. fix: 다음 단계를 '### ' heading 으로 되돌려라)`,
            ),
          );
        } else if (boundaryStep !== null && boundaryStep > checkpointStep + 1) {
          // (S1(b)) 경계는 있는데 그 라벨이 "다음 단계"가 아니라 그 너머다.
          // 곧 사이의 단계 heading 이 지워졌거나 번호 없는 굵은 라벨로
          // 강등돼 그 본문이 체크포인트 절에 삼켜졌다는 신호다 — 삼켜진
          // 본문의 낱말이 체크포인트 요건 충족에 그대로 빌려 쓰인다.
          // 줄 수 상한과 달리 이 신호는 절이 **짧을 때도** 발화한다.
          violations.push(
            mkv(
              relFile,
              checkpointHeadingLine,
              'A2/brand-guard-checkpoint-swallows-step',
              `'0. 브랜드 체크포인트' 절이 다음 단계(${checkpointStep + 1}단계)를 삼킴 — 절이 '${boundaryLine.trim()}' 에서야 끝난다. ${checkpointStep + 1}단계의 라벨이 사라졌거나 번호 없는 굵은 글씨로 강등된 것으로 보인다 (harness#137: 그러면 그 단계의 본문이 체크포인트 절로 읽혀 '예외'·'중단'·'알림'·물음표 블록 같은 요건이 인접 절에서 빌려 쓰인다. fix: ${checkpointStep + 1}단계를 '### ${checkpointStep + 1}. …' heading 으로 되돌려라)`,
            ),
          );
        } else if (
          checkpointSpan > BRAND_GUARD_CHECKPOINT_MAX_LINES &&
          !boundaryIsGenuineNextStep
        ) {
          // 경계가 "진짜 heading + 정확히 다음 단계 번호"가 아니고 절이
          // 상한보다 길다. 이때만 줄 수 상한을 쓴다 — 경계가 정상 단계
          // heading 이면 절이 아무리 길어도 발화하지 않는다(3회차 오탐 #8:
          // 결정 항목·예시를 덧붙인 정직한 증보를 "사라진 heading 을
          // 되돌려라"라는 엉뚱한 문구로 벌하던 회귀).
          //
          // **종전에는 `boundaryStep === null` 일 때만 상한을 적용했다**
          // (harness#137 4회차 F-c) — 그래서 경계에 **강등된 굵은 라벨**
          // (`**1. …**`)을 두고 번호만 정확히 "다음 단계"로 위조하면
          // swallow 검사(위 분기, 번호가 checkpointStep+1 이라 통과)와
          // 상한(boundaryStep!==null 이라 skip) 둘 다 조용해졌다 — 그
          // 사이에 삼켜진 내용이 아무리 길어도 잡히지 않았다는 뜻이다.
          // 지금은 "정말 다음 단계 heading 이 제자리에 있다"는 확인을
          // **진짜 heading** 여부까지 요구한다 — 강등 라벨은 번호를 아무리
          // 정확히 흉내내도 이 확인을 통과하지 못하므로, 길면 여전히
          // 상한에 걸린다.
          violations.push(
            mkv(
              relFile,
              checkpointHeadingLine,
              'A2/brand-guard-checkpoint-unbounded',
              `'0. 브랜드 체크포인트' 절이 ${BRAND_GUARD_CHECKPOINT_MAX_LINES}줄이 넘도록 다음 **단계** 없이 이어지다 '${boundaryLine.trim()}' 에서 끝남 — 다음 단계의 heading 이 사라졌거나 강등된 것으로 보인다 (harness#137: 절의 끝 경계가 없으면 인접 절의 낱말이 체크포인트 요건 충족에 빌려 쓰인다. fix: 다음 단계를 '### 1. …' heading 으로 되돌려라. 0단계 자체를 늘린 것이라면 다음 단계 heading 이 제자리에 있는지부터 확인하라 — 제자리면 길이는 문제가 아니다)`,
            ),
          );
        }
        for (const [re, msg] of BRAND_GUARD_CHECKPOINT_REQUIRED_CONTENT) {
          if (!re.test(checkpointText)) {
            violations.push(
              mkv(
                relFile,
                checkpointHeadingLine,
                'A2/brand-guard-checkpoint-incomplete',
                `'0. 브랜드 체크포인트' 절 내용 불완전: ${msg} (harness#137 AC — 사용자 명시 요청도 예외가 아님 + 산출 전 중단 + 사용자 고지를 모두 명시 필요)`,
              ),
            );
          }
        }
        // 차단 메시지 "템플릿" — 걸렸을 때 사용자에게 그대로 보여줄 인쇄 블록.
        // 산문으로 절차만 설명하고 실제 템플릿(fenced 블록)이 빠지는 회귀를
        // 별도로 잡는다(내용 키워드 검사와 직교). cleanBodyLines 기준으로
        // 펜스를 찾으므로 주석 안에 숨긴 가짜 펜스는 카운트되지 않는다.
        const checkpointBlocks = fencedBlockRanges(cleanBodyLines).filter(
          (b) => b.fenceIdx >= checkpointIdx && b.fenceIdx < checkpointEnd,
        );
        if (checkpointBlocks.length === 0) {
          violations.push(
            mkv(
              relFile,
              checkpointHeadingLine,
              'A2/brand-guard-checkpoint-incomplete',
              `'0. 브랜드 체크포인트' 절에 차단 메시지 템플릿(fenced 블록)이 없음 (harness#137 AC — 걸렸을 때 사용자에게 그대로 보여줄 인쇄 블록 필요)`,
            ),
          );
        } else {
          // 블록이 있다는 사실만으로는 부족하다 — 무관한 블록(예:
          // ```bash\necho "ok"\n```)만 남겨도 "블록 존재" 검사는 통과했다
          // (harness#137 1회차 우회 #3). 다만 요건은 **리터럴 문구가 아니라
          // 구조**다: 비실행 텍스트 블록 + 물음표로 끝나는 줄 = "사용자에게
          // 답을 요구하는 질문". 이 요건은 문장을 어떻게 다시 써도 유지되므로
          // 정직한 카피 편집을 벌하지 않는다(2회차 오탐 #7).
          const asksUserQuestion = checkpointBlocks.some((b) => {
            if (
              !BRAND_GUARD_TEMPLATE_INERT_INFO_RE.test(
                stripFenceQuotePrefix(cleanBodyLines[b.fenceIdx]),
              )
            )
              return false;
            return cleanBodyLines
              .slice(b.start, b.end)
              .some(
                (l) =>
                  BRAND_GUARD_TEMPLATE_QUESTION_RE.test(l) &&
                  !BRAND_GUARD_TEMPLATE_NON_QUESTION_LINE_RE.test(l),
              );
          });
          if (!asksUserQuestion) {
            violations.push(
              mkv(
                relFile,
                checkpointHeadingLine,
                'A2/brand-guard-checkpoint-incomplete',
                `'0. 브랜드 체크포인트' 절의 fenced 블록이 사용자에게 질문을 던지지 않음 — 실제 차단 메시지 템플릿이 아니라 무관한 코드펜스로 보인다 (harness#137 AC — 요건은 특정 문구가 아니라 구조다: 실행 코드로 태그되지 않은 인쇄 블록 안에 물음표로 끝나는 줄이 최소 1개. 문장은 자유롭게 고쳐 써도 된다)`,
              ),
            );
          }
        }

        // 체크포인트가 "실행 순서"의 첫 하위 단계인지 검사 (harness#137
        // 적대 검증 우회 #4) — heading 존재만 보면 0단계 절을 파일 뒤쪽
        // (예: 3단계 자산 생성 단계보다 뒤)으로 옮겨도 통과했다. 관문은
        // 도구 호출(1단계 이후)보다 앞에 와야 한다는 보장이 필요하므로,
        // BRAND_GUARD_EXEC_ORDER_HEADING 바로 다음에 오는 첫 "### " heading이
        // 체크포인트 절이어야 한다.
        const execOrderIdx = headingScanLines.findIndex((l) =>
          BRAND_GUARD_EXEC_ORDER_HEADING_RE.test(l.trim()),
        );
        if (execOrderIdx === -1) {
          // '## 실행 순서' heading 자체를 찾을 수 없다 — 다른 8개 skill이
          // 전부 이 정확한 문자열을 쓰는 것으로 실측 확인했다(grep). 이
          // heading이 없어지면(rename 포함) 위치 검사의 기준점이 사라지므로,
          // 조용히 skip 하지 않고 그 사실 자체를 위반으로 보고한다 —
          // 부재를 "검사 대상 아님"으로 조용히 넘기면 rename 을 통한 우회
          // 경로가 새로 열린다.
          violations.push(
            mkv(
              relFile,
              1,
              'A2/brand-guard-checkpoint-not-first',
              `'${BRAND_GUARD_EXEC_ORDER_HEADING}' heading을 찾을 수 없어 체크포인트가 실행 순서의 첫 단계인지 확인할 수 없음 — harness#137: 이 heading이 없어지면 위치 검사 자체가 무력화되므로 부재를 통과로 보지 않는다 (fix: '${BRAND_GUARD_EXEC_ORDER_HEADING}' heading을 유지하고 그 바로 다음 '### ' 절이 0단계여야 한다)`,
            ),
          );
        } else {
          const firstSubheadingIdx = headingScanLines.findIndex(
            (l, i) => i > execOrderIdx && l.startsWith('### '),
          );
          if (firstSubheadingIdx !== checkpointIdx) {
            violations.push(
              mkv(
                relFile,
                checkpointHeadingLine,
                'A2/brand-guard-checkpoint-not-first',
                `'0. 브랜드 체크포인트' 절이 '${BRAND_GUARD_EXEC_ORDER_HEADING}'의 첫 하위 단계가 아님 — harness#137: 관문은 산출 도구를 호출하는 단계보다 앞에 와야 한다. 절이 파일 뒤쪽(예: 자산 생성 단계 뒤)으로 밀리면 다른 단계가 먼저 실행돼 관문을 우회한다 (fix: 0단계를 '${BRAND_GUARD_EXEC_ORDER_HEADING}' 바로 다음 '### ' 절로 되돌려라)`,
              ),
            );
          }
        }

        // --- 문서 전체 스캔: 관문이 끝나기 전의 산출 지시문 (우회 #1·#1b) ---
        // 위 not-first 검사는 "'## 실행 순서' 안에서 heading 순서"만 본다.
        // 그래서 (a) '### 0.' heading **앞**의 heading 아닌 산문(우회 #1)과
        // (b) '## 실행 순서' **앞**에 새로 만든 H2 절(우회 #1b)이 스캔 범위
        // 밖이었다 — 둘 다 자산을 먼저 만들라고 지시하면서 CI 는 초록이었다.
        // 여기서는 heading 절 대신 **문서 전체를 문자 오프셋으로** 훑는다:
        // 체크포인트 절이 끝나는 오프셋보다 앞이면 어디에 있든 위반이다.
        const cutoffOffset = cleanLineOffsets[checkpointEnd];

        // (a) 구조 신호 — 파일을 만드는 명령이 든 인쇄 블록. 인용 접두는
        // 지우고 검사한다(harness#137 4회차 F-a) — `ASSET_CREATING_CMD_RE`
        // 의 명령 판정이 줄 시작(`^\s*mkdir` 등) 앵커라 `> mkdir …` 처럼
        // 인용된 내용 줄은 접두를 지우지 않으면 "명령 아님"으로 읽힌다.
        for (const block of fencedBlockRanges(cleanBodyLines)) {
          if (cleanLineOffsets[block.fenceIdx] >= cutoffOffset) continue;
          const blockText = cleanBodyLines
            .slice(block.start, block.end)
            .map(stripFenceQuotePrefix)
            .join('\n');
          if (!ASSET_CREATING_CMD_RE.test(blockText)) continue;
          violations.push(
            mkv(
              relFile,
              fmOffset + block.fenceIdx + 1,
              'A2/brand-guard-asset-before-checkpoint',
              `브랜드 체크포인트(0단계)가 끝나기 전에 파일을 만드는 명령 블록이 있음 — harness#137: 관문은 산출보다 앞에 와야 하는데, 이 블록은 관문 앞(문자 오프셋 기준)에 있다 (fix: 파일을 만드는 명령은 0단계 이후 단계로 옮겨라)`,
            ),
          );
        }

        // (c) 구조 신호 — fence 없이 **인라인 코드 span** 만으로 나열된 파일
        // 생성 명령(harness#137 5회차 F1). "## 사전 준비" 같은 새 절을 만들고
        // 불릿마다 인라인 코드로 명령을 적으면 (a)의 fenced 블록 검사를
        // 피해 간다. `headingScanLines`(= 코드펜스를 비운 뷰)에서 체크포인트
        // 앞(i < checkpointIdx) 줄만 훑는다 — 체크포인트 절 자체는 상한으로
        // 자동 제외되고, 선언 절([headingIdx, guardSectionEnd))도 (b)와 같은
        // 이유로 별도 제외한다.
        for (let i = 0; i < checkpointIdx; i++) {
          if (headingIdx !== -1 && i >= headingIdx && i < guardSectionEnd) continue;
          const line = headingScanLines[i];
          // 같은 줄에 금지 마커(`말고`/`않는다`/`금지` 등)가 있으면 이 줄
          // 전체를 금지 문맥으로 본다 — (b) 산문 검사의 문장 스코핑과 달리
          // 인라인 명령엔 "지시 동사"가 없어 문장 내 상대 위치를 잴 수 없다.
          // 줄 단위로 넓게 면제하는 대신, 이 면제로 놓치는 사례는 여전히
          // (b) 산문 검사·G0 채점의 몫으로 남는다(harness#137 5회차 F1).
          if (ASSET_PROHIBITION_RE.test(line)) continue;
          for (const m of line.matchAll(/`([^`\n]+)`/g)) {
            if (!ASSET_CREATING_INLINE_CMD_RE.test(m[1])) continue;
            violations.push(
              mkv(
                relFile,
                fmOffset + i + 1,
                'A2/brand-guard-asset-before-checkpoint',
                `브랜드 체크포인트(0단계)가 끝나기 전에 파일을 만드는 인라인 명령이 있음 — harness#137: fence 없이 인라인 코드로만 나열해도 관문보다 앞이면 위반이다 (fix: 산출 명령은 0단계 이후 단계로 옮겨라)`,
              ),
            );
          }
        }

        // (b) 산문 지시문 — 문단 단위. 도구 토큰 + 평서 종결형 생성 지시가
        //     함께 있고, 그 지시가 **금지 문맥에 놓이지 않았을** 때만 지시문
        //     으로 본다(3조건 AND). 금지 목록·관문 선언이 자기 자신에게
        //     걸리지 않게 하려는 것이고, 세 축의 근거는 각 상수 주석 참조.
        //
        //     **'## 토스 브랜드·UI 모방 금지' 선언 절은 이 산문 검사에서
        //     제외한다** (harness#137 3회차 오탐 #3). 그 절은 실행 순서의
        //     단계가 아니라 정책 선언이고, 금지 항목과 그 **대안**을 설명하는
        //     것이 존재 이유라 도구 이름과 생성 동사가 함께 나오는 것이
        //     정상이다. 실측 오탐: 대안 문단에 "`magick … xc:#6B7280 …` 처럼
        //     중립 회색으로 플레이스홀더를 만든다" 는 가드를 **강화하는**
        //     예시를 덧붙였더니 asset-before-checkpoint 가 났다 — 가드가
        //     자기를 강화하는 문장을 거부하는 것은 이 검사기가 낼 수 있는
        //     최악의 신호다.
        //     **잃는 보호**: 이 절 안에 심은 산문 산출 지시는 못 잡는다.
        //     대신 (a) 인쇄 명령 블록 검사는 이 절에도 그대로 적용되고,
        //     절 자체는 A2/brand-guard-content-incomplete 가 필수 내용을
        //     계속 강제한다. 위협 모델이 적대적 편집자가 아니라 선의의
        //     저자라는 전제에서 받아들인 교환이다.
        for (const para of paragraphRanges(cleanBodyLines)) {
          if (cleanLineOffsets[para.start] >= cutoffOffset) continue;
          if (headingIdx !== -1 && para.start >= headingIdx && para.start < guardSectionEnd) {
            continue;
          }
          const paraText = cleanBodyLines.slice(para.start, para.end).join('\n');
          if (!ASSET_TOOL_TOKEN_RE.test(paraText)) continue;
          if (!hasUnguardedAssetImperative(paraText)) continue;
          violations.push(
            mkv(
              relFile,
              fmOffset + para.start + 1,
              'A2/brand-guard-asset-before-checkpoint',
              `브랜드 체크포인트(0단계)가 끝나기 전에 자산·코드를 만들라는 지시문이 있음 — harness#137: heading 절이 아니라 문서 전체를 문자 오프셋으로 보므로, '## 실행 순서' 앞의 다른 절이든 heading 아닌 산문이든 관문보다 앞이면 위반이다 (fix: 산출 지시는 0단계 이후로 옮겨라)`,
            ),
          );
        }
      }

      // quality-bar.md 의 G0(브랜드·IP 안전) 절 존재 강제 (harness#137) —
      // SKILL.md 밖 별도 파일이라 body 텍스트 검사와 무관하게 파일을 직접 읽는다.
      {
        const qualityBarPath = path.join(path.dirname(skillFile), 'references', 'quality-bar.md');
        const relQualityBar = path.relative(root, qualityBarPath);
        if (!fs.existsSync(qualityBarPath)) {
          violations.push(
            mkv(
              relQualityBar,
              1,
              'A2/brand-guard-quality-bar-incomplete',
              `references/quality-bar.md 파일이 없음 — harness#137: G0(브랜드·IP 안전) 판정 기준이 사라지면 산출물 채점 관문(2-C)이 무력화된다 (fix: G0 절 + G0-1~G0-5 5항목을 복원하라)`,
            ),
          );
        } else {
          const qbSrc = readFile(qualityBarPath);
          // 여기도 HTML 주석 제거 텍스트로 검사한다(위 cleanBodyLines 와
          // 같은 이유 — stripHtmlComments 주석 참조). **fenced 블록도 함께
          // 비운다** (harness#137 3회차 우회 S6): SKILL.md 쪽 검사는 처음부터
          // 주석을 지우고 fence 를 구분했는데 quality-bar 스캔만 둘 다 안 해서,
          // 진짜 G0 절을 지우고 ```markdown "폐지된 절 (참고용)" 블록 안에
          // `## G0` + G0-1~G0-5 를 남겨 두기만 해도 통과했다(실측 0 error).
          // 인쇄용 예시 블록은 판정 기준이 아니다.
          const qbLines = blankFencedLines(stripHtmlComments(qbSrc).split('\n'));
          const g0Idx = qbLines.findIndex((l) => QUALITY_BAR_G0_HEADING_RE.test(l.trim()));
          if (g0Idx === -1) {
            violations.push(
              mkv(
                relQualityBar,
                1,
                'A2/brand-guard-quality-bar-incomplete',
                `'G0' 절이 없음 — harness#137: 산출물을 브랜드·IP 안전 기준으로 채점하는 두 번째 관문이 사라졌다 (heading 레벨은 자유다 — '## G0' 도 '### G0' 도 받는다. 코드펜스·HTML 주석 안의 G0 은 인쇄용 예시로 보고 세지 않는다) (fix: G0 절 + G0-1~G0-5 5항목을 복원하라)`,
              ),
            );
          } else {
            // 절의 끝은 **같거나 얕은 레벨**의 heading 이다 — G0~G6 를
            // '## 그룹별 판정 항목' 아래 '###' 로 묶는 재구성(3회차 오탐 #7)을
            // 수용하려면 레벨을 고정하면 안 된다.
            const g0Level = (qbLines[g0Idx].trim().match(QUALITY_BAR_G0_HEADING_RE) ?? [
              '',
              '##',
            ])[1].length;
            let g0End = qbLines.length;
            for (let j = g0Idx + 1; j < qbLines.length; j++) {
              const hm = qbLines[j].match(/^(#{1,6})\s/);
              if (hm !== null && hm[1].length <= g0Level) {
                g0End = j;
                break;
              }
            }
            const g0Text = qbLines.slice(g0Idx, g0End).join('\n');
            for (const item of QUALITY_BAR_G0_REQUIRED_ITEMS) {
              if (!g0Text.includes(item)) {
                violations.push(
                  mkv(
                    relQualityBar,
                    g0Idx + 1,
                    'A2/brand-guard-quality-bar-incomplete',
                    `'G0' 절에 '${item}' 항목이 없음 (harness#137 AC — G0-1~G0-5 5항목 모두 필요. 코드펜스 안의 항목은 인쇄용 예시로 보고 세지 않는다)`,
                  ),
                );
              }
            }
          }
        }
      }
    }

    // N1/N2/N3 — design skill 전용 판정·렌더 자산 가드. quality-bar.md 차단
    // 그룹 3자 정합성(N1), render-rules.md 의 1층 10항목 완전성(N2),
    // assets/project/icons/ 6종의 유효성(N3)을 검사한다. 셋 다
    // BRAND_GUARD_REQUIRED_SKILLS 와 대상이 같지만(현재 design 하나), 검사
    // 내용이 브랜드 가드와 직교하므로 별도 블록으로 둔다.
    if (skillName === 'design') {
      const skillDir = path.dirname(skillFile);

      // N1 — quality-bar.md 차단 그룹 3자 대조(상수 ↔ 규칙 2 부기 줄 ↔ 등급 열)
      {
        const qbPath = path.join(skillDir, 'references', 'quality-bar.md');
        const relQb = path.relative(root, qbPath);
        const constantSet = new Set(QUALITY_BAR_BLOCKING_GROUPS);
        if (!fs.existsSync(qbPath)) {
          violations.push(
            mkv(
              relQb,
              1,
              'A2/quality-bar-blocking-groups-mismatch',
              `references/quality-bar.md 파일이 없음 — 차단 등급 항목의 정본이 사라지면 "차단이 남으면 완료가 아니다" 규칙이 대상을 잃는다 (fix: 등급 열을 가진 quality-bar.md 를 복원하라. 차단 그룹은 ${QUALITY_BAR_BLOCKING_GROUPS.join('·')})`,
            ),
          );
        } else {
          // G0 스캔과 같은 헬퍼를 재사용한다 — 코드펜스 안에 "폐지된 절"을
          // 남겨 두는 위장(harness#137 3회차 우회 S6 와 같은 수법)으로 부기
          // 줄·등급 표를 대신하지 못하게 한다.
          const qbLines = blankFencedLines(stripHtmlComments(readFile(qbPath)).split('\n'));

          // ② 완료 판정 규칙 2 의 부기 줄
          const ruleIdx = qbLines.findIndex((l) => QUALITY_BAR_BLOCKING_RULE_RE.test(l));
          if (ruleIdx === -1) {
            violations.push(
              mkv(
                relQb,
                1,
                'A2/quality-bar-blocking-groups-mismatch',
                `완료 판정 규칙에 '차단 항목을 가진 그룹: …' 부기 줄이 없음 — 어느 그룹이 차단 항목을 갖는지가 문서에서 사라지면 규칙 2 를 적용할 대상을 알 수 없다 (fix: 규칙 2 안에 '차단 항목을 가진 그룹: ${QUALITY_BAR_BLOCKING_GROUPS.join('·')}.' 줄을 복원하라. 코드펜스·HTML 주석 안의 문장은 인쇄용 예시로 보고 세지 않는다)`,
              ),
            );
          } else {
            const declaredSet = new Set(qbLines[ruleIdx].match(/\bG\d+\b/g) ?? []);
            if (!sameGroupSet(declaredSet, constantSet)) {
              violations.push(
                mkv(
                  relQb,
                  ruleIdx + 1,
                  'A2/quality-bar-blocking-groups-mismatch',
                  `완료 판정 규칙 2 의 부기 줄이 나열한 차단 그룹이 검사기 상수와 다름 — 문서 '${fmtGroupSet(declaredSet)}' vs QUALITY_BAR_BLOCKING_GROUPS '${fmtGroupSet(constantSet)}' (fix: 등급 열을 바꿨으면 부기 줄과 이 상수를 함께 갱신하라)`,
                ),
              );
            }
          }

          // ③ 표 `등급` 열 실측 — 첫 셀이 'G<n>-<m>' 인 행 중 어떤 셀이
          // 정확히 '차단' 인 행을 가진 그룹만 모은다.
          const measuredSet = new Set();
          for (const line of qbLines) {
            const t = line.trim();
            if (!t.startsWith('|')) continue;
            const cells = t
              .replace(/^\|/, '')
              .replace(/\|$/, '')
              .split('|')
              .map((c) => c.trim());
            const idm = cells[0].match(QUALITY_BAR_ITEM_ID_RE);
            if (idm === null) continue;
            if (cells.slice(1).some((c) => c === '차단')) measuredSet.add(idm[1]);
          }
          if (!sameGroupSet(measuredSet, constantSet)) {
            violations.push(
              mkv(
                relQb,
                1,
                'A2/quality-bar-blocking-groups-mismatch',
                `표 '등급' 열에서 실측한 차단 그룹이 검사기 상수와 다름 — 실측 '${fmtGroupSet(measuredSet)}' vs QUALITY_BAR_BLOCKING_GROUPS '${fmtGroupSet(constantSet)}' (실측은 첫 셀이 'G<그룹>-<번호>' 인 표 행 중 어떤 셀이 정확히 '차단' 인 행만 센다. fix: 등급을 바꿨으면 이 상수와 규칙 2 부기 줄을 함께 갱신하라)`,
              ),
            );
          }
        }
      }

      // N2 — render-rules.md 1층(1-1~1-10) 완전성
      {
        const renderRulesPath = path.join(skillDir, 'references', 'render-rules.md');
        const relRenderRules = path.relative(root, renderRulesPath);
        if (!fs.existsSync(renderRulesPath)) {
          violations.push(
            mkv(
              relRenderRules,
              1,
              'A2/render-rules-tier1-incomplete',
              `references/render-rules.md 파일이 없음 — 1층(하드 규칙) 판정·자동 수정의 정본이 사라지면 3단계 렌더가 근거를 잃는다 (fix: 1-1~1-10 10항목을 담은 render-rules.md를 복원하라)`,
            ),
          );
        } else {
          const rrSrc = readFile(renderRulesPath);
          // G0 스캔과 같은 이유로 코드펜스·HTML 주석을 비운 텍스트만 본다 —
          // 인용·예시로 인쇄된 heading 이 실제 앵커를 대신하지 못하게 한다.
          const rrLines = blankFencedLines(stripHtmlComments(rrSrc).split('\n'));
          const rrText = rrLines.join('\n');
          for (const id of TIER1_REQUIRED_ITEMS) {
            const anchorRe = new RegExp(`^###\\s+${id}(?![0-9])`, 'm');
            if (!anchorRe.test(rrText)) {
              violations.push(
                mkv(
                  relRenderRules,
                  1,
                  'A2/render-rules-tier1-incomplete',
                  `render-rules.md에 '### ${id} ' H3 heading이 없음 — 1층 10항목(1-1~1-10)이 전부 앵커돼야 한다. '${id}' 는 다른 항목(예: 1-1↔1-10)의 접두일 수 있으므로 단순 문자열 포함 검사가 아니라 heading 앵커로 확인한다 (fix: '### ${id} <제목>' 형태로 복원하라)`,
                ),
              );
            }
          }
        }
      }

      // N3 — assets/project/icons/ 6종 + icons.tsx 파리티
      {
        const iconsDir = path.join(skillDir, 'assets', 'project', 'icons');
        const relIconsDir = path.relative(root, iconsDir);
        const iconsTsxPath = path.join(skillDir, 'assets', 'project', 'icons.tsx');
        const iconsTsxExists = fs.existsSync(iconsTsxPath);
        const iconsTsxSrc = iconsTsxExists ? readFile(iconsTsxPath) : '';
        const relIconsTsx = path.relative(root, iconsTsxPath);

        if (!fs.existsSync(iconsDir)) {
          violations.push(
            mkv(
              relIconsDir,
              1,
              'A2/design-icon-asset-invalid',
              `아이콘 디렉터리 assets/project/icons/ 가 없음 — 1층(1-9)이 요구하는 SVG 아이콘 6종(chevron-right/left/down/up·close·search)의 정본이 사라졌다 (fix: 6개 svg 파일을 복원하라)`,
            ),
          );
        } else {
          if (!iconsTsxExists) {
            violations.push(
              mkv(
                relIconsTsx,
                1,
                'A2/design-icon-asset-invalid',
                `assets/project/icons.tsx 가 없음 — React 계열 프로젝트에 심을 named export 6종의 정본이 사라졌다 (fix: icons.tsx를 복원하라)`,
              ),
            );
          }
          for (const { file, component } of DESIGN_ICON_SPECS) {
            const svgPath = path.join(iconsDir, `${file}.svg`);
            const relSvg = path.relative(root, svgPath);
            if (!fs.existsSync(svgPath)) {
              violations.push(
                mkv(
                  relSvg,
                  1,
                  'A2/design-icon-asset-invalid',
                  `${file}.svg 파일이 없음 — 아이콘 6종 중 하나가 빠짐 (fix: assets/project/icons/${file}.svg 를 복원하라)`,
                ),
              );
              continue;
            }
            const svgSrc = readFile(svgPath);
            if (!/stroke\s*=\s*"currentColor"/.test(svgSrc)) {
              violations.push(
                mkv(
                  relSvg,
                  1,
                  'A2/design-icon-asset-invalid',
                  `${file}.svg 가 stroke="currentColor" 를 쓰지 않음 — 1층(1-9)이 요구하는 색 상속을 자산 스스로 어긴다 (fix: stroke="currentColor" 로 고쳐라)`,
                ),
              );
            }
            const hardcodedMatch = svgSrc.match(/(?:fill|stroke)\s*=\s*"#[0-9a-fA-F]{3,8}"/);
            if (hardcodedMatch) {
              violations.push(
                mkv(
                  relSvg,
                  1,
                  'A2/design-icon-asset-invalid',
                  `${file}.svg 에 하드코딩된 색상(${hardcodedMatch[0]})이 있음 — currentColor 상속 규칙 위반 (fix: hex 색상값을 지우고 currentColor만 남겨라)`,
                ),
              );
            }
            if (iconsTsxExists) {
              const svgSig = extractIconShapeSignature(svgSrc);
              const block = extractIconComponentBlock(iconsTsxSrc, component);
              if (block === null) {
                violations.push(
                  mkv(
                    relIconsTsx,
                    1,
                    'A2/design-icon-asset-invalid',
                    `icons.tsx에 '${component}' named export가 없음 — ${file}.svg 와 짝이 맞지 않는다 (fix: export function ${component}(...) 를 복원하라)`,
                  ),
                );
              } else {
                const tsxSig = extractIconShapeSignature(block);
                if (svgSig !== tsxSig) {
                  violations.push(
                    mkv(
                      relIconsTsx,
                      1,
                      'A2/design-icon-asset-invalid',
                      `icons.tsx의 '${component}' 모양이 ${file}.svg 와 다름(path/circle 파리티 불일치) — 두 자산이 같은 아이콘의 다른 표현이어야 한다 (fix: 좌표를 ${file}.svg 와 동일하게 맞춰라)`,
                    ),
                  );
                }
              }
            }
          }
        }
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
            `다음 station seam 없음: skill 본문(## Out of scope / ## 참고 이전)에 '/ait:' 참조 필요 (docs/design/skill-conventions.md §3)`,
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
              `seam 이 산문에만 있음: 다음 station '/ait' 명령을 완료/요약 fenced 블록(## 참고 이전)에 인쇄해야 한다 (docs/design/skill-conventions.md §3 — "본문 마지막 블록(완료/요약 출력)")`,
            ),
          );
        } else {
          // §3 확장 (harness#101): seam 은 슬래시 + 자연어 동치 **2표면**이다.
          // 위 3겹(no-seam · seam-not-printed · A8 resolvability)을 대체하지 않고
          // 그 위에 얹는다 — 슬래시 표면이 안 오는 에이전트에서의 dead-end 방지.
          const seamBlocks = fencedBlockRanges(bodyLines).filter((b) => b.fenceIdx < seamEnd);
          const hasNlInSeam = bodyLines.some(
            (l, i) => i < seamEnd && fencedLines.has(i + 1) && SEAM_NL_RE.test(l),
          );
          if (!hasNlInSeam) {
            violations.push(
              mkv(
                relFile,
                1,
                'A2/seam-nl-missing',
                `seam 이 슬래시 단일 표면임: 인쇄되는 완료/요약 블록에 자연어 동치 문장을 함께 둬야 한다 — 형식 \`말로: "<발화>"\` (docs/design/skill-conventions.md §9, harness#101). 슬래시 네임스페이스가 그대로 오지 않는 에이전트에서는 슬래시 단독 seam 이 dead-end 다`,
              ),
            );
          }
          for (const block of seamBlocks) {
            const blockLines = bodyLines.slice(block.start, Math.min(block.end, seamEnd));
            if (!blockLines.some((l) => SEAM_CMD_LINE_RE.test(l))) continue;
            if (blockLines.some((l) => SEAM_NL_RE.test(l))) continue;
            // body 는 src 의 꼬리라 (전체 줄수 - body 줄수) 가 frontmatter 오프셋이다.
            const fmOffset = srcLines.length - bodyLines.length;
            violations.push(
              mkv(
                relFile,
                block.fenceIdx + fmOffset + 1,
                'A2/seam-nl-block-incomplete',
                `'/ait:' 명령을 인쇄하는 블록에 자연어 동치가 없음: 같은 블록 안에 \`말로: "<발화>"\` 를 함께 인쇄해야 한다 (docs/design/skill-conventions.md §9, harness#101)`,
              ),
            );
          }
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

  // 2. promptfoo eval 동기화 — eval/ 은 maintainer-local 측정 인프라라 repo 미포함(.gitignore).
  // 존재할 때만 동기화 검사를 발화한다 — 부재는 공개 clone의 정상 상태이므로 조용히 skip.
  const promptfooConfig = path.join(root, 'eval', 'promptfoo', 'promptfooconfig.yaml');
  const relPromptfoo = path.relative(root, promptfooConfig);

  if (fs.existsSync(promptfooConfig)) {
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
// A5 — plugin.json ↔ package.json 버전 드리프트
// ---------------------------------------------------------------------------

/**
 * 버전 정합을 검사하는 어댑터 매니페스트 목록. `requiredHere: true`(Claude
 * Code)는 파일 부재·파싱 실패 자체를 A5 위반으로 본다 — 이 매니페스트는
 * 플러그인의 1급 진입점이라 없으면 안 된다. `requiredHere: false`(Cursor)는
 * 부재·파싱 실패를 A5 가 조용히 넘긴다 — 그 상태는 A11(어댑터 manifest
 * 정합성)이 `A11/cursor-manifest-missing`·`A11/cursor-manifest-invalid` 로
 * 보고한다(중복 신고 방지 — A7 이 "A5 가 부재를 별도로 다룬다"며 자기 검사를
 * skip 하는 것과 같은 관례).
 */
const VERSIONED_ADAPTER_MANIFESTS = [
  { segs: ['.claude-plugin', 'plugin.json'], requiredHere: true },
  { segs: ['.cursor-plugin', 'plugin.json'], requiredHere: false },
];

/** @param {string} root @returns {Violation[]} */
function checkA5(root) {
  const violations = [];
  const pkgPath = path.join(root, 'package.json');

  /** @type {{ version?: string }} */
  let pkg;
  try {
    pkg = JSON.parse(readFile(pkgPath));
  } catch {
    return [mkv('package.json', 1, 'A5/plugin-json-version-drift', 'package.json 파싱 실패')];
  }

  for (const { segs, requiredHere } of VERSIONED_ADAPTER_MANIFESTS) {
    const pluginPath = path.join(root, ...segs);
    const relPlugin = path.relative(root, pluginPath);

    if (!fs.existsSync(pluginPath)) {
      if (requiredHere) {
        violations.push(
          mkv(relPlugin, 1, 'A5/plugin-json-version-drift', `${relPlugin} 파일이 없음`),
        );
      }
      continue;
    }

    /** @type {{ version?: string }} */
    let plugin;
    try {
      plugin = JSON.parse(readFile(pluginPath));
    } catch {
      if (requiredHere) {
        violations.push(
          mkv(relPlugin, 1, 'A5/plugin-json-version-drift', `${relPlugin} 파싱 실패`),
        );
      }
      continue;
    }

    if (pkg.version !== plugin.version) {
      violations.push(
        mkv(
          relPlugin,
          1,
          'A5/plugin-json-version-drift',
          `버전 불일치: ${relPlugin} '${plugin.version}' vs package.json '${pkg.version}' (fix: pnpm sync:plugin-version 실행 또는 두 파일 직접 동기화)`,
        ),
      );
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// A11 — 어댑터 manifest 정합성 (.cursor-plugin ↔ .claude-plugin) (hard-fail)
// ---------------------------------------------------------------------------
//
// .cursor-plugin/plugin.json 은 무빌드 어댑터로 shared/skills 를 그대로
// 가리키는 두 번째 진입점이다 — 어떤 A-규칙도 이전에는 .cursor-plugin/ 을
// 스캔하지 않았으므로, 새 파일을 추가하는 것만으로는 두 매니페스트의
// 드리프트(이름·skills 경로·mcpServers 불일치)가 위반으로 잡히지 않았다.
// 그 침묵을 여기서 메운다. `keywords` 는 두 어댑터에서 의도적으로 다르게
// 유지하므로(예: `claude-code` vs `cursor`) 대조하지 않는다.

/**
 * Cursor 플러그인 manifest 스키마가 허용하는 최상위 키 21개(additionalProperties:
 * false). 출처: github.com/cursor/plugins 의 JSON schema + cursor.com/docs/reference/plugins
 * (확인일 2026-08-28).
 */
const CURSOR_MANIFEST_KEYS = new Set([
  'name',
  'displayName',
  'description',
  'version',
  'minClientVersions',
  'author',
  'publisher',
  'homepage',
  'repository',
  'license',
  'logo',
  'keywords',
  'category',
  'tags',
  'commands',
  'agents',
  'skills',
  'rules',
  'hooks',
  'variables',
  'mcpServers',
]);

/** 루트 marketplace.json 의 plugins[] 항목이 허용하는 키(Cursor 스키마) — `displayName` 은 불가. */
const CURSOR_MARKETPLACE_ENTRY_KEYS = new Set([
  'name',
  'source',
  'description',
  'minClientVersions',
]);

/** Cursor 플러그인 이름 패턴. */
const CURSOR_NAME_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** 두 어댑터가 함께 가리켜야 하는 skills 경로(무빌드 — shared/ 를 그대로 지목). */
const ADAPTER_SKILLS_PATH = './shared/skills/';

/**
 * Cursor 매니페스트에서 의도적으로 뺀 mcpServers 키 집합 — 기본은 빈 집합.
 * (예: 콘솔 MCP 의 인라인 auth 가 Cursor 에서 거부돼 폴백을 택하면 이
 * 집합에 'apps-in-toss-console' 을 채우고 사유를 여기 주석에 남긴다.)
 */
const CURSOR_MANIFEST_MCP_OMIT = new Set();

/**
 * `root`(패키지 디렉터리) 에서 두 단계 위에 `pnpm-workspace.yaml` 이 있으면
 * 그 경로를 monorepo 루트로 본다 — 없으면 null 을 돌려줘 tmp fixture 에서
 * 루트 marketplace 검사를 조용히 skip 하게 한다.
 * @param {string} root @returns {string | null}
 */
function findRepoRoot(root) {
  const candidate = path.join(root, '..', '..');
  return fs.existsSync(path.join(candidate, 'pnpm-workspace.yaml')) ? candidate : null;
}

/** 선행 `./` 와 후행 `/` 를 제거해 marketplace `source` 표기 차이를 정규화한다. @param {string} source @returns {string} */
function normalizeSource(source) {
  return source.replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * 루트 marketplace 파일(`.claude-plugin/marketplace.json`·`.cursor-plugin/marketplace.json`)
 * 에서 이 패키지 항목이 정합한지 확인한다. `repoRoot` 가 감지되지 않으면(pnpm
 * workspace 밖 — tmp fixture 등) 조용히 skip 한다.
 *
 * 주의: 이 함수가 만드는 violation 의 `file` 은 (다른 A11 규칙과 달리)
 * repo-root 상대경로다 — marketplace.json 자체가 repo 루트 파일이라 패키지
 * `root` 상대경로로는 표현할 수 없기 때문이다.
 *
 * @param {string} root @param {string | null} repoRoot @param {string} manifestName
 * @returns {Violation[]}
 */
function checkA11Marketplaces(root, repoRoot, manifestName) {
  const violations = [];
  if (!repoRoot) return violations;

  const expectedSource = normalizeSource(path.relative(repoRoot, root));

  const marketplaces = [
    { segs: ['.claude-plugin', 'marketplace.json'], isCursor: false },
    { segs: ['.cursor-plugin', 'marketplace.json'], isCursor: true },
  ];

  for (const { segs, isCursor } of marketplaces) {
    const mpPath = path.join(repoRoot, ...segs);
    const relMp = path.relative(repoRoot, mpPath); // repo-root 상대경로 — 위 주석 참조

    if (!fs.existsSync(mpPath)) {
      violations.push(mkv(relMp, 1, 'A11/marketplace-missing', `${relMp} 파일이 없음`));
      continue;
    }

    /** @type {{ plugins?: Array<Record<string, unknown>> }} */
    let mp;
    try {
      mp = JSON.parse(readFile(mpPath));
    } catch {
      violations.push(
        mkv(relMp, 1, 'A11/marketplace-entry-drift', `${relMp} 파싱 실패 (fix: JSON 문법 확인)`),
      );
      continue;
    }

    const plugins = Array.isArray(mp.plugins) ? mp.plugins : [];
    const entry = plugins.find((p) => p && p.name === manifestName);
    if (!entry) {
      violations.push(
        mkv(
          relMp,
          1,
          'A11/marketplace-entry-drift',
          `${relMp} 의 plugins[] 에 name '${manifestName}' 항목이 없음 (fix: 항목 추가)`,
        ),
      );
      continue;
    }

    const entrySource =
      typeof entry.source === 'string' ? normalizeSource(entry.source) : entry.source;
    if (entrySource !== expectedSource) {
      violations.push(
        mkv(
          relMp,
          1,
          'A11/marketplace-source-drift',
          `${relMp} 의 '${manifestName}' 항목 source '${entry.source}' 가 실제 위치 '${expectedSource}' 와 다름 (fix: source 를 '${expectedSource}' 로 맞춘다)`,
        ),
      );
    }

    if (isCursor) {
      for (const key of Object.keys(entry)) {
        if (!CURSOR_MARKETPLACE_ENTRY_KEYS.has(key)) {
          violations.push(
            mkv(
              relMp,
              1,
              'A11/marketplace-unknown-key',
              `${relMp} 의 '${manifestName}' 항목 키 '${key}' 가 Cursor marketplace 스키마에 없음(예: displayName 복붙 실수) (fix: 키 제거)`,
            ),
          );
        }
      }
    }
  }

  return violations;
}

/** @param {string} root @returns {Violation[]} */
function checkA11(root) {
  const violations = [];
  const claudePath = path.join(root, '.claude-plugin', 'plugin.json');
  const cursorPath = path.join(root, '.cursor-plugin', 'plugin.json');
  const relCursor = path.relative(root, cursorPath);

  if (!fs.existsSync(claudePath)) return violations; // A5 가 부재를 별도로 다룬다

  /**
   * @type {{ name?: string, skills?: string, commands?: string,
   *   mcpServers?: Record<string, { url?: string, oauth?: { clientId?: string } }> }}
   */
  let claude;
  try {
    claude = JSON.parse(readFile(claudePath));
  } catch {
    return violations; // A5 가 파싱 실패를 별도로 다룬다
  }

  if (!fs.existsSync(cursorPath)) {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-manifest-missing',
        `${relCursor} 파일이 없음 (fix: .claude-plugin/plugin.json 을 미러링해 새로 작성)`,
      ),
    );
    return violations;
  }

  /**
   * @type {{ name?: string, skills?: string, commands?: unknown,
   *   mcpServers?: Record<string, { url?: string, auth?: { CLIENT_ID?: string } }> }}
   */
  let cursor;
  try {
    cursor = JSON.parse(readFile(cursorPath));
  } catch {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-manifest-invalid',
        `${relCursor} 파싱 실패 (fix: JSON 문법 확인)`,
      ),
    );
    return violations;
  }

  if (cursor.name !== claude.name) {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-name-mismatch',
        `이름 불일치: ${relCursor} '${cursor.name}' vs .claude-plugin/plugin.json '${claude.name}' (fix: 두 매니페스트 name 을 동일하게)`,
      ),
    );
  }

  if (typeof cursor.name !== 'string' || !CURSOR_NAME_RE.test(cursor.name)) {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-name-pattern',
        `${relCursor} 의 name '${cursor.name}' 이 Cursor 스키마 패턴(소문자·숫자·.·- 만, 양끝은 영숫자) 을 어긋난다 (fix: name 을 패턴에 맞게 수정)`,
      ),
    );
  }

  if (cursor.skills !== ADAPTER_SKILLS_PATH) {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-skills-path',
        `${relCursor} 의 skills 가 '${cursor.skills}' — '${ADAPTER_SKILLS_PATH}' 이어야 shared/ 를 정본으로 유지한다 (fix: skills: '${ADAPTER_SKILLS_PATH}')`,
      ),
    );
  }

  if ('commands' in cursor) {
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-commands-present',
        `${relCursor} 에 commands 키가 있다 — Cursor 어댑터는 v1 에서 commands 를 뺀다(설계 결정: $ARGUMENTS 미지원·Commands limbo) (fix: commands 키 제거, 뒤집으려면 이 규칙과 CLAUDE.md adapter 계약을 같이 고친다)`,
      ),
    );
  }

  const claudeServers = claude.mcpServers ?? {};
  const cursorServers = cursor.mcpServers ?? {};
  const claudeKeys = new Set(Object.keys(claudeServers));
  const cursorKeys = new Set(Object.keys(cursorServers));
  const expectedCursorKeys = new Set(
    [...claudeKeys].filter((k) => !CURSOR_MANIFEST_MCP_OMIT.has(k)),
  );

  const missingInCursor = [...expectedCursorKeys].filter((k) => !cursorKeys.has(k));
  const extraInCursor = [...cursorKeys].filter((k) => !claudeKeys.has(k));
  if (missingInCursor.length > 0 || extraInCursor.length > 0) {
    const detail = [
      missingInCursor.length > 0 ? `cursor 에 없음: ${missingInCursor.join(', ')}` : null,
      extraInCursor.length > 0 ? `cursor 에만 있음: ${extraInCursor.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    violations.push(
      mkv(
        relCursor,
        1,
        'A11/cursor-mcp-servers-drift',
        `mcpServers 키 집합 불일치 (${detail}) (fix: 두 매니페스트의 mcpServers 키를 맞추거나 CURSOR_MANIFEST_MCP_OMIT 에 사유와 함께 등록)`,
      ),
    );
  }

  for (const key of [...claudeKeys].filter((k) => cursorKeys.has(k))) {
    const claudeUrl = claudeServers[key]?.url;
    const cursorUrl = cursorServers[key]?.url;
    if (claudeUrl !== cursorUrl) {
      violations.push(
        mkv(
          relCursor,
          1,
          'A11/cursor-mcp-url-drift',
          `mcpServers.${key}.url 불일치: ${relCursor} '${cursorUrl}' vs .claude-plugin/plugin.json '${claudeUrl}' (fix: url 을 동일하게 맞춘다)`,
        ),
      );
    }

    const claudeClientId = claudeServers[key]?.oauth?.clientId;
    const cursorClientId = cursorServers[key]?.auth?.CLIENT_ID;
    if ((claudeClientId || cursorClientId) && claudeClientId !== cursorClientId) {
      violations.push(
        mkv(
          relCursor,
          1,
          'A11/cursor-mcp-auth-drift',
          `mcpServers.${key} 인증 클라이언트 불일치: ${relCursor} auth.CLIENT_ID '${cursorClientId}' vs .claude-plugin/plugin.json oauth.clientId '${claudeClientId}' (fix: 두 값을 동일하게 맞춘다)`,
        ),
      );
    }
  }

  for (const key of Object.keys(cursor)) {
    if (!CURSOR_MANIFEST_KEYS.has(key)) {
      violations.push(
        mkv(
          relCursor,
          1,
          'A11/cursor-unknown-key',
          `${relCursor} 최상위 키 '${key}' 가 Cursor 플러그인 manifest 스키마에 없음 (fix: 키 제거 또는 오타 확인)`,
        ),
      );
    }
  }

  violations.push(...checkA11Marketplaces(root, findRepoRoot(root), claude.name ?? cursor.name));

  return violations;
}

// ---------------------------------------------------------------------------
// A10 — CHANGELOG.md 버전 섹션 존재 (hard-fail)
// ---------------------------------------------------------------------------
//
// 0.1.22/0.1.23 드리프트(package.json 버전만 두 차례 올라가고 CHANGELOG.md 는
// 0.1.21 에 멈춰 있던 것) 재발 방지. changesets 워크플로에서는 changeset 이
// `.changeset/` 에 누적되기만 하고 아직 버전을 올리지 않은 상태가 정상이므로,
// "미소비 changeset 개수" 로 예외를 만들지 않는다 — 그러면 정확히 이번
// 드리프트처럼 "버전은 올랐는데 CHANGELOG 는 안 올랐다" 를 놓칠 수 있는 예외
// 창이 생긴다. 대신 불변식을 하나로 단순화한다: **현재 package.json 버전의
// `## <version>` 섹션이 CHANGELOG.md 에 있어야 한다.** 버전을 올리는 경로가
// 무엇이든(수동 편집·`changeset version`·다른 스크립트) 이 섹션 동반을
// 강제한다.

/** @param {string} root @returns {Violation[]} */
function checkA10(root) {
  const pkgPath = path.join(root, 'package.json');

  /** @type {{ version?: string }} */
  let pkg;
  try {
    pkg = JSON.parse(readFile(pkgPath));
  } catch {
    // package.json 파싱 실패는 A5 가 이미 별도로 보고한다 — 중복 보고 방지.
    return [];
  }
  if (!pkg.version) return [];

  const changelogPath = path.join(root, 'CHANGELOG.md');
  const relChangelog = path.relative(root, changelogPath);

  if (!fs.existsSync(changelogPath)) {
    return [
      mkv(
        relChangelog,
        1,
        'A10/changelog-version-missing',
        `CHANGELOG.md 파일이 없음 — package.json 버전 '${pkg.version}' 을 기록할 곳이 없다 (fix: CHANGELOG.md 를 만들고 '## ${pkg.version}' 섹션을 추가)`,
      ),
    ];
  }

  const changelog = readFile(changelogPath);
  const escapedVersion = pkg.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionHeadingRe = new RegExp(`^##\\s+${escapedVersion}\\s*$`, 'm');

  if (!versionHeadingRe.test(changelog)) {
    return [
      mkv(
        relChangelog,
        1,
        'A10/changelog-version-missing',
        `CHANGELOG.md 에 현재 package.json 버전 '${pkg.version}' 의 '## ${pkg.version}' 섹션이 없음 (fix: 버전을 올릴 때 CHANGELOG.md 에 '## ${pkg.version}' 섹션을 함께 기록 — changeset 워크플로면 'pnpm changeset version'/'pnpm release:version')`,
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
// A6 — aitc.dev 링크 부재 검사 (opt-in, warn-only)
// ---------------------------------------------------------------------------
//
// 커뮤니티 결합 절단 이전에는 이 검사가 skill 전반의 *.aitc.dev 링크가 실제로
// 살아있는지(200 응답) 네트워크로 확인했다. 절단 이후에는 목적이 바뀐다 —
// "커뮤니티 링크가 살아있는가"가 아니라 "커뮤니티 링크 자체가 남아있는가"를
// 묻는다. 이 repo(harness)에서 skill 본문에 남아 있어도 되는 aitc.dev 링크는
// 이제 0개다 — 마지막까지 남아 있던 예외 `https://devtools.aitc.dev/launcher/`
// (D2, 실기기 attach용 PWA)는 launcher가 harness Pages 로 옮겨가며 참조가 0건이
// 됐고, 그 launcher 자체도 환경 2 제거(harness#103)로 사라졌다 — 사문화된
// allowlist 항목을 남겨두면 같은 도메인이 다시
// 들어와도 이 게이트가 조용히 통과시키므로, 앞서 `https://aitc.dev/apple-touch-icon.png`
// (D7, `ait build`의 `brand.icon` 기본값 자동 주입이 제거되며 참조 0건화)
// 때와 같은 이유로 항목도 함께 걷어냈다.
// 그 외의 *.aitc.dev(docs.aitc.dev, sdk-example.aitc.dev, 커뮤니티 자기서술
// 등)는 전부 커뮤니티 결합의 잔재이므로 0건이어야 한다. 더 이상 네트워크가
// 필요 없지만(순수 텍스트 스캔), 기존 CLI 계약(`VALIDATE_LINKS=1` opt-in,
// `runChecks()` 동기 계약과 분리된 CLI 전용 실행)은 그대로 유지한다.
// (#183 docs /intro 404, #185 외부 링크 rot 트리아지에서 출발한 검사였으나,
// 이제는 A2 정적 검사가 못 잡는 "허용 목록 밖의 aitc.dev 잔존"을 잡는다 —
// 현재 허용 목록은 비어 있다.)

// 명시적으로 유지가 승인된 aitc.dev 링크 allowlist — 현재는 빈 배열이다.
// (직전까지 유일한 항목이었던 D2 `devtools.aitc.dev/launcher/` 도 위 사유로
// 제거됨.) 새 예외가 생기면 사유를 주석으로 남기고 여기 추가한다.
const A6_ALLOWLIST_RES = [];

// 추출에서 제외하는 링크 패턴 — placeholder/template 토큰(<...>) 포함 링크는
// 실제 링크가 아니므로 애초에 대상에서 뺀다.
const A6_SKIP_LINK_RES = [/[<>]/];

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
        'VALIDATE_LINKS=1 이 아니라 aitc.dev 링크 부재 검사 건너뜀 (기본 동작)',
        'warn',
      ),
    ];
  }

  const links = collectAitcLinks(root);
  /** @type {Violation[]} */
  const violations = [];
  for (const l of links) {
    if (A6_ALLOWLIST_RES.some((re) => re.test(l.url))) continue;
    violations.push(
      mkv(
        l.file,
        l.line,
        'A6/leftover-community-link',
        `커뮤니티 결합 잔재로 추정되는 aitc.dev 링크: ${l.url} (fix: 절단 계획서 대조 후 제거하거나, 정말 유지해야 하면 사유와 함께 A6_ALLOWLIST_RES 에 등재)`,
        'warn',
      ),
    );
  }
  if (violations.length === 0) {
    violations.push(
      mkv(
        '',
        0,
        'A6/ok',
        `aitc.dev 링크 부재 검사 통과 (허용 목록 외 잔존 링크 0건, 총 ${links.length}개 스캔)`,
        'warn',
      ),
    );
  }
  return violations;
}

// ---------------------------------------------------------------------------
// A9 — skill 본문 실제 주입 여부 (opt-in, BEHAVIOR — harness#136)
// ---------------------------------------------------------------------------
//
// A1/cmd-name-shadows-skill 같은 정적 검사는 harness#134 가 실제로 겪은
// **원인**(command stub 이름이 skill 과 겹침)을 잡는다. 이 검사는 원인이
// 아니라 **증상**을 잰다 — "`Skill(ait:<v>)` 를 호출했을 때 세션에 실제로
// 주입된 텍스트가 디스크 SKILL.md 본문과 같은가". harness#134 는 3주 동안
// 라우팅 eval(슈트 A)·e2e eval(슈트 B)·정적 검증기가 전부 green 이었다 —
// 셋 다 "skill 이 호출됐는가"만 쟀지 "호출된 skill 의 본문이 실제로 들어왔는가"
// 는 아무도 재지 않았기 때문이다. 아직 알려지지 않은 다른 shadowing 경로(예:
// 이름이 다른데도 뭔가 다른 이유로 본문이 안 실리는 경우)가 생겨도 이 검사는
// 원인과 무관하게 잡는다 — 그래서 정적 A1 검사를 대체하지 않고 보완한다.
//
// 판정은 **완전 일치**(글자 단위)를 쓴다. harness#136 이슈 원안은 "같은
// 자릿수 + 도입부 일치" 같은 느슨한 판정을 제안했지만, 이건 필요 이상으로
// 약하다 — shadow 된 본문은 항상 command stub 의 불활성 문자열(수십 자)이고
// 정상 본문은 항상 정확히 같은 글자수의 전문이라, 완전 일치가 오탐·미탐
// 여지 없이 쓸 수 있는 오라클이다(실측: plan skill, 주입 10124자 === 디스크
// 10124자, 완전 일치 `true`). 판정 로직 자체는 `skill-load-probe.mjs` 에 있다
// — CLI 세션 spawn·stream-json 파싱·동시 실행까지 얽혀 있어 이 파일에 두면
// checkA1~A8 과 같은 "파일 읽고 정규식 대조" 패턴에서 너무 벗어난다.
//
// CI 미등록 사유(#136 명시): skill 8개 × 세션 1개 = CLI 세션 8회, 병렬로도
// 수 분이 걸려 PR `check` job 예산에 안 맞고, `claude` CLI 는 구독 세션 인증이
// 필요해 CI 러너에는 애초에 인증 수단이 없다. `.github/workflows/*` 는 건드리지
// 않는다 — 이 검사는 메인테이너가 로컬에서 수동으로(`VALIDATE_SKILL_LOAD=1`)
// 돌린다, eval 슈트 B 가 "메인테이너 수동·오프라인" harness 인 것과 같은 계약.

/**
 * @param {string} root
 * @returns {Promise<Violation[]>}
 */
async function checkA9(root) {
  if (process.env.VALIDATE_SKILL_LOAD !== '1') {
    return [
      mkv(
        '',
        0,
        'A9/skipped',
        'VALIDATE_SKILL_LOAD=1 이 아니라 skill 본문 주입 실측 건너뜀 (기본 동작 — claude CLI 세션을 skill 개수만큼 띄우므로 비용이 큼)',
        'warn',
      ),
    ];
  }

  const jobs = Number.parseInt(process.env.SKILL_LOAD_JOBS ?? '', 10) || SKILL_LOAD_DEFAULT_JOBS;
  const model = process.env.SKILL_LOAD_MODEL || SKILL_LOAD_DEFAULT_MODEL;
  const { preflightError, results } = await probeAllSkills(root, { jobs, model });

  if (preflightError) {
    return [mkv('', 0, 'A9/cli-not-found', preflightError)];
  }

  /** @type {Violation[]} */
  const violations = [];
  for (const r of results) {
    const relFile = path.join('shared', 'skills', r.skill, 'SKILL.md');
    switch (r.outcome) {
      case 'match':
        violations.push(
          mkv(
            relFile,
            1,
            'A9/ok',
            `skill '${r.skill}' 본문 주입 확인 (주입 ${r.injectedChars}자 == 기대 ${r.expectedChars}자, 완전 일치)`,
            'warn',
          ),
        );
        break;

      case 'no-route':
        // Skill 도구 자체가 안 불렸다 — probe 발화("Invoke the ait:<v> skill
        // now.")에 모델이 이번 실행에서 라우팅하지 않은 것으로, shadow 판정과
        // 독립적인 probe 실패다(#136 요구사항: "the Skill tool was never
        // called → probe 실패이지 shadow 단정 아님"). A9/skill-load-shadowed
        // 와 코드를 분리해 혼동하지 않게 한다.
        violations.push(
          mkv(
            relFile,
            1,
            'A9/probe-no-route',
            `probe 세션에서 Skill 도구가 'ait:${r.skill}' 로 호출되지 않음 — shadow 단정 불가, 라우팅 자체가 이번 실행에서 안 됐을 뿐일 수 있다 (fix: 재실행해 재현되는지 먼저 확인)`,
          ),
        );
        break;

      case 'no-body':
        violations.push(
          mkv(
            relFile,
            1,
            'A9/skill-load-shadowed',
            `skill '${r.skill}' — Skill 호출은 됐지만 이후 본문 주입 이벤트가 세션 종료까지 없었음 (기대 ${r.expectedChars}자). SKILL.md 가 이 세션에 한 번도 로드되지 않았다는 뜻 — 같은 이름의 command stub 이 없는지 shared/commands/ 를 확인하라(fix 예시는 A1/cmd-name-shadows-skill)`,
          ),
        );
        break;

      case 'mismatch': {
        const ctx =
          r.divergenceOffset >= 0
            ? `첫 불일치 offset ${r.divergenceOffset} — 기대: …${r.expectedContext}… / 실제: …${r.injectedContext}…`
            : '길이 비교로는 불일치를 못 찾음(빈 문자열 등 경계 케이스)';
        violations.push(
          mkv(
            relFile,
            1,
            'A9/skill-load-shadowed',
            `skill '${r.skill}' — 주입된 본문이 디스크 SKILL.md 와 다름 (주입 ${r.injectedChars}자 vs 기대 ${r.expectedChars}자). ${ctx}. 대개 같은 이름의 command stub 이 이겨서 그 stub 의 불활성 본문이 대신 주입된 경우다(harness#134)`,
          ),
        );
        break;
      }

      case 'cli-error':
        // shadow 발견과 절대 같은 코드를 쓰면 안 된다 — CLI 가 죽거나
        // 타임아웃난 건 "본문이 안 실렸다"는 관측이 아니라 "관측을 못 했다"
        // 는 뜻이다(#136 요구사항 4번째 항목).
        violations.push(
          mkv(
            relFile,
            1,
            'A9/probe-cli-error',
            `skill '${r.skill}' probe 세션 실행 실패 — 관측 자체를 못 함: ${r.detail}`,
          ),
        );
        break;

      default:
        violations.push(
          mkv(relFile, 1, 'A9/probe-unknown', `알 수 없는 probe 결과: ${JSON.stringify(r)}`),
        );
    }
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
    ...checkA5(root),
    ...checkA7(root),
    ...checkA8(root),
    ...checkA10(root),
    ...checkA11(root),
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
    A2: 'A2 — 본문 구조 + seam (슬래시·자연어 2표면)',
    A3: 'A3 — 템플릿 + eval 동기화',
    A5: 'A5 — plugin.json ↔ package.json 버전 드리프트',
    A6: 'A6 — aitc.dev 링크 부재 검사 (opt-in, warn)',
    A7: 'A7 — mcpServers npx args 해석 가능성',
    A8: 'A8 — seam /ait:verb 형태·해석 가능성',
    A9: 'A9 — skill 본문 실제 주입 여부 (opt-in, BEHAVIOR)',
    A10: 'A10 — CHANGELOG.md 버전 섹션 존재',
    A11: 'A11 — 어댑터 manifest 정합성 (.cursor-plugin ↔ .claude-plugin)',
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
  // A6(aitc.dev 링크 부재 검사)·A9(skill 본문 실제 주입 여부)는 opt-in async
  // 검사 — CLI 진입점에서만 실행한다. 기본은 각 환경변수가 안 켜져 있어 즉시
  // skip 을 반환하고, runChecks 의 동기 계약(vitest wrapper 가 의존)은
  // 건드리지 않는다. A6 는 잔존 링크가 나와도 항상 warn 이라 exit code 에
  // 안 실리지만, A9 는 shadow 발견을 실제 회귀로 취급해야 하므로(가드가
  // "발견은 했지만 통과시켰다"가 되면 무의미하다) hasErrors 계산에 합류시킨다.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const a6 = await checkA6(root);
  const a9 = await checkA9(root);
  const all = [...violations, ...a6, ...a9];
  printViolations(all);
  const a9HasErrors = a9.some((v) => v.level === 'error');
  if (hasErrors || a9HasErrors) process.exit(1);
}
