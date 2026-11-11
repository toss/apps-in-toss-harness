/**
 * connected 화면의 "QR 보기": 접힌 기본값, 펼침 시 경고, QR 유무 분기, SSE 재렌더 뒤 유지, ko/en 문구.
 * 보이는지 여부는 CSS가 `#stage[data-peek]`로 정하므로(jsdom은 헤드 스타일을 적용하지 않는다) 여기서는
 * 속성과 DOM 구조를 단언한다. QR 값은 테스트용 자리표시 문자열이고 단언·출력에 쓰지 않는다.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardControl, DashboardState } from '../qr-http-server.js';
import { startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const T0 = Date.parse('2026-11-09T00:00:00.000Z');
const ATTACH_URL = 'intoss-private://placeholder?at=0000';

const connectedState = (over: Partial<DashboardState> = {}): DashboardState => ({
  tunnel: { up: true, wssUrl: 'wss://placeholder.invalid' },
  pages: [{ id: 'p1', url: 'https://app.example.com/' }],
  attachUrl: ATTACH_URL,
  phase: 'active',
  stages: [],
  control: {
    armed: false,
    armedUntil: null,
    attached: 1,
    expiresAt: null,
    warning: false,
    lastEnd: null,
    claims: [],
    tunnelIdleClosed: false,
  } satisfies DashboardControl,
  ...over,
});

async function fetchHtml(state: DashboardState, lang: 'ko' | 'en'): Promise<string> {
  const srv = await startQrHttpServer(() => state);
  try {
    return await (await fetch(`http://127.0.0.1:${srv.port}/?lang=${lang}`)).text();
  } finally {
    await srv.close();
  }
}

async function mountAndRun(state: DashboardState, lang: 'ko' | 'en'): Promise<void> {
  const doc = new DOMParser().parseFromString(await fetchHtml(state, lang), 'text/html');
  const scripts = [...doc.querySelectorAll('script')].map((s) => s.textContent ?? '');
  for (const el of doc.querySelectorAll('script')) el.remove();
  document.body.innerHTML = doc.body.innerHTML;
  const view = scripts.find((s) => s.includes('var V = '));
  if (!view) throw new Error('view script not found');
  vi.useFakeTimers({ now: T0 });
  // biome-ignore lint/security/noGlobalEval: inline script under test
  eval(view);
}

const frame = (state: DashboardState) =>
  window.dispatchEvent(new CustomEvent('ait-dash-state', { detail: state }));
const stage = () => document.getElementById('stage') as HTMLElement;
const toggle = () => document.getElementById('qr-peek-toggle') as HTMLButtonElement;

describe('dashboard — QR 보기 (connected)', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('starts collapsed with a toggle button and the warning right above the QR area', async () => {
    await mountAndRun(connectedState(), 'ko');
    frame(connectedState());
    expect(stage().getAttribute('data-view')).toBe('connected');
    expect(stage().getAttribute('data-peek')).toBe('0');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().textContent).toContain('QR 보기');
    // 경고는 QR 영역(wait 창) 안에서 QR 칸보다 앞에 온다.
    const pane = document.querySelector('[data-pane="wait"]') as HTMLElement;
    const warn = pane.querySelector('#peek-warn') as HTMLElement;
    const qr = pane.querySelector('#attach-section') as HTMLElement;
    expect(warn.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('expands on click, collapses again, and the pane keeps the QR area', async () => {
    await mountAndRun(connectedState(), 'ko');
    frame(connectedState());
    toggle().click();
    expect(stage().getAttribute('data-peek')).toBe('1');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#peek-warn')?.textContent).toBe(
      '이 QR로 새로 연결하면 지금 연결된 폰의 연결이 끊겨요.',
    );
    expect(toggle().textContent).toContain('QR 닫기');
    toggle().click();
    expect(stage().getAttribute('data-peek')).toBe('0');
  });

  it('stays expanded across SSE frames', async () => {
    await mountAndRun(connectedState(), 'ko');
    frame(connectedState());
    toggle().click();
    frame(connectedState({ attachUrl: `${ATTACH_URL}2` }));
    frame(connectedState({ attachUrl: `${ATTACH_URL}3` }));
    expect(stage().getAttribute('data-peek')).toBe('1');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('branches on QR presence: timer when valid, create-new-QR button when not', async () => {
    await mountAndRun(connectedState(), 'ko');
    frame(connectedState());
    toggle().click();
    const pane = document.querySelector('[data-pane="wait"]') as HTMLElement;
    expect(pane.getAttribute('data-qr')).toBe('1');
    expect(document.getElementById('qr-timer-text')?.textContent).toMatch(/5초/);

    frame(connectedState({ attachUrl: null }));
    expect(pane.getAttribute('data-qr')).toBe('0');
    expect(stage().getAttribute('data-peek')).toBe('1');
    const make = pane.querySelector('.qr-none [data-act="new-qr"]') as HTMLElement;
    expect(make).toBeTruthy();
    expect(make.textContent).toBe('새 QR 만들기');
  });

  it('shows the QR again right away when the phone drops and the view returns to wait', async () => {
    await mountAndRun(connectedState(), 'ko');
    frame(connectedState());
    toggle().click();
    frame(connectedState({ pages: [], control: { ...connectedState().control!, attached: 0 } }));
    expect(stage().getAttribute('data-view')).toBe('wait');
    expect(stage().getAttribute('data-peek')).toBe('0');
    // 다시 connected가 되면 접힌 채로 시작한다.
    frame(connectedState());
    expect(stage().getAttribute('data-peek')).toBe('0');
  });

  it('serves the en copy', async () => {
    await mountAndRun(connectedState(), 'en');
    frame(connectedState());
    expect(toggle().textContent).toContain('Show QR');
    expect(toggle().textContent).toContain('Hide QR');
    expect(document.querySelector('#peek-warn')?.textContent).toBe(
      'Connecting with this QR will disconnect the phone that is connected now.',
    );
  });
});
