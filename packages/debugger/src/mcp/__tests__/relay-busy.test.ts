/**
 * 먼저 붙은 미니앱이 이긴다 — REAL chii relay + real sockets.
 *
 * Pins:
 *   - 다른 호스트의 두 번째 target은 핸드셰이크 뒤 4409('relay-busy')로 닫히고 chii로 넘어가지 않는다;
 *   - 같은 호스트(재스캔)는 허용되고, 붙은 페이지가 없으면 허용된다;
 *   - 첫 target이 닫히면 다른 호스트도 다시 붙을 수 있다;
 *   - 정책 함수가 던지면 허용(fail-open);
 *   - SECRET-HANDLING: 관측 콜백·onWsUpgrade 어디에도 url/at/target id가 없다.
 */
import {
  RELAY_BUSY_CLOSE_CODE,
  RELAY_BUSY_REASON,
} from '@apps-in-toss/internal-protocol/relay-busy-close';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, type RelayWsUpgradeEvent, startChiiRelay } from '../chii-relay.js';
import { shouldRejectNewTarget } from '../target-busy.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const TEST_SECRET = 'deadbeef'.repeat(8);
const FOO =
  'https://foo.private-apps.tossmini.com/p?at=654321&relay=wss%3A%2F%2Fsecret-relay.example';
const BAR = 'https://bar.private-apps.tossmini.com/p?at=654321';

function targetUrl(port: number, id: string, pageUrl: string | null): string {
  const q = new URLSearchParams(pageUrl === null ? { title: 't' } : { url: pageUrl, title: 't' });
  return `ws://127.0.0.1:${port}/at/${generateTotp(TEST_SECRET)}/target/${id}?${q}`;
}

interface Outcome {
  opened: boolean;
  closeCode: number | null;
  closeReason: string;
  ws: WebSocket;
}

/** 업그레이드 결과를 본다: 열린 채 유지되면 closeCode는 null. */
function dial(url: string, settleMs = 300): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const out: Outcome = { opened: false, closeCode: null, closeReason: '', ws };
    ws.on('open', () => {
      out.opened = true;
    });
    ws.on('close', (code, reason) => {
      out.closeCode = code;
      out.closeReason = reason.toString();
    });
    ws.on('error', (err) => reject(err));
    setTimeout(() => resolve(out), settleMs);
  });
}

describe('relay busy rejection (first mini-app wins)', () => {
  let relay: ChiiRelay;
  const upgrades: RelayWsUpgradeEvent[] = [];
  const busy: Array<{ pageHost: string | null; attachedHosts: ReadonlyArray<string | null> }> = [];
  let policyThrows = false;

  beforeAll(async () => {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth was not built');
    relay = await startChiiRelay({
      port: 0,
      verifyAuth,
      shouldRejectTarget: (info) => {
        if (policyThrows) throw new Error('boom');
        return shouldRejectNewTarget(info);
      },
      onTargetRejectedBusy: (e) => busy.push(e),
      onWsUpgrade: (e) => upgrades.push(e),
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('keeps the first mini-app, closes a different host with 4409, and leaks nothing', async () => {
    const first = await dial(targetUrl(relay.port, 'first-id', FOO));
    expect(first.opened).toBe(true);
    expect(first.closeCode).toBeNull();

    upgrades.length = 0;
    busy.length = 0;
    const second = await dial(targetUrl(relay.port, 'second-id', BAR));
    expect(second.opened).toBe(true); // accept-then-close
    expect(second.closeCode).toBe(RELAY_BUSY_CLOSE_CODE);
    expect(second.closeCode).toBe(4409);
    expect(second.closeReason).toBe(RELAY_BUSY_REASON);
    // 먼저 붙은 쪽은 영향이 없다.
    expect(first.closeCode).toBeNull();

    expect(busy).toEqual([
      {
        pageHost: 'bar.private-apps.tossmini.com',
        attachedHosts: ['foo.private-apps.tossmini.com'],
      },
    ]);
    expect(upgrades).toEqual([{ kind: 'target', accepted: false }]);

    const dump = JSON.stringify({ busy, upgrades, reason: second.closeReason });
    expect(dump).not.toContain('654321');
    expect(dump).not.toContain('at=');
    expect(dump).not.toContain('secret-relay');
    expect(dump).not.toContain('second-id');
    expect(dump).not.toContain('/p');

    first.ws.close();
    second.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('allows a re-scan of the SAME host while the first is attached', async () => {
    const first = await dial(targetUrl(relay.port, 'same-1', FOO));
    busy.length = 0;
    const again = await dial(targetUrl(relay.port, 'same-2', FOO));
    expect(again.closeCode).not.toBe(RELAY_BUSY_CLOSE_CODE);
    expect(busy).toEqual([]);
    first.ws.close();
    again.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('allows a different host again once the first target has closed', async () => {
    const first = await dial(targetUrl(relay.port, 'gone-1', FOO));
    first.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    busy.length = 0;
    const next = await dial(targetUrl(relay.port, 'gone-2', BAR));
    expect(next.closeCode).not.toBe(RELAY_BUSY_CLOSE_CODE);
    expect(busy).toEqual([]);
    next.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('treats a missing url param as unknown host and allows it', async () => {
    const first = await dial(targetUrl(relay.port, 'nu-1', FOO));
    busy.length = 0;
    const noUrl = await dial(targetUrl(relay.port, 'nu-2', null));
    expect(noUrl.closeCode).not.toBe(RELAY_BUSY_CLOSE_CODE);
    expect(busy).toEqual([]);
    first.ws.close();
    noUrl.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('fails open when the policy throws', async () => {
    const first = await dial(targetUrl(relay.port, 'th-1', FOO));
    policyThrows = true;
    try {
      busy.length = 0;
      const second = await dial(targetUrl(relay.port, 'th-2', BAR));
      expect(second.closeCode).not.toBe(RELAY_BUSY_CLOSE_CODE);
      expect(busy).toEqual([]);
      second.ws.close();
    } finally {
      policyThrows = false;
    }
    first.ws.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
