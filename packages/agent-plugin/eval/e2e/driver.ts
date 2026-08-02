// eval/e2e — Suite B 드라이버
// ------------------------------------------------------------------
// 빈 격리 디렉토리에서 Claude Agent SDK 세션을 띄워 `/ait-new`(create-ait-app
// wrapper — 번들 설정 기본 포함, harness#6) → 번들 빌드(`.ait` 생성)까지의
// 멀티턴 완주를 1회 실행하고, 토큰 사용량(modelUsage)·턴 수·도달 station·실패
// 분류를 수집한다.
//
// 안전 불변(plan §3):
//   - **build-only가 기본** — 콘솔 API를 아예 안 부른다. 고정 dog-food 타겟 구조적 무접촉.
//   - 콘솔/인증을 변이시키는 Bash 명령(aitcc / ait deploy·register·login /
//     --api-key)은 절대 실행하지 않는다.
//   - **콘솔 MCP 도구(apps-in-toss-console)는 절대 호출하지 않는다** — 플러그인이
//     이 서버를 manifest 기본 포함(§1.4)하면서 생긴 새 leak path. miniapp_create가
//     매 run 새 miniAppId를 서버 발급·자동 기록 → 반-패턴.
//   - 시크릿 값은 어떤 출력에도 싣지 않는다.
//
// 격리(plan §2):
//   - 매 run `mktemp -d` 임시 cwd. 그 안에 `.claude/skills`→`shared/skills`,
//     `.claude/commands`→`shared/commands` symlink (검증된 setup-fixture 패턴).
//   - settingSources: ['project'] 로 그 `.claude/`를 로드. (빈 배열이면 /ait 사라짐.)
//   - permissionMode: 'bypassPermissions' — 격리 임시 디렉토리라 권한 프롬프트 없이
//     파일 생성·Bash 실행 허용.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { type CanUseTool, query } from '@anthropic-ai/claude-agent-sdk';
import { classifyFailure, scoreBuildOnly } from './score.ts';
import type { RunRecord, Task } from './types.ts';

const execFileAsync = promisify(execFile);

// repo root = eval/e2e/ 에서 두 단계 위.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SKILLS_SRC = join(REPO_ROOT, 'shared', 'skills');
const COMMANDS_SRC = join(REPO_ROOT, 'shared', 'commands');

// 프롬프트가 시킬 슬래시 명령. **basename 이 곧 키**이고, 그 앞에 형상별 접두가
// 붙는다 — 설치 형상은 `ait:<basename>`(사용자가 치는 `/ait:new`), 이 드라이버가
// 쓰는 project 형상은 접두 없이 `<basename>`. 공백 형태 `/ait new` 는 어느
// 형상에도 없다 (`Unknown command: /ait` — 2026-07-27 실측, issue #226·#286).
// `exposesKey` 가 두 형상을 모두 받아주므로 여기엔 맨 basename 을 둔다.
//
// 문서 표면과 같은 지점을 재려고 **문서가 안내하는 verb** 를 그대로 쓴다:
// `/ait:new` → `shared/commands/new.md`. 번들 설정(granite.config.ts)은
// 정본 경로(create-ait-app)에 기본 포함되므로 별도 skill 디스패치가 필요 없다
// (aitcc 전제 skill 4종 register/deploy/status/setup-bundle 제거 — harness
// aitcc 정리).
const DISPATCH_COMMAND = 'new';

