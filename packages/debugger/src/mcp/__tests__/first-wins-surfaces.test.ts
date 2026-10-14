/**
 * "먼저 붙은 미니앱이 이긴다"의 표면들 — refreshTargets 안전망, 타임라인·진단·라벨,
 * 로그 키, 대시보드, 끊김 원인 메시지.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AttachTimeline,
  buildDashboardTimelineState,
  createRelayStageHooks,
  diagnoseAttach,
  formatStageLabel,
} from '../attach-timeline.js';
import { ChiiCdpConnection } from '../chii-connection.js';
import {
  attachTimeoutMessage,
  classifyToolError,
  describeDetach,
  pageMissingError,
} from '../errors.js';
import { logInfo } from '../log.js';
import { type DashboardState, startQrHttpServer } from '../qr-http-server.js';

const FOO_URL = 'https://foo.private-apps.tossmini.com/p?at=111111';
const BAR_URL = 'https://bar.private-apps.tossmini.com/p?at=222222';

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChiiCdpConnection.refreshTargets — first-wins guard', () => {
  function stubTargets(list: Array<{ id: string; url: string }>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ targets: list.map((t) => ({ ...t, title: '' })) }),
      })),
    );
  }

  it('keeps the attached target and reports a busy rejection for a different host (once)', async () => {
    const busy: Array<{ rejectedHost: string | null; attachedHost: string | null }> = [];
    const conn = new ChiiCdpConnection({
      relayBaseUrl: 'http://127.0.0.1:1',
      onTargetRejectedBusy: (e) => busy.push(e),
    });
    stubTargets([{ id: 't-foo', url: FOO_URL }]);
    await conn.refreshTargets();
    expect(conn.listTargets().map((t) => t.id)).toEqual(['t-foo']);

    stubTargets([
      { id: 't-foo', url: FOO_URL },
      { id: 't-bar', url: BAR_URL },
    ]);
    await conn.refreshTargets();
    await conn.refreshTargets();
    expect(conn.listTargets().map((t) => t.id)).toEqual(['t-foo']);
    expect(busy).toEqual([
      {
        rejectedHost: 'bar.private-apps.tossmini.com',
        attachedHost: 'foo.private-apps.tossmini.com',
      },
    ]);
    expect(JSON.stringify(busy)).not.toContain('222222');
  });

  it('still lets the same host replace the active target (newest wins)', async () => {
    const busy: unknown[] = [];
    const conn = new ChiiCdpConnection({
      relayBaseUrl: 'http://127.0.0.1:1',
      onTargetRejectedBusy: (e) => busy.push(e),
    });
    stubTargets([{ id: 't-1', url: FOO_URL }]);
    await conn.refreshTargets();
    stubTargets([
      { id: 't-1', url: FOO_URL },
      { id: 't-2', url: `${FOO_URL}&x=1` },
    ]);
    await conn.refreshTargets();
    expect(conn.listTargets().map((t) => t.id)).toEqual(['t-2']);
    expect(busy).toEqual([]);
  });

  it('switches to a different host once the attached target is gone', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:1' });
    stubTargets([{ id: 't-foo', url: FOO_URL }]);
    await conn.refreshTargets();
    stubTargets([{ id: 't-bar', url: BAR_URL }]);
    await conn.refreshTargets();
    expect(conn.listTargets().map((t) => t.id)).toEqual(['t-bar']);
  });
});

describe('busy rejection on the attach timeline', () => {
  function busyTimeline() {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    tl.beginAttempt();
    tl.record('qr-issued', 'ok', 'mint');
    createRelayStageHooks(tl).onTargetRejectedBusy({
      pageHost: 'bar.private-apps.tossmini.com',
      attachedHosts: ['foo.private-apps.tossmini.com'],
    });
    return { tl, clock };
  }

  it('records target-rejected-busy with first-DNS-label apps only', () => {
    const { tl } = busyTimeline();
    const ev = tl.snapshot().events.at(-1);
    expect(ev).toMatchObject({
      stage: 'target-rejected-busy',
      result: 'rejected',
      apps: { rejected: 'bar', attached: 'foo' },
    });
    expect(JSON.stringify(tl.snapshot())).not.toContain('tossmini');
    expect(formatStageLabel(ev!)).toBe('bar 미니앱의 연결을 거부했어요 (foo이 먼저 연결돼 있어요)');
  });

  it('diagnoseAttach names both apps and the action', () => {
    const { tl } = busyTimeline();
    const d = diagnoseAttach(tl.snapshot());
    expect(d.kind).toBe('rejected-busy');
    expect(d.summary).toBe(
      '다른 미니앱(bar)이 이 디버거에 연결하려 해서 거부했어요. 지금은 foo에 연결돼 있어요.',
    );
    expect(d.actions[0]).toContain('foo 미니앱을 X로 닫고');
    expect(d.actions[0]).toContain('bar에서 새 QR을 스캔');
  });

  it('the start_attach timeout text carries the busy diagnosis and the awaited deploymentId', () => {
    const { tl } = busyTimeline();
    const text = attachTimeoutMessage({
      diagnosis: diagnoseAttach(tl.snapshot()),
      timeoutSec: 60,
      deploymentId: 'dep-bar-1',
    });
    expect(text).toContain('다른 미니앱(bar)이 이 디버거에 연결하려 해서 거부했어요');
    expect(text).toContain('deploymentId=dep-bar-1');
  });

  it('a later matched page supersedes the busy diagnosis', () => {
    const { tl } = busyTimeline();
    tl.record('target-connected', 'ok');
    tl.record('matched', 'ok');
    expect(diagnoseAttach(tl.snapshot()).kind).toBe('attached');
  });

  it('dashboard state carries the apps labels, and the dashboard renders them', async () => {
    const { tl } = busyTimeline();
    const { stages } = buildDashboardTimelineState(tl, new Date().toISOString());
    expect(stages?.at(-1)?.apps).toEqual({ rejected: 'bar', attached: 'foo' });

    const state: DashboardState = {
      tunnel: { up: true, wssUrl: 'wss://test.trycloudflare.com' },
      pages: [],
      attachUrl: null,
      phase: 'active',
      stages,
    };
    const srv = await startQrHttpServer(() => state);
    try {
      const ko = await (
        await fetch(`http://127.0.0.1:${srv.port}/`, { headers: { 'Accept-Language': 'ko' } })
      ).text();
      expect(ko).toContain('bar 미니앱의 연결을 거부했어요 (먼저 연결된 미니앱: foo)');
      const en = await (await fetch(`http://127.0.0.1:${srv.port}/?lang=en`)).text();
      expect(en).toContain('Rejected mini-app bar (already attached: foo)');
    } finally {
      await srv.close();
    }
  });
});

describe('log page.rejected-busy', () => {
  it('keeps only first-label app fields and drops everything else', () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      writes.push(String(c));
      return true;
    });
    try {
      logInfo('page.rejected-busy', {
        rejectedApp: 'bar',
        attachedApp: 'foo',
        url: 'https://bar.private-apps.tossmini.com/p?at=1',
      });
    } finally {
      spy.mockRestore();
    }
    const line = JSON.parse(writes.at(-1) ?? '{}');
    expect(line).toMatchObject({
      event: 'page.rejected-busy',
      rejectedApp: 'bar',
      attachedApp: 'foo',
    });
    expect('url' in line).toBe(false);
  });
});

describe('detach cause', () => {
  it('commitDetach binds the most recent noted cause and falls back to unknown', () => {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    createRelayStageHooks(tl).onTargetClose();
    clock.advance(1000);
    expect(tl.commitDetach().cause).toBe('target-closed');

    clock.advance(1000);
    expect(tl.commitDetach().cause).toBe('unknown');

    tl.record('tunnel', 'down');
    clock.advance(500);
    expect(tl.commitDetach().cause).toBe('tunnel-down');
  });

  it('upgrades an unknown detach when the cause is noted just after it', () => {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    tl.commitDetach();
    clock.advance(300);
    tl.noteDetachCause('target-closed');
    expect(tl.lastDetach()?.cause).toBe('target-closed');
  });

  it('describeDetach says how long ago and why, and what to do', () => {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    tl.noteDetachCause('target-closed');
    tl.commitDetach();
    clock.advance(42_000);
    const text = describeDetach({ detach: tl.lastDetach(), nowMs: clock.now() });
    expect(text).toBe(
      '폰 페이지 연결이 42초 전에 끊겼어요(원인: 폰에서 페이지가 닫혔거나 백그라운드로 갔어요). start_attach를 다시 호출하고 QR을 스캔하세요.',
    );
  });

  it('pageMissingError / classifyToolError use it, and keep the old text without a detach', () => {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    tl.noteDetachCause('tunnel-down');
    tl.commitDetach();
    clock.advance(125_000);
    const gone = { detach: tl.lastDetach(), nowMs: clock.now() };
    const a = pageMissingError('call_sdk', gone).content[0]?.text ?? '';
    expect(a).toContain(
      'call_sdk: 폰 페이지 연결이 2분 전에 끊겼어요(원인: cloudflared 터널이 끊겼어요)',
    );
    const b =
      classifyToolError(
        new Error('No mini-app page attached to the Chii relay yet.'),
        'call_sdk',
        false,
        gone,
      ).content[0]?.text ?? '';
    expect(b).toContain('2분 전에 끊겼어요');

    expect(pageMissingError('call_sdk').content[0]?.text).toContain('페이지가 attach 안 됨');
    expect(pageMissingError('call_sdk', { detach: null, nowMs: 0 }).content[0]?.text).toContain(
      '페이지가 attach 안 됨',
    );
  });

  it('mentions a busy rejection that happened after the detach', () => {
    const clock = makeClock();
    const tl = new AttachTimeline({ nowMs: clock.now });
    tl.commitDetach();
    clock.advance(1000);
    tl.recordBusyRejection('bar.private-apps.tossmini.com', null);
    clock.advance(1000);
    const snap = tl.snapshot();
    const text = describeDetach({
      detach: snap.lastDetach ?? null,
      busy: snap.lastBusy,
      nowMs: clock.now(),
    });
    expect(text).toContain('다른 미니앱(bar)의 연결 시도는 거부했어요');
    expect(text).not.toContain('tossmini');
  });
});
