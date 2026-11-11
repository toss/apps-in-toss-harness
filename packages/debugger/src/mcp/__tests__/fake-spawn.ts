/**
 * `node:child_process`의 `spawn`을 mock하는 테스트가 쓰는 가짜 자식 프로세스.
 * 실제 spawnSync 결과와 같은 모양의 기술자(`status`·`stderr`·`error`)로 만든다.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

export interface FakeChildSpec {
  /** 종료 코드. */
  status?: number | null;
  stderr?: string;
  /** 있으면 spawn 'error'(ENOENT 등)를 낸다. */
  error?: Error | null;
  /** true면 종료하지 않고 계속 실행 중인 프로세스를 흉내 낸다(느린 실행기). */
  hang?: boolean;
}

export type FakeChild = EventEmitter & {
  stderr: PassThrough;
  unref: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

export function fakeChild(spec: FakeChildSpec = {}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stderr = new PassThrough();
  child.unref = vi.fn();
  child.kill = vi.fn();
  if (spec.hang) return child;
  setImmediate(() => {
    if (spec.error) {
      child.emit('error', spec.error);
      return;
    }
    if (spec.stderr) child.stderr.write(spec.stderr);
    child.stderr.end();
    const code = spec.status ?? 0;
    child.emit('exit', code, null);
    child.emit('close', code, null);
  });
  return child;
}
