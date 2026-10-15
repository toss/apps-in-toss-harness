/**
 * attach 단계 기록기 + 진단 분류기 + relay 훅 어댑터 + progress 알림.
 *
 * 핵심 계약:
 *   - 기록기는 시도 단위 링 버퍼고, 구독자(`onStage`) 예외가 기록을 깨뜨리지 않는다.
 *   - `diagnoseAttach`는 우선순위 순서대로 원인을 가른다(표 테스트).
 *   - 어떤 표면에도 `at=`/`relay=` 값, relay URL이 새지 않는다.
 *   - progress 알림은 progressToken이 있을 때만, 단조 증가 `progress`로 나간다.
 */
import { describe, expect, it, vi } from 'vitest';
import { startAttachProgress } from '../attach-progress.js';
import {
  AttachTimeline,
  buildDashboardTimelineState,
  createRelayStageHooks,
  diagnoseAttach,
  formatStageHistory,
  formatStageLabel,
  sanitizePageUrl,
} from '../attach-timeline.js';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function freshAttempt(clock = makeClock()) {
  const tl = new AttachTimeline({ nowMs: clock.now });
  tl.beginAttempt();
  return { tl, clock };
}

describe('AttachTimeline', () => {
  it('numbers events and scopes snapshot().events to the current attempt', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.beginAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    const snap = tl.snapshot();
    expect(snap.attempt).toBe(2);
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]?.attempt).toBe(2);
  });

  it('keeps the last tunnel event across attempts', () => {
    const { tl } = freshAttempt();
    tl.record('tunnel', 'ok');
    tl.beginAttempt();
    expect(tl.snapshot().lastTunnel?.result).toBe('ok');
    tl.record('tunnel', 'down');
    expect(tl.snapshot().lastTunnel?.result).toBe('down');
  });

  it('matchesCurrentPage uses the latest page matcher and is false without one, with no pages, or on throw', () => {
    const tl = new AttachTimeline();
    const pages = [{ url: 'intoss-private://app?_deploymentId=a' }];
    expect(tl.matchesCurrentPage(pages)).toBe(false);
    tl.setPageMatcher((p) => p.some((x) => x.url.includes('_deploymentId=a')));
    expect(tl.matchesCurrentPage(pages)).toBe(true);
    expect(tl.matchesCurrentPage([])).toBe(false);
    expect(tl.matchesCurrentPage([{ url: 'intoss-private://app?_deploymentId=b' }])).toBe(false);
    tl.setPageMatcher(() => {
      throw new Error('boom');
    });
    expect(tl.matchesCurrentPage(pages)).toBe(false);
  });

  it('is a ring buffer (capacity bound)', () => {
    const tl = new AttachTimeline({ capacity: 3 });
    tl.beginAttempt();
    for (let i = 0; i < 10; i++) tl.record('qr-issued', 'ok', 'remint');
    expect(tl.snapshot().events).toHaveLength(3);
  });

  it('delivers events to onStage listeners and survives a throwing listener', () => {
    const { tl } = freshAttempt();
    const seen: string[] = [];
    tl.onStage(() => {
      throw new Error('boom');
    });
    const off = tl.onStage((e) => seen.push(e.stage));
    tl.record('device-handshake', 'ok');
    off();
    tl.record('auth', 'ok', 'script');
    expect(seen).toEqual(['device-handshake']);
    expect(tl.snapshot().events).toHaveLength(2);
  });
});

