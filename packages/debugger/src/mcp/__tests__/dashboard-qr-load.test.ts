/**
 * QR이 "가끔 안 보이던" 문제의 회귀 테스트 + 상태별 화면 규칙.
 *
 * 원인(옛 대시보드와 첫 재구성 모두): 5초마다 QR이 바뀔 때 `new Image()`로 미리 받은 뒤 `img.src`를
 * 같은 `/qr.png?u=…`로 바꿨다. PNG는 `Cache-Control: no-store`라 src를 바꾸면 요청이 한 번 더 나가고,
 * 그 요청이 실패하면(링크가 그 사이 바뀌어 403, 연결 한도에 밀림, 일시 오류) `<img>`가 깨진 채 빈 칸으로
 * 남았다. 실패 처리도, 재시도도 없었다. 터널이 잠깐 죽으면 `#attach-section`을 비우고 다시 그려, 새 img가
 * 디코드될 때까지 빈 칸이 보이기도 했다.
 *
 * 지금은 PNG를 fetch로 받아 디코드까지 끝낸 뒤 같은 blob URL로만 src를 바꾼다. 실패하면 이전 QR을 그대로 두고
 * 최신 링크로 다시 시도한다. QR이 없는 칸은 비어 있지 않고 "불러오는 중"/"새 QR 만들기"가 채운다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardControl, DashboardState } from '../qr-http-server.js';
import { startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const BASE =
  'intoss-private://aitc-sdk-example?_deploymentId=dep-1&debug=1&relay=wss%3A%2F%2Fh.example';
const urlWith = (code: string) => `${BASE}&at=${code}&sig=s${code}`;

const state = (over: Partial<DashboardState> = {}): DashboardState => ({
  tunnel: { up: true, wssUrl: 'wss://h.example' },
  pages: [],
  attachUrl: urlWith('aaaa'),
  phase: 'active',
  stages: [{ at: new Date(0).toISOString(), stage: 'qr-issued', result: 'ok', detail: 'mint' }],
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

let sse: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
let pending: Array<{ src: string; ok: () => void; fail: () => void }> = [];
const fetched: string[] = [];
let qrStatus = 200;
let actions: string[] = [];
const docListeners: Array<[string, EventListener]> = [];

class StubES {
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    sse = this;
  }
  addEventListener(): void {}
  close(): void {}
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) {
    pending.push({ src: v, ok: () => this.onload?.(), fail: () => this.onerror?.() });
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

async function mount(s: DashboardState, c?: DashboardControl): Promise<void> {
  const full = c ? { ...s, control: c } : s;
  const srv = await startQrHttpServer(() => full);
  let html: string;
  try {
    html = await (await fetch(`http://127.0.0.1:${srv.port}/?lang=ko`)).text();
  } finally {
    await srv.close();
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = [...doc.querySelectorAll('script')].map((el) => el.textContent ?? '');
  for (const el of doc.querySelectorAll('script')) el.remove();
  document.body.innerHTML = doc.body.innerHTML;
  vi.stubGlobal('EventSource', StubES);
  vi.stubGlobal('Image', StubImage);
  let n = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => `blob:qr-${++n}`, revokeObjectURL: () => {} }),
  );
  vi.stubGlobal('fetch', async (u: string, init?: { method?: string; body?: string }) => {
    if (String(u).startsWith('/qr.png')) {
      fetched.push(String(u));
      return { ok: qrStatus === 200, status: qrStatus, blob: async () => new Blob(['png']) };
    }
    if (String(u) === '/action') {
      actions.push(JSON.parse(init?.body ?? '{}').action);
      return { json: async () => ({ ok: true }) };
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  const realAdd = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(
    (t: string, fn: EventListenerOrEventListenerObject) => {
      docListeners.push([t, fn as EventListener]);
      realAdd(t, fn);
    },
  );
  for (const code of scripts) {
    // biome-ignore lint/security/noGlobalEval: 서버가 내려준 인라인 스크립트를 그대로 검증한다
    window.eval(code);
  }
}

function frame(s: DashboardState): void {
  sse?.onmessage?.(new MessageEvent('message', { data: JSON.stringify(s) }));
}

const img = () => document.querySelector('#attach-section img.qr') as HTMLImageElement;
const qrFrame = () => document.querySelector('#attach-section .qr-frame') as HTMLElement;

/** 디코드 대기열의 맨 앞(가장 오래된) 이미지를 성공 처리한다. */
async function decodeNext(): Promise<string> {
  const job = pending.shift();
  if (!job) throw new Error('no pending image');
  job.ok();
  await flush();
  return job.src;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  sse = null;
  pending = [];
  fetched.length = 0;
  qrStatus = 200;
  actions = [];
});

