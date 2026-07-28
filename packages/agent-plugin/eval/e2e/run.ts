#!/usr/bin/env -S tsx
// eval/e2e — Suite B 진입점
// ------------------------------------------------------------------
// 사용:
//   pnpm eval:e2e --task timer --model claude-haiku-4-5 --n 5
//   op run --env-file=.env.eval -- pnpm eval:e2e --task timer --model haiku --n 5
//
// 인자:
//   --task <id>       tasks/<id>.task.json (필수)
//   --model <id>      모델 alias 또는 full id (기본 claude-haiku-4-5 — 비용 floor)
//   --n <int>         반복 횟수 (기본 3)
//   --max-turns <int> 안전 상한 (기본 60)
//   --keep            실패 디버깅용 격리 디렉토리 보존
//   --log-init        첫 run의 init slash_commands/skills 키를 stderr로 출력
//
// 안전(plan §3): build-only 전용. 콘솔 무접촉. register/deploy/auth 디스패치 없음.
// runtime telemetry 아님 — 메인테이너가 수동으로 돌리는 오프라인 harness.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOnce } from './driver.ts';
import { formatSummary, summarizeCell } from './report.ts';
import type { Pricing, RunRecord, Task } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

interface Args {
  task: string;
  model: string;
  n: number;
  maxTurns: number;
  keep: boolean;
  logInit: boolean;
  /** Anthropic-호환 게이트웨이 base URL (Qwen 등 비-Anthropic). 없으면 first-party. */
  baseUrl: string;
  /** gateway 인증 토큰을 담은 환경변수 *이름* (값 아님). 기본 ANTHROPIC_API_KEY. */
  authTokenEnv: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    task: '',
    model: 'claude-haiku-4-5',
    n: 3,
    maxTurns: 60,
    keep: false,
    logInit: false,
    baseUrl: '',
    authTokenEnv: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--task':
        out.task = argv[++i] ?? '';
        break;
      case '--model':
        out.model = argv[++i] ?? out.model;
        break;
      case '--n':
        out.n = Number.parseInt(argv[++i] ?? '3', 10);
        break;
      case '--max-turns':
        out.maxTurns = Number.parseInt(argv[++i] ?? '60', 10);
        break;
      case '--keep':
        out.keep = true;
        break;
      case '--log-init':
        out.logInit = true;
        break;
      case '--base-url':
        out.baseUrl = argv[++i] ?? '';
        break;
      case '--auth-token-env':
        out.authTokenEnv = argv[++i] ?? '';
        break;
      default:
        process.stderr.write(`알 수 없는 인자: ${a}\n`);
    }
  }
  return out;
}

function loadTask(id: string): Task {
  const path = join(HERE, 'tasks', `${id}.task.json`);
  const task = JSON.parse(readFileSync(path, 'utf8')) as Task;
  if (task.endpoint !== 'build-only') {
    throw new Error(
      `task ${id} 의 endpoint=${task.endpoint} — P1 드라이버는 build-only만 지원한다.`,
    );
  }
  return task;
}

function loadPricing(): Pricing {
  return JSON.parse(readFileSync(join(HERE, 'pricing.json'), 'utf8')) as Pricing;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) {
    process.stderr.write('필수: --task <id> (예: --task timer)\n');
    process.exit(2);
  }
  // 인증 토큰: gateway면 --auth-token-env가 가리키는 환경변수, 아니면 ANTHROPIC_API_KEY.
  // 토큰 *값*은 driver가 env로만 전달하고 어디에도 출력하지 않는다 — 여기선 존재만 본다.
  const tokenEnvName = args.authTokenEnv || 'ANTHROPIC_API_KEY';
  if (!process.env[tokenEnvName]) {
    process.stderr.write(
      `${tokenEnvName} 미설정 — op run --env-file=.env.eval -- pnpm eval:e2e ... 로 주입하라.\n`,
    );
    process.exit(2);
  }

  const task = loadTask(args.task);
  const pricing = loadPricing();

  const resultsDir = join(HERE, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const runsPath = join(resultsDir, 'runs.jsonl');

  const provider = args.baseUrl ? `gateway(${args.baseUrl})` : 'anthropic';
  process.stderr.write(
    `eval:e2e — task=${task.id} model=${args.model} provider=${provider} ` +
      `n=${args.n} (build-only, 콘솔 무접촉)\n`,
  );
  if (args.baseUrl) {
    process.stderr.write(
      '  [주의] gateway 경로 — 슬래시 디스패치·캐시 토큰 계약 미검증(실험적). ' +
        '캐시 기반 USD는 무의미할 수 있다.\n',
    );
  }

  const runs: RunRecord[] = [];
  for (let i = 0; i < args.n; i++) {
    process.stderr.write(`  [${i + 1}/${args.n}] 실행 중…\n`);
    const rec = await runOnce({
      task,
      model: args.model,
      iteration: i,
      keep: args.keep,
      logInit: args.logInit && i === 0,
      maxTurns: args.maxTurns,
      baseUrl: args.baseUrl || undefined,
      authTokenEnv: args.authTokenEnv || undefined,
    });
    runs.push(rec);
    appendFileSync(runsPath, `${JSON.stringify(rec)}\n`);
    process.stderr.write(
      `      → ${rec.success ? 'PASS' : `FAIL(${rec.failClass})`} ` +
        `station=${rec.station} turns=${rec.turns} ${(rec.wallMs / 1000).toFixed(0)}s\n`,
    );
  }

  const summary = summarizeCell(runs, task.id, args.model, pricing);
  process.stdout.write(`\n${formatSummary(summary)}\n`);
  process.stderr.write(`\nraw → ${runsPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`eval:e2e 실패: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