describe('diagnoseAttach — priority table', () => {
  it('tunnel-down wins over everything', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('target-connected', 'ok');
    tl.record('tunnel', 'down');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('tunnel-down');
  });

  it('not-started when no QR was issued this attempt', () => {
    const { tl } = freshAttempt();
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('not-started');
  });

  it('page-not-opened when the QR was issued but the phone never reached the relay', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    const d = diagnoseAttach(tl.snapshot());
    expect(d.kind).toBe('page-not-opened');
    expect(d.actions.join(' ')).toContain('X 버튼');
  });

  it('qr-expired when the last auth event was rejected', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('auth', 'rejected', 'ws-4401');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('qr-expired');
  });

  it('script-not-loaded when the handshake arrived but no target connected', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('device-handshake', 'ok');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('script-not-loaded');
  });

  it('wrong-page when a target connected but nothing matched', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('device-handshake', 'ok');
    tl.record('target-connected', 'ok');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('wrong-page');
  });

  it('session-dropped when the last connection event is a disconnect', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('target-connected', 'ok');
    tl.record('target-disconnected', 'ok');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('session-dropped');
  });

  it('attached when matched came after the connection', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('target-connected', 'ok');
    tl.record('matched', 'ok');
    const d = diagnoseAttach(tl.snapshot());
    expect(d.kind).toBe('attached');
    expect(d.actions).toEqual([]);
  });

  it('attached when the current page matches, even without a recorded matched event', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('target-connected', 'ok');
    // wait_for_attach=false 이후 늦게 붙은 경우: matched 기록이 없다.
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('wrong-page');
    const d = diagnoseAttach(tl.snapshot(), { matchesCurrentPage: true });
    expect(d.kind).toBe('attached');
    expect(d.actions).toEqual([]);
  });

  it('tunnel-down still wins over a matching page', () => {
    const { tl } = freshAttempt();
    tl.record('tunnel', 'down');
    tl.record('qr-issued', 'ok', 'mint');
    expect(diagnoseAttach(tl.snapshot(), { matchesCurrentPage: true }).kind).toBe('tunnel-down');
  });

  it('a rejected auth followed by a connection is not qr-expired', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('auth', 'rejected', 'http-401');
    tl.record('target-connected', 'ok');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('wrong-page');
  });

  it('puts observed pages into wrong-page/page-not-opened diagnoses with at/relay redacted', () => {
    const { tl } = freshAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    tl.record('target-connected', 'ok');
    const d = diagnoseAttach(tl.snapshot(), {
      observedPages: [
        { url: 'intoss-private://app?_deploymentId=old&at=123456&relay=wss://x.example#frag' },
      ],
    });
    const joined = JSON.stringify(d);
    expect(d.observedPages?.[0]).toContain('_deploymentId=old');
    expect(joined).not.toContain('123456');
    expect(joined).not.toContain('x.example');
    expect(joined).not.toContain('#frag');
  });
});

describe('sanitizePageUrl', () => {
  it('redacts at/relay values, drops the hash, and bounds the length', () => {
    const out = sanitizePageUrl(
      `https://h/p?a=1&at=654321&relay=wss%3A%2F%2Fh#x${'y'.repeat(200)}`,
    );
    expect(out).toBe('https://h/p?a=1&at=<redacted>&relay=<redacted>');
    expect(sanitizePageUrl(`https://h/${'z'.repeat(300)}`).length).toBeLessThanOrEqual(80);
  });
});

describe('createRelayStageHooks', () => {
  it('maps relay hooks to stages without carrying any URL', () => {
    const { tl } = freshAttempt();
    const hooks = createRelayStageHooks(tl);
    hooks.onAttachHandshake({ deviceProtocol: 1, deviceVersion: '0.1.0' } as never);
    hooks.onTargetScriptServed();
    hooks.onWsUpgrade({ kind: 'client', accepted: true });
    hooks.onWsUpgrade({ kind: 'target', accepted: false });
    hooks.onWsUpgrade({ kind: 'target', accepted: true });
    hooks.onAuthReject({ kind: 'ws-upgrade' } as never);
    hooks.onAuthReject({ kind: 'http-request' } as never);
    hooks.onTargetClose();
    const got = tl.snapshot().events.map((e) => `${e.stage}:${e.result}:${e.detail ?? ''}`);
    expect(got).toEqual([
      'device-handshake:ok:',
      'auth:ok:script',
      'target-connected:ok:',
      'auth:rejected:ws-4401',
      'auth:rejected:http-401',
      'target-disconnected:ok:',
    ]);
  });
});

describe('formatStageHistory / formatStageLabel', () => {
  it('prints elapsed seconds from the attempt start with fixed labels', () => {
    const clock = makeClock();
    const { tl } = freshAttempt(clock);
    tl.record('qr-issued', 'ok', 'mint');
    clock.advance(12_000);
    tl.record('device-handshake', 'ok');
    const lines = formatStageHistory(tl.snapshot());
    expect(lines[0]).toMatch(/^\+0s QR 발급됨/);
    expect(lines[1]).toMatch(/^\+12s 폰이 이번 QR의 페이지를 열었어요/);
    expect(formatStageLabel({ seq: 1, at: '', attempt: 1, stage: 'tunnel', result: 'down' })).toBe(
      '터널 끊김',
    );
  });
});

