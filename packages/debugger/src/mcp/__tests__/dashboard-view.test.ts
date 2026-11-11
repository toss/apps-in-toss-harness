/**
 * Dashboard screens: one pane per state (wait / connecting / connected / error), progress steps,
 * the rotation timer, and the rule that the attach link, codes and tunnel host never appear as
 * page text. The view script runs in jsdom against the HTML the server really serves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardControl, DashboardState } from '../qr-http-server.js';
import { startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const CODE = '7f3a9c1d5e2b4a60';
const ATTACH_URL = `intoss-private://aitc-sdk-example?_deploymentId=dep-1&debug=1&relay=wss%3A%2F%2Fsecret-host.trycloudflare.com&at=${CODE}&sig=abc123`;
const T0 = Date.parse('2026-11-09T00:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

const base = (over: Partial<DashboardState> = {}): DashboardState => ({
  tunnel: { up: true, wssUrl: 'wss://secret-host.trycloudflare.com' },
  pages: [],
  attachUrl: ATTACH_URL,
  phase: 'active',
  stages: [{ at: at(0), stage: 'qr-issued', result: 'ok', detail: 'mint' }],
  ...over,
});

const control = (over: Partial<DashboardControl> = {}): DashboardControl => ({
  armed: true,
  armedUntil: null,
  attached: 0,
  expiresAt: null,
  warning: false,
  lastEnd: null,
  claims: [],
  tunnelIdleClosed: false,
  ...over,
});

async function fetchHtml(state: DashboardState, query = '?lang=ko'): Promise<string> {
  const srv = await startQrHttpServer(() => state);
  try {
    return await (await fetch(`http://127.0.0.1:${srv.port}/${query}`)).text();
  } finally {
    await srv.close();
  }
}

/** HTML에서 사람이 읽는 텍스트(스크립트·스타일·속성 제외)만 뽑는다. */
function visibleText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('script, style')) el.remove();
  return doc.body.textContent ?? '';
}

function mount(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [...doc.querySelectorAll('script')].map((s) => s.textContent ?? '');
  for (const el of doc.querySelectorAll('script')) el.remove();
  document.body.innerHTML = doc.body.innerHTML;
  const view = scripts.find((s) => s.includes('var V = '));
  if (!view) throw new Error('view script not found');
  return view;
}

function frame(state: DashboardState): void {
  window.dispatchEvent(new CustomEvent('ait-dash-state', { detail: state }));
}

const viewOf = () => document.getElementById('stage')?.getAttribute('data-view');
const stepClasses = () =>
  [...document.querySelectorAll('#steps li')].map((li) => li.className || 'pending');

