/**
 * MCP stdio 보호 — 데몬의 stdout은 JSON-RPC 전용이다.
 *
 * `console.log/info/debug`는 Node에서 stdout으로 간다. 데몬이 부르는 헬퍼나 의존성이 한 줄이라도
 * 찍으면 MCP 클라이언트가 JSON이 아닌 줄을 받아 파싱 에러를 낸다(실제 로그에서 start_attach 직후
 * 스택 트레이스 8줄이 stdout에 섞인 사례). 데몬 시작 시점에 이 세 메서드를 stderr로 돌린다.
 * `console.warn/error`는 원래 stderr라 건드리지 않는다.
 *
 * 포맷은 `util.format`으로 원래 console과 같게 유지한다.
 */

import { format } from 'node:util';

type ConsoleLike = Pick<Console, 'log' | 'info' | 'debug'>;

const REDIRECTED = Symbol.for('@apps-in-toss/debugger.stdout-guard');

/**
 * `console.log/info/debug`를 `write`(기본 `process.stderr.write`)로 돌린다. 이미 돌렸으면 아무것도
 * 하지 않는다(멱등).
 */
export function redirectConsoleToStderr(
  target: ConsoleLike = console,
  write: (chunk: string) => void = (chunk) => {
    process.stderr.write(chunk);
  },
): void {
  const marked = target as ConsoleLike & { [REDIRECTED]?: true };
  if (marked[REDIRECTED] === true) return;
  const redirect =
    () =>
    (...args: unknown[]): void => {
      write(`${format(...args)}\n`);
    };
  target.log = redirect();
  target.info = redirect();
  target.debug = redirect();
  marked[REDIRECTED] = true;
}
