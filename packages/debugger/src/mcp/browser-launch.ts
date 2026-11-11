/**
 * 브라우저를 여는 OS 명령(`open`, `xdg-open` 등) 한 개를 비동기로 실행하는 공용 헬퍼.
 *
 * 예전에는 `spawnSync(..., { timeout: 5000 })`로 후보 체인을 돌렸다. 이 방식은 두 가지가
 * 문제였다. (1) 브라우저가 콜드 스타트하거나 래퍼가 느려 5초를 넘기면 타임아웃이 실패로
 * 집계돼, 같은 URL을 Safari·Chrome·Firefox로 다시 열었다. 기본 브라우저와 다른 브라우저가
 * 뜨고 탭이 중복됐다. (2) 후보마다 최대 5초씩 데몬 이벤트 루프를 막아 MCP·relay 트래픽이
 * 멈췄다.
 *
 * 지금은 `spawn`으로 이벤트 루프를 막지 않고 결과를 셋으로 나눈다.
 *   - `opened`: 종료 코드 0이고 stderr에 실행 실패 시그널이 없다.
 *   - `slow`: 제한 시간 안에 끝나지 않았다. 실행 파일이 있고 동작 중이라는 뜻이므로 열린
 *     것으로 본다. 프로세스를 죽이지 않고 놓아 주며(`unref`), 다음 후보나 재시도는 하지 않는다.
 *   - `failed`: spawn 오류(ENOENT 등), 0이 아닌 종료 코드, 실패 stderr. 호출자가 다음 후보를 시도한다.
 */

import { spawn } from 'node:child_process';
import { childProcessEnv } from './child-env.js';

/** 후보 한 개를 기다리는 기본 제한 시간(ms). */
export const BROWSER_LAUNCH_TIMEOUT_MS = 5_000;

export interface BrowserLaunchResult {
  outcome: 'opened' | 'slow' | 'failed';
  /** 그때까지 모인 stderr(redact 전). `failed`/`opened`에서 요약에 쓴다. */
  stderr: string;
  /** spawn 자체가 실패했을 때의 메시지. */
  errorMessage?: string;
}

export function launchBrowserCommand(
  cmd: string,
  args: string[],
  isFailureStderr: (stderr: string) => boolean,
  timeoutMs: number = BROWSER_LAUNCH_TIMEOUT_MS,
): Promise<BrowserLaunchResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: childProcessEnv(),
      });
    } catch (err) {
      resolve({
        outcome: 'failed',
        stderr: '',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stderr = '';
    let exitCode: number | null | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: BrowserLaunchResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const judge = (code: number | null): BrowserLaunchResult => ({
      outcome: code === 0 && !isFailureStderr(stderr) ? 'opened' : 'failed',
      stderr,
    });

    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (err: Error) => {
      finish({ outcome: 'failed', stderr, errorMessage: err.message });
    });
    child.once('exit', (code: number | null) => {
      exitCode = code;
    });
    // stderr가 다 비워진 뒤에 판단하려고 exit가 아니라 close를 기다린다.
    child.once('close', (code: number | null) => {
      finish(judge(code));
    });

    timer = setTimeout(() => {
      if (settled) return;
      if (exitCode !== undefined) {
        // 이미 끝났는데 stderr 파이프만 다른 프로세스가 쥐고 있는 경우.
        finish(judge(exitCode));
        return;
      }
      // 아직 실행 중: 느릴 뿐 실행기는 동작한다. 죽이지 않고 놓아 준다.
      finish({ outcome: 'slow', stderr });
      child.unref();
      child.stderr?.destroy();
    }, timeoutMs);
  });
}