describe('dashboard — secrets never appear as page text', () => {
  it('shows neither the link, the code, the signature nor the tunnel host while the QR is up', async () => {
    const html = await fetchHtml(base());
    const text = visibleText(html);
    for (const secret of [
      'intoss-private',
      CODE,
      'at=',
      'sig=',
      'abc123',
      'trycloudflare',
      'secret-host',
      'wss://',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(html).not.toContain('id="url-box"');
    expect(html).toContain('<img class="qr"');
    // The link rides only as the copy button's data attribute.
    expect(html).toContain('id="copy-btn"');
  });

  it('keeps the link out of the page text in connected and error states too', async () => {
    const connected = visibleText(
      await fetchHtml(
        base({
          pages: [{ id: 'p1', url: `https://app.example.com/x?at=${CODE}&token=zzz#frag` }],
          control: control({ attached: 1 }),
        }),
      ),
    );
    expect(connected).toContain('app.example.com/x');
    for (const secret of [CODE, 'token=zzz', 'frag', 'intoss-private', 'trycloudflare']) {
      expect(connected).not.toContain(secret);
    }
    const errored = await fetchHtml(base({ tunnel: { up: false, wssUrl: null } }));
    expect(visibleText(errored)).not.toContain('intoss-private');
    expect(errored).not.toContain(CODE);
  });
});

describe('dashboard — first view from the server', () => {
  it.each([
    ['wait', base()],
    ['error', base({ tunnel: { up: false, wssUrl: null } })],
    ['connected', base({ pages: [{ id: 'p1', url: 'https://app.example.com/' }] })],
    ['connected', base({ control: control({ attached: 1 }) })],
  ] as const)('is %s', async (view, state) => {
    expect(await fetchHtml(state)).toContain(`data-view="${view}"`);
  });

  it('keeps diagnostics in a collapsed details block', async () => {
    const html = await fetchHtml(
      base({ session: { kind: 'daemon', startedAt: at(0), pid: 4242 } }),
    );
    expect(html).toMatch(/<details class="card details" id="diag">/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('자세히');
    // Both the ko and the en screen build.
    expect(await fetchHtml(base(), '?lang=en')).toContain('Details');
  });
});

describe('dashboard — view script', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  async function run(state: DashboardState): Promise<void> {
    const script = mount(await fetchHtml(state));
    vi.useFakeTimers({ now: T0 });
    // biome-ignore lint/security/noGlobalEval: inline script under test
    eval(script);
  }

  it('shows the QR hero with a rotation countdown and no layout-moving link row', async () => {
    await run(base());
    frame(base());
    expect(viewOf()).toBe('wait');
    expect(document.querySelector('[data-pane="wait"]')?.getAttribute('data-qr')).toBe('1');
    expect(document.getElementById('qr-timer-text')?.textContent).toMatch(/5초/);
    vi.advanceTimersByTime(3000);
    expect(document.getElementById('qr-timer-text')?.textContent).toMatch(/2초/);
    // A new code restarts the countdown.
    frame(base({ attachUrl: `${ATTACH_URL}2` }));
    expect(document.getElementById('qr-timer-text')?.textContent).toMatch(/5초/);
  });

  it('shows progress steps once the phone has opened the mini-app', async () => {
    await run(base());
    const stages = [
      { at: at(0), stage: 'qr-issued', result: 'ok', detail: 'mint' },
      { at: at(8), stage: 'device-handshake', result: 'ok' },
      { at: at(9), stage: 'auth', result: 'ok', detail: 'script' },
    ];
    frame(base({ stages }));
    expect(viewOf()).toBe('connecting');
    expect(stepClasses()).toEqual(['done', 'done', 'done', 'current', 'pending']);
    frame(base({ stages: [...stages, { at: at(10), stage: 'target-connected', result: 'ok' }] }));
    expect(stepClasses()).toEqual(['done', 'done', 'done', 'done', 'current']);
  });

  it('explains a rejected code with a cause and the next action, and clears it on success', async () => {
    await run(base());
    const stages = [
      { at: at(0), stage: 'qr-issued', result: 'ok', detail: 'mint' },
      { at: at(8), stage: 'device-handshake', result: 'ok' },
      { at: at(9), stage: 'auth', result: 'rejected', detail: 'ws-4401' },
    ];
    frame(base({ stages }));
    expect(viewOf()).toBe('wait');
    const notice = document.getElementById('notice') as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('다시 스캔');
    // A remint (code rotation) must not hide the notice.
    frame(
      base({
        stages: [...stages, { at: at(12), stage: 'qr-issued', result: 'ok', detail: 'remint' }],
      }),
    );
    expect(notice.hidden).toBe(false);
    // The phone connecting clears it.
    frame(
      base({
        stages: [...stages, { at: at(13), stage: 'target-connected', result: 'ok' }],
        pages: [{ id: 'p1', url: 'https://app.example.com/' }],
      }),
    );
    expect(notice.hidden).toBe(true);
    expect(viewOf()).toBe('connected');
  });

  it('tells a disconnected phone what to do next', async () => {
    await run(base());
    frame(
      base({
        stages: [
          { at: at(0), stage: 'qr-issued', result: 'ok', detail: 'mint' },
          { at: at(9), stage: 'target-connected', result: 'ok' },
          { at: at(30), stage: 'target-disconnected', result: 'ok' },
        ],
      }),
    );
    expect(viewOf()).toBe('wait');
    expect(document.getElementById('notice')?.textContent).toContain('연결이 끊겼어요');
  });

  it('shows the device and the time left when connected', async () => {
    await run(base());
    frame(
      base({
        pages: [{ id: 'p1', url: 'https://app.example.com/' }],
        control: control({
          attached: 1,
          armed: false,
          expiresAt: T0 + 125_000,
          claims: [{ kind: 'claim', at: T0, device: 'abcd1234', ua: 'ios' }],
        }),
      }),
    );
    expect(viewOf()).toBe('connected');
    expect(document.getElementById('conn-sub')?.textContent).toContain('iOS 기기');
    expect(document.getElementById('conn-left')?.textContent).toContain('2분 5초');
    vi.advanceTimersByTime(5000);
    expect(document.getElementById('conn-left')?.textContent).toContain('2분 0초');
  });

  it('switches to the error screen when the tunnel drops', async () => {
    await run(base());
    frame(base({ tunnel: { up: false, wssUrl: null }, attachUrl: ATTACH_URL }));
    expect(viewOf()).toBe('error');
    expect(document.querySelector('[data-pane="wait"]')?.getAttribute('data-qr')).toBe('0');
  });
});