// 콘솔/인증을 변이시키는 Bash 명령 패턴 — canUseTool 게이트가 결정적으로 차단한다.
// `ait deploy`/`ait register`/`ait login`은 번들러(`@apps-in-toss/cli`) 자체의
// API-key 기반 콘솔 접촉 서브명령이라 register/deploy 등 skill 유무와 무관하게
// 여전히 실재하는 위험 경로다(명령 문자열을 직접 검사해 거부). 고정 dog-food
// 타겟 앱·워크스페이스에 닿는 모든 경로를 build-only 측정에서 구조적으로
// 차단하는 것이 목적(§1.4 "register 자율 디스패치 금지"). 콘솔 MCP 도구
// (apps-in-toss-console)는 Bash가 아니라 별도 canUseTool 분기(아래
// isConsoleMcpTool)가 차단한다.
//
// 매칭은 보수적으로 넓게: `aitcc` 전체(콘솔 자동화 CLI 전부 — harness에서는
// 제거됐지만 모델이 훈련 지식으로 시도할 수 있어 방어로 유지), `ait deploy`/
// `ait register`/`ait login`(번들러의 콘솔-접촉 서브명령), 그리고 Deploy Key 를
// 싣는 `--api-key`. 번들 빌드 경로(`ait build`, `pnpm run build`,
// `pnpm bundle:ait`, `pnpm install`, `pnpm dlx create-ait-app …` 등)는
// 매칭하지 않는다.
const FORBIDDEN_BASH_PATTERNS: readonly RegExp[] = [
  /\baitcc\b/, // 콘솔 자동화 CLI 전체 (register/deploy/app/keys/me/workspace …)
  /\bait\s+deploy\b/, // 번들러의 콘솔 업로드/검수 제출
  /\bait\s+register\b/, // (혹시 모를) 등록 서브명령
  /\bait\s+login\b/, // 콘솔 인증
  /--api-key\b/, // Deploy Key 를 싣는 모든 호출
] as const;

/**
 * `query()`에 그대로 넘기는 정적 차단 목록 — canUseTool 게이트의 심층 방어선.
 *
 * 여기 적힌 `mcp__<serverKey>` prefix는 **실제로 등록되는 서버 키와 문자 단위로
 * 일치해야** 한다. 한쪽이 개명되면 매치가 조용히 풀려 차단이 무력화되므로,
 * `driver.test.ts`가 이 배열을 skill/manifest의 서버 키와 대조한다.
 */
export const STATIC_DISALLOWED_TOOLS = ['mcp__ait-devtools', 'mcp__apps-in-toss-console'];

/**
 * Bash 명령 문자열이 콘솔/인증 변이 경로인지 판정한다 (순수 함수 — 단위 테스트 대상).
 * true 면 canUseTool 게이트가 거부하고 run 을 forbidden-dispatch 로 종료한다.
 */
export function isForbiddenBashCommand(command: string): boolean {
  return FORBIDDEN_BASH_PATTERNS.some((re) => re.test(command));
}

// 콘솔 MCP 서버(`apps-in-toss-console`, `.claude-plugin/plugin.json` manifest 기본
// 포함)로 가는 모든 tool 호출 식별 — canUseTool 게이트가 결정적으로 차단한다.
// Claude Code MCP tool 이름은 `mcp__<server-key>__<tool>` 형태이므로 서버 키
// prefix로 판정한다(`miniapp_create`/`bundle_upload`/`bundle_upload_complete`/
// `miniapp_get_status` 등 도구 이름이 늘어나도 이 판정은 그대로 유효하다).
// docs MCP(`apps-in-toss-docs`, searchDocumentation/getPage)는 읽기 전용·콘솔
// 무변이라 차단 대상이 아니다.
const CONSOLE_MCP_SERVER_PREFIX = 'mcp__apps-in-toss-console__';

/**
 * tool 이름이 콘솔 MCP 서버(apps-in-toss-console) 소속인지 판정한다 (순수 함수 —
 * 단위 테스트 대상). true 면 canUseTool 게이트가 거부하고 run 을
 * forbidden-dispatch 로 종료한다.
 */
export function isConsoleMcpTool(toolName: string): boolean {
  return toolName.startsWith(CONSOLE_MCP_SERVER_PREFIX);
}

/**
 * init 메시지의 `slash_commands`/`skills` 목록에 특정 키가 노출됐는지 (순수 함수 —
 * 단위 테스트 대상). 키는 command 파일의 basename이고, 플러그인으로 얹히면 앞에
 * `<plugin>:`이 붙는다 — 두 형상 모두 같은 코드로 판정하려고 `:` suffix도 허용한다.
 * 부분 문자열 매칭은 하지 않는다: `ait-new`가 `ait-new-thing`에 걸리면 안 된다.
 */
export function exposesKey(list: readonly string[], name: string): boolean {
  return list.some((key) => key === name || key.endsWith(`:${name}`));
}