afterEach(() => {
  for (const [t, fn] of docListeners.splice(0)) document.removeEventListener(t, fn);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('QR image swap — the previous QR stays until the new one is decoded', () => {
  it('keeps the old image on screen while the next one loads, then swaps without a second request', async () => {
    await mount(state(), control());
    const first = img().getAttribute('src');
    expect(qrFrame().dataset.ready).toBe('1');

    frame(state({ attachUrl: urlWith('bbbb') }));
    await flush();
    expect(fetched).toHaveLength(1);
    // 아직 디코드 전: 화면은 이전 이미지 그대로.
    expect(img().getAttribute('src')).toBe(first);
    expect(qrFrame().dataset.ready).toBe('1');

    const blob = await decodeNext();
    expect(img().getAttribute('src')).toBe(blob);
    expect(img().getAttribute('src')).toMatch(/^blob:/);
    expect(fetched).toHaveLength(1); // src 교체가 새 요청을 만들지 않는다
    expect(qrFrame().dataset.ready).toBe('1');
  });

  it('keeps the old image and retries with the newest link when the PNG request fails (403/404/5xx)', async () => {
    await mount(state(), control());
    frame(state({ attachUrl: urlWith('bbbb') }));
    await flush();
    await decodeNext();
    const shown = img().getAttribute('src');

    qrStatus = 403;
    frame(state({ attachUrl: urlWith('cccc') }));
    await flush();
    expect(fetched).toHaveLength(2);
    expect(img().getAttribute('src')).toBe(shown);
    expect(qrFrame().dataset.ready).toBe('1');

    // 더 새 링크가 와도 이전 이미지는 그대로, 재시도는 최신 링크로 간다.
    frame(state({ attachUrl: urlWith('dddd') }));
    await flush();
    qrStatus = 200;
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(fetched.at(-1)).toContain(encodeURIComponent('at=dddd').replace('%3D', '%3D'));
    await decodeNext();
    expect(img().getAttribute('src')).not.toBe(shown);
    expect(qrFrame().dataset.ready).toBe('1');
  });

  it('keeps the old image when the new PNG cannot be decoded, and tries again', async () => {
    await mount(state(), control());
    frame(state({ attachUrl: urlWith('bbbb') }));
    await flush();
    pending.shift()?.fail();
    await flush();
    expect(img().getAttribute('src')).toMatch(/^data:/);
    expect(qrFrame().dataset.ready).toBe('1');
    await vi.advanceTimersByTimeAsync(1600);
    await flush();
    expect(fetched).toHaveLength(2);
  });

  it('never leaves an empty box when the tunnel drops and comes back', async () => {
    await mount(state(), control());
    frame(state({ tunnel: { up: false, wssUrl: null } }));
    await flush();
    // 이미지를 지우지 않고 칸에 "불러오는 중" 표시를 올린다(죽은 QR은 가려진다).
    expect(qrFrame()).not.toBeNull();
    expect(qrFrame().dataset.ready).toBe('0');
    expect(qrFrame().querySelector('.qr-skel')?.textContent).toContain('불러오는 중');

    frame(state({ attachUrl: urlWith('eeee') }));
    await flush();
    expect(qrFrame().dataset.ready).toBe('0');
    await decodeNext();
    expect(qrFrame().dataset.ready).toBe('1');
    expect(img().getAttribute('src')).toMatch(/^blob:/);
  });
});

describe('dashboard states — no empty card, only the actions that make sense', () => {
  const pill = () => document.getElementById('tunnel-status');
  const hidden = (id: string) => (document.getElementById(id) as HTMLElement).hidden;
  const view = () => document.getElementById('stage')?.getAttribute('data-view');

  it('waiting: neutral "연결 통로 준비됨" pill, QR actions only (no disconnect)', async () => {
    await mount(state(), control());
    expect(pill()?.textContent).toBe('연결 통로 준비됨');
    expect(pill()?.className).toContain('status-ready');
    expect(pill()?.className).not.toContain('status-up');
    expect(hidden('ait-control-kill')).toBe(true);
    expect(hidden('ait-control-newqr')).toBe(false);
  });

  it('attached: strong "폰 연결됨" pill, disconnect only', async () => {
    const attached = state({ pages: [{ id: 'p1', url: 'https://m.example/' }] });
    await mount(attached, control({ attached: 1, expiresAt: Date.now() + 600_000 }));
    expect(pill()?.textContent).toBe('폰 연결됨');
    expect(pill()?.className).toContain('status-up');
    expect(hidden('ait-control-kill')).toBe(false);
    expect(hidden('ait-control-newqr')).toBe(true);
    frame({ ...attached, control: control({ attached: 1, expiresAt: Date.now() + 600_000 }) });
    expect(view()).toBe('connected');
  });

  it('phone detached and no QR any more: shows an explanation and a primary "새 QR 만들기" that re-arms', async () => {
    const attached = state({ pages: [{ id: 'p1', url: 'https://m.example/' }] });
    await mount(attached, control({ attached: 1 }));
    // 폰이 떠난 뒤: 페이지 없음, 공개 중인 링크 없음.
    frame({ ...state({ attachUrl: null }), control: control({ armed: false }) });
    await flush();
    expect(view()).toBe('wait');
    expect(document.querySelector('[data-pane="wait"]')?.getAttribute('data-qr')).toBe('0');
    const make = document.querySelector('.qr-none [data-act="new-qr"]') as HTMLButtonElement;
    expect(make.hidden).toBe(false);
    expect(make.textContent).toBe('새 QR 만들기');
    expect(document.querySelector('.qr-none')?.textContent).toContain('지금은 QR이 없어요');
    make.click();
    await flush();
    expect(actions).toEqual(['new-qr']);
    // 새 링크가 오면 같은 칸에 QR이 다시 나온다.
    frame({ ...state({ attachUrl: urlWith('ffff') }), control: control() });
    await flush();
    expect(document.querySelector('[data-pane="wait"]')?.getAttribute('data-qr')).toBe('1');
    await decodeNext();
    expect(qrFrame().dataset.ready).toBe('1');
  });
});
