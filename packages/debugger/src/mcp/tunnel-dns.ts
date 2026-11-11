/**
 * 막 만든 quick tunnel 호스트가 공개 DNS에서 풀릴 때까지 기다린다.
 *
 * `*.trycloudflare.com` 호스트는 cloudflared가 주소를 돌려준 뒤에도 15~60초 동안 폰이 쓰는 DNS에서
 * 풀리지 않을 수 있다. 그 사이에 QR을 보여 주고 attach 대기 시간을 재면, 폰이 relay에 닿기도 전에
 * 대기 한도가 줄어든다. 그래서 QR을 내기 전에 호스트 이름이 풀리는지 짧은 간격으로 확인한다.
 *
 * SECRET-HANDLING: 터널 호스트는 비밀이다. 이 모듈은 호스트를 로그·에러·알림 문구 어디에도 싣지
 * 않는다. 호출부가 받는 것은 불리언과 경과 시간뿐이다.
 */

import { resolve4 } from 'node:dns/promises';

/** 호스트가 풀릴 때까지 기다리는 최대 시간. 넘기면 풀리지 않은 채로 진행한다. */
export const TUNNEL_DNS_WAIT_MAX_MS = 60_000;
/** 해석 재시도 간격. */
export const TUNNEL_DNS_POLL_MS = 2_000;

/** 호스트 이름이 공개 DNS에서 풀리면 `true`. 에러는 전부 "아직"으로 본다. */
export async function dnsResolvesTunnelHost(host: string): Promise<boolean> {
  try {
    const addrs = await resolve4(host);
    return addrs.length > 0;
  } catch {
    return false;
  }
}

/** quick tunnel 호스트(`*.trycloudflare.com`)인지. 그 밖의 호스트는 기다리지 않는다. */
export function tunnelHostnameOf(wssUrl: string): string | null {
  try {
    const host = new URL(wssUrl).hostname.toLowerCase();
    return host.endsWith('.trycloudflare.com') ? host : null;
  } catch {
    return null;
  }
}

export interface WaitForTunnelDnsOptions {
  /** 호스트 해석기. 기본은 {@link dnsResolvesTunnelHost}. */
  resolveHost?: (host: string) => Promise<boolean>;
  signal?: AbortSignal;
  maxMs?: number;
  pollMs?: number;
  /** 첫 확인에서 안 풀렸을 때 한 번 부른다. 호스트는 넘기지 않는다. */
  onWaiting?: () => void;
  nowMs?: () => number;
}

export interface TunnelDnsWaitResult {
  /** 마지막 확인에서 풀렸는지. 한도에 닿았거나 취소되면 `false`. */
  resolved: boolean;
  /** 기다린 시간(ms). 처음부터 풀렸으면 0에 가깝다. */
  waitedMs: number;
  aborted: boolean;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * `wssUrl`의 호스트가 풀릴 때까지 `maxMs` 안에서 기다린다. quick tunnel 호스트가 아니면 바로
 * `resolved: true`로 돌아온다.
 */
export async function waitForTunnelDns(
  wssUrl: string,
  options: WaitForTunnelDnsOptions = {},
): Promise<TunnelDnsWaitResult> {
  const host = tunnelHostnameOf(wssUrl);
  const nowMs = options.nowMs ?? (() => Date.now());
  const startedAt = nowMs();
  if (host === null) return { resolved: true, waitedMs: 0, aborted: false };
  const resolveHost = options.resolveHost ?? dnsResolvesTunnelHost;
  const maxMs = options.maxMs ?? TUNNEL_DNS_WAIT_MAX_MS;
  const pollMs = options.pollMs ?? TUNNEL_DNS_POLL_MS;
  let notified = false;
  for (;;) {
    if (options.signal?.aborted) {
      return { resolved: false, waitedMs: nowMs() - startedAt, aborted: true };
    }
    let ok = false;
    try {
      ok = await resolveHost(host);
    } catch {
      ok = false;
    }
    if (ok) return { resolved: true, waitedMs: nowMs() - startedAt, aborted: false };
    const waited = nowMs() - startedAt;
    if (waited >= maxMs) return { resolved: false, waitedMs: waited, aborted: false };
    if (!notified) {
      notified = true;
      try {
        options.onWaiting?.();
      } catch {
        // 알림 실패는 대기를 깨뜨리지 않는다.
      }
    }
    await sleep(Math.min(pollMs, Math.max(0, maxMs - waited)), options.signal);
  }
}