export interface DriverOptions {
  task: Task;
  model: string;
  /** 0-based 반복 인덱스 (라벨·로그용). */
  iteration: number;
  /** run 종료 후 격리 디렉토리를 지우지 않고 보존 (디버깅). */
  keep?: boolean;
  /** init 메시지의 slash_commands/skills 키를 stderr로 로깅 (첫 실행 정밀화용). */
  logInit?: boolean;
  /** 안전 상한. 초과 시 error_max_turns 로 종료. */
  maxTurns?: number;
  /**
   * Anthropic-호환 게이트웨이(LiteLLM 등) base URL. 주면 provider='gateway'로
   * 비-Anthropic 모델(Qwen 등)에 라우팅한다. 없으면 first-party Anthropic.
   * SDK는 options.model에 endpoint를 안 받으므로 ANTHROPIC_BASE_URL 환경변수로 꽂는다.
   */
  baseUrl?: string;
  /**
   * gateway 인증 토큰을 담은 환경변수 *이름* (값 아님 — 값은 로그/레코드에 절대
   * 안 싣는다). 예: 'OPENROUTER_API_KEY'. driver가 그 값을 ANTHROPIC_AUTH_TOKEN으로
   * 전달한다. 미지정이면 ANTHROPIC_API_KEY를 그대로 쓴다.
   */
  authTokenEnv?: string;
}

/** 격리 cwd에 .claude/{skills,commands} symlink를 깐다 (setup-fixture.sh 패턴). */
function linkClaudeDir(cwd: string): void {
  const claudeDir = join(cwd, '.claude');
  // mkdtemp 디렉토리는 이미 비어 있으므로 정리 불필요 — 바로 symlink.
  symlinkSync(SKILLS_SRC, join(claudeDir, 'skills'), 'dir');
  symlinkSync(COMMANDS_SRC, join(claudeDir, 'commands'), 'dir');
}

/**
 * 한 번의 완주 run을 실행한다. 절대 throw하지 않는다 — 실패는 RunRecord의
 * success:false + failClass로 표현해 호출자가 통계에 넣는다.
 */