describe('buildDashboardTimelineState', () => {
  it('returns the last 12 stages and a session marker', () => {
    const { tl } = freshAttempt();
    for (let i = 0; i < 20; i++) tl.record('qr-issued', 'ok', 'remint');
    const state = buildDashboardTimelineState(tl, '2026-10-14T00:00:00.000Z', 'test-runner');
    expect(state.stages).toHaveLength(12);
    expect(state.session).toEqual({
      kind: 'test-runner',
      startedAt: '2026-10-14T00:00:00.000Z',
      pid: process.pid,
    });
  });
});

describe('startAttachProgress', () => {
  function setup(progressToken: string | number | undefined, heartbeatMs = 15_000) {
    vi.useFakeTimers();
    const clock = makeClock(Date.now());
    const tl = new AttachTimeline({ nowMs: () => Date.now() });
    tl.beginAttempt();
    const sent: Array<{ progress: number; message: string; progressToken: unknown }> = [];
    const progress = startAttachProgress({
      timeline: tl,
      progressToken,
      sendNotification: async (n) => {
        sent.push({ ...n.params });
      },
      totalSec: 180,
      nowMs: () => Date.now(),
      heartbeatMs,
    });
    void clock;
    return { tl, sent, progress };
  }

  it('does nothing without a progressToken', () => {
    const { tl, sent } = setup(undefined);
    tl.record('qr-issued', 'ok', 'mint');
    vi.advanceTimersByTime(60_000);
    expect(sent).toEqual([]);
    vi.useRealTimers();
  });

  it('sends on stage changes and on the 15s heartbeat, with monotonic progress', () => {
    const { tl, sent, progress } = setup('tok');
    tl.record('qr-issued', 'ok', 'mint');
    vi.advanceTimersByTime(15_000);
    tl.record('device-handshake', 'ok');
    vi.advanceTimersByTime(30_000);
    progress.stop();
    expect(sent.length).toBeGreaterThanOrEqual(4);
    expect(sent.every((s) => s.progressToken === 'tok')).toBe(true);
    const nums = sent.map((s) => s.progress);
    expect([...nums].sort((a, b) => a - b)).toEqual(nums);
    expect(new Set(nums).size).toBe(nums.length);
    const heartbeat = sent.find((s) => s.message.startsWith('QR 스캔 대기 중'));
    expect(heartbeat?.message).toMatch(/^QR 스캔 대기 중 \d+\/180초 — /);
    expect(sent.some((s) => s.message.includes('폰이 이번 QR의 페이지를 열었어요'))).toBe(true);
    vi.useRealTimers();
  });

  it('says the phone has not responded while no phone-side stage exists', () => {
    const { tl, sent, progress } = setup('tok');
    tl.record('qr-issued', 'ok', 'mint');
    vi.advanceTimersByTime(15_000);
    progress.stop();
    expect(sent.at(-1)?.message).toBe('QR 스캔 대기 중 15/180초 — 폰 응답 없음');
    vi.useRealTimers();
  });

  it('stops after stop() and never throws when sending fails', async () => {
    vi.useFakeTimers();
    const tl = new AttachTimeline();
    tl.beginAttempt();
    const send = vi.fn(async () => {
      throw new Error('transport closed');
    });
    const progress = startAttachProgress({
      timeline: tl,
      progressToken: 1,
      sendNotification: send,
      totalSec: 10,
    });
    expect(() => tl.record('qr-issued', 'ok', 'mint')).not.toThrow();
    progress.stop();
    tl.record('auth', 'ok', 'script');
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('stops when the signal aborts', () => {
    vi.useFakeTimers();
    const tl = new AttachTimeline();
    tl.beginAttempt();
    const ac = new AbortController();
    const send = vi.fn(async () => {});
    startAttachProgress({
      timeline: tl,
      progressToken: 'x',
      sendNotification: send,
      signal: ac.signal,
      totalSec: 10,
    });
    ac.abort();
    tl.record('qr-issued', 'ok', 'mint');
    vi.advanceTimersByTime(60_000);
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