export async function runOnce(opts: DriverOptions): Promise<RunRecord> {
  const { task, model, iteration } = opts;
  const maxTurns = opts.maxTurns ?? 60;
  const startedAt = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), `ait-e2e-${task.id}-`));

  // 공급자 축. baseUrl이 있으면 gateway(비-Anthropic), 없으면 first-party.
  const provider: RunRecord['provider'] = opts.baseUrl ? 'gateway' : 'anthropic';
  const baseUrl = opts.baseUrl ?? null;

  // SDK env — process.env를 spread하고 게이트웨이 라우팅 변수를 덮어쓴다.
  // SDK는 env를 process.env와 자동 머지하지 않으므로 직접 spread한다.
  // 시크릿(토큰 값)은 env로만 전달하고 RunRecord/로그엔 절대 안 싣는다.
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (opts.baseUrl) {
    childEnv.ANTHROPIC_BASE_URL = opts.baseUrl;
    // 인증 토큰: 지정된 환경변수 *이름*에서 값을 읽어 ANTHROPIC_AUTH_TOKEN으로 전달.
    // 값 자체는 여기서만 만지고 어디에도 출력하지 않는다.
    if (opts.authTokenEnv) {
      const tok = process.env[opts.authTokenEnv];
      if (tok) childEnv.ANTHROPIC_AUTH_TOKEN = tok;
    }
  }

  // 누적 신호.
  let initSeen = false;
  let initOk = false;
  let turns = 0;
  let modelUsage: RunRecord['modelUsage'] = {};
  let totalCostUsd = 0;
  let resultSubtype = '';
  let isError = false;
  let initSlashCommands: string[] = [];
  let initSkills: string[] = [];
  // canUseTool 게이트가 콘솔/인증 변이 Bash 명령을 거부했는지 — failClass 결정용.
  let forbiddenDispatchAttempted = false;

  // 결정적 권한 게이트. permissionMode 를 bypassPermissions 로 두면 이 콜백이
  // 호출되지 않을 수 있으므로(모든 검사 우회), bypass 를 끄고 canUseTool 을
  // 권위 있는 관문으로 삼는다 — 격리 temp cwd 안의 안전한 작업(파일 쓰기·번들
  // 빌드 Bash)은 전부 allow 하되, 콘솔/인증 변이 Bash 와 콘솔 MCP 도구 호출은
  // 결정적으로 deny 한다.
  const canUseTool: CanUseTool = async (toolName, input) => {
    if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : '';
      if (isForbiddenBashCommand(command)) {
        forbiddenDispatchAttempted = true;
        // interrupt: true → run 을 즉시 중단. SECRET-HANDLING: 거부 메시지에
        // 명령 문자열(--api-key 값 등 시크릿 포함 가능)을 싣지 않는다.
        return {
          behavior: 'deny',
          message:
            'build-only 측정 경로에서 콘솔/인증 변이 명령(aitcc / ait deploy·register·login / --api-key)은 금지됩니다.',
          interrupt: true,
        };
      }
    }
    // 콘솔 MCP 도구(apps-in-toss-console) 차단 — 플러그인이 이 서버를 manifest
    // 기본 포함하면서 생긴 새 leak path. disallowedTools(아래)로도 정적 차단하지만,
    // 이 콜백이 권위 있는 관문이라 여기서도 결정적으로 deny한다(defense-in-depth).
    if (isConsoleMcpTool(toolName)) {
      forbiddenDispatchAttempted = true;
      return {
        behavior: 'deny',
        message: 'build-only 측정 경로에서 콘솔 MCP 도구(apps-in-toss-console) 호출은 금지됩니다.',
        interrupt: true,
      };
    }
    return { behavior: 'allow', updatedInput: input };
  };

  try {
    await mkdir(join(workDir, '.claude'), { recursive: true });
    linkClaudeDir(workDir);

    // build-only happy-path 프롬프트. 자연어 안내 + 명시적 슬래시 명령 디스패치.
    // 콘솔/인증/배포 명령은 금지 — 번들 빌드(.ait 생성)에서 멈춘다.
    const prompt = [
      `너는 빈 디렉토리에 있다. 아래 미니앱 아이디어를 앱인토스 미니앱으로 scaffold하고`,
      `로컬 번들(.ait)까지 빌드해라. 다음 순서로 진행한다:`,
      ``,
      `1. \`/${DISPATCH_COMMAND} ${task.appName}\` 로 프로젝트를 생성한다.`,
      `2. 생성된 프로젝트 디렉토리에서 package.json 의 번들 빌드 스크립트로 \`.ait\` 번들을 생성한다`,
      `   — \`pnpm run build\` (= \`ait build\`, create-ait-app 산출물) 또는 \`pnpm bundle:ait\`.`,
      ``,
      `아이디어: ${task.prompt}`,
      ``,
      `중요 제약:`,
      `- 콘솔 등록/업로드/로그인은 절대 하지 않는다. \`aitcc\`/\`ait deploy\`/\`ait register\`/`,
      `  \`ait login\` 같은 명령을 어떤 형태로도 실행하지 마라.`,
      `- 콘솔 MCP 도구(apps-in-toss-console — miniapp_create/bundle_upload/`,
      `  bundle_upload_complete/miniapp_get_status 등)도 호출하지 마라.`,
      `- 번들(.ait)이 생성되면 완료다. 거기서 멈춘다.`,
      `- dev 서버(\`pnpm dev\`)는 띄우지 않는다 — 측정은 번들 빌드에서 끝난다.`,
      `- 막혀도 멈추지 말고 다음 단계를 시도한다.`,
    ].join('\n');

    const response = query({
      prompt,
      options: {
        model,
        cwd: workDir,
        settingSources: ['project'],
        // permissionMode 를 bypassPermissions 로 두지 않는다 — 그러면 canUseTool
        // 게이트가 우회돼 콘솔 변이 Bash 가 그대로 실행될 수 있다(이 콜백이 유일한
        // 결정적 관문). canUseTool 이 격리 temp cwd 안의 안전 작업을 전부 allow 하므로
        // bypass 없이도 권한 프롬프트로 멈추지 않는다.
        canUseTool,
        maxTurns,
        // gateway 라우팅 변수가 들어간 환경. anthropic이면 process.env 그대로.
        env: childEnv,
        // 심층 방어: in-app debug MCP 표면과 콘솔 MCP 표면 모두 정적으로도 금지
        // (build-only 경로에 불필요). 실제 결정적 차단은 위 canUseTool 의 Bash
        // 검사 + isConsoleMcpTool 검사가 담당한다 — 이 배열은 추가 방어선이다.
        disallowedTools: STATIC_DISALLOWED_TOOLS,
      },
    });

    for await (const message of response) {
      if (message.type === 'system' && message.subtype === 'init') {
        initSeen = true;
        initSlashCommands = message.slash_commands ?? [];
        initSkills = message.skills ?? [];
        // 키 표현은 확정됐다 (2026-07-27 실측, issue #226·#286): slash-command
        // 키는 **command 파일의 basename**이다 — `new`, `plan`, `debug`.
        // `"ait new"`(다단어)도 `"ait"`(단일 prefix)도 아니다. 플러그인으로 얹히면
        // 앞에 `<plugin>:`이 붙어 `ait:new`가 된다. 이 드라이버는 project
        // `.claude/commands` 형상이라 접두어 없는 쪽이지만, 같은 코드가 설치
        // 형상에서도 통하도록 `:` suffix 매칭을 함께 허용한다.
        // skill 도 같은 목록에 오르므로(`ait:plan` 등) stub 없는 verb 도 이 검사를
        // 통과한다.
        initOk =
          exposesKey(initSlashCommands, DISPATCH_COMMAND) && exposesKey(initSkills, 'new-miniapp');
        if (opts.logInit) {
          process.stderr.write(
            `[init] slash_commands=${JSON.stringify(initSlashCommands)}\n` +
              `[init] skills=${JSON.stringify(initSkills)}\n`,
          );
        }
        continue;
      }

      if (message.type === 'assistant') {
        turns += 1;
        continue;
      }

      if (message.type === 'result') {
        resultSubtype = message.subtype;
        isError = message.is_error;
        // modelUsage 는 SDK가 이미 message.id dedup한 누적값 — 직접 합산보다 신뢰.
        modelUsage = message.modelUsage ?? {};
        totalCostUsd = message.total_cost_usd ?? 0;
        if (typeof message.num_turns === 'number') turns = message.num_turns;
        break;
      }
    }

    // 결정적 채점 (콘솔 무접촉 — 파일 존재 + dep + build exit code).
    const score = await scoreBuildOnly({ workDir, task, execFileAsync });

    const wallMs = Date.now() - startedAt;
    // 금지 명령을 시도한 run 은 게이트가 interrupt 했으므로 success 가 될 수 없다 —
    // canUseTool 차단이 우선이라 명시적으로 실패 처리하고 forbidden-dispatch 로 분류.
    const success = score.success && !isError && !forbiddenDispatchAttempted;
    const failClass = success
      ? null
      : forbiddenDispatchAttempted
        ? 'forbidden-dispatch'
        : classifyFailure({ initSeen, initOk, resultSubtype, score });

    return {
      ts: startedAt,
      taskId: task.id,
      model,
      provider,
      baseUrl,
      iteration,
      success,
      station: score.station,
      failClass,
      modelUsage,
      totalCostUsd,
      turns,
      wallMs,
      resultSubtype,
      initSlashCommands: opts.logInit ? initSlashCommands : undefined,
    };
  } catch (err) {
    // SDK/심링크/예기치 못한 throw — driver-error 로 기록하고 통계 유지.
    const wallMs = Date.now() - startedAt;
    return {
      ts: startedAt,
      taskId: task.id,
      model,
      provider,
      baseUrl,
      iteration,
      success: false,
      station: 'none',
      failClass: 'driver-error',
      modelUsage,
      totalCostUsd,
      turns,
      wallMs,
      resultSubtype: resultSubtype || 'driver-throw',
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (!opts.keep) {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // 정리 실패는 무시 — 측정 결과에 영향 없음.
      }
    } else {
      process.stderr.write(`[keep] ${workDir}\n`);
    }
  }
}
