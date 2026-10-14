/**
 * target.js 가드 — 붙은 미니앱이 있을 때만 chii target.js 앞에 호스트 가드를 붙여 내려준다.
 * 가드 동작은 jsdom에서 실제로 실행해 확인한다(chii 본문은 sentinel로 대체).
 */
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import { shouldRejectNewTarget } from '../target-busy.js';
import {
  buildGuardedTargetScript,
  busyWarningText,
  readChiiTargetScript,
} from '../target-guard.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

// jsdom ships no types in this package; load it untyped and describe only what the tests touch.
// biome-ignore lint/suspicious/noExplicitAny: untyped jsdom window
interface JsdomWindow extends Record<string, any> {
  eval(code: string): unknown;
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    opts: { url: string; runScripts: 'outside-only' },
  ) => { window: JsdomWindow };
};

const SENTINEL = 'window.__chii_ran = (window.__chii_ran || 0) + 1;';

function run(script: string, hostname: string) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: `https://${hostname}/p`,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  const roots: ShadowRoot[] = [];
  const orig = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const r = orig.call(this, { ...init, mode: 'open' });
    roots.push(r);
    return r;
  };
  const warns: string[] = [];
  w.console.warn = (...a: unknown[]) => warns.push(a.join(' '));
  dom.window.eval(script);
  return { w, roots, warns, dom };
}

describe('buildGuardedTargetScript', () => {
  it('returns null when no attached host is known', () => {
    expect(buildGuardedTargetScript(SENTINEL, [])).toBeNull();
    expect(buildGuardedTargetScript(SENTINEL, [null])).toBeNull();
  });

  it('different host: shows the warning, does not run the chii body', () => {
    const s = buildGuardedTargetScript(SENTINEL, ['foo.private-apps.tossmini.com']);
    if (s === null) throw new Error('expected guard');
    const { w, roots, warns } = run(s, 'bar.private-apps.tossmini.com');
    expect(w.__chii_ran).toBeUndefined();
    expect(w.__ait_debug_status).toBe('relay-busy');
    expect(warns).toHaveLength(1);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.textContent).toBe(busyWarningText('foo'));
    expect(roots[0]?.textContent).toBe(
      '디버거가 이미 다른 미니앱(foo)에 연결돼 있어서 이 미니앱은 연결하지 않았어요. 이 미니앱을 디버깅하려면 foo 미니앱을 X로 닫은 뒤 QR을 다시 스캔하세요.',
    );
    // tap dismisses
    (roots[0]?.firstElementChild as HTMLElement | undefined)?.click();
    expect(w.document.body.children).toHaveLength(0);
  });

  it('same host (case-insensitive): runs the chii body once, no overlay', () => {
    const s = buildGuardedTargetScript(SENTINEL, ['foo.private-apps.tossmini.com']);
    if (s === null) throw new Error('expected guard');
    const { w, roots, warns } = run(s, 'FOO.private-apps.tossmini.com');
    expect(w.__chii_ran).toBe(1);
    expect(w.__ait_debug_status).toBeUndefined();
    expect(roots).toHaveLength(0);
    expect(warns).toHaveLength(0);
  });

  it('keeps a non-writable __ait_debug_status untouched', () => {
    const s = buildGuardedTargetScript(SENTINEL, ['foo.x.com']);
    if (s === null) throw new Error('expected guard');
    const dom = new JSDOM('<body></body>', {
      url: 'https://bar.x.com/',
      runScripts: 'outside-only',
    });
    dom.window.eval(
      "Object.defineProperty(window,'__ait_debug_status',{value:'ok',writable:false,configurable:false})",
    );
    dom.window.eval(s);
    expect(dom.window.__ait_debug_status).toBe('ok');
  });

  it('escapes hostile host strings (no script breakout, text stays data)', () => {
    const hostile = '</script><img src=x onerror=alert(1)> "\');window.__pwn=1;//.evil.com';
    const s = buildGuardedTargetScript(SENTINEL, [hostile]);
    if (s === null) throw new Error('expected guard');
    expect(s).not.toContain('</script>');
    expect(s).not.toContain(' ');
    const { w, roots } = run(s, 'bar.example.com');
    expect(w.__pwn).toBeUndefined();
    expect(w.__chii_ran).toBeUndefined();
    expect(roots[0]?.querySelector('img')).toBeNull();
    expect(roots[0]?.textContent).toContain('</script>');
  });

  it('serves the unmodified chii body inside the wrapper and leaks no secrets', () => {
    const body = readChiiTargetScript();
    if (body === null) throw new Error('chii target.js not readable');
    const s = buildGuardedTargetScript(body, ['foo.private-apps.tossmini.com']);
    if (s === null) throw new Error('expected guard');
    expect(s).toContain(body);
    const guardPart = s.slice(0, s.indexOf(body));
    expect(guardPart).not.toContain('at=');
    expect(guardPart).not.toContain('wss:');
    expect(guardPart).toContain('foo.private-apps.tossmini.com');
  });
});

describe('relay serves the guarded target.js only while a mini-app is attached', () => {
  const SECRET = 'deadbeef'.repeat(8);
  const FOO =
    'https://foo.private-apps.tossmini.com/p?at=654321&relay=wss%3A%2F%2Fsecret-relay.example';
  let relay: ChiiRelay;

  beforeAll(async () => {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth was not built');
    relay = await startChiiRelay({
      port: 0,
      verifyAuth,
      shouldRejectTarget: shouldRejectNewTarget,
    });
  });
  afterAll(async () => {
    await relay.close();
  });

  const fetchScript = () =>
    fetch(`http://127.0.0.1:${relay.port}/at/${generateTotp(SECRET)}/target.js`);

  it('original bytes when nothing is attached; guarded + no-store when attached', async () => {
    const original = readChiiTargetScript();
    const before = await fetchScript();
    expect(before.status).toBe(200);
    expect(await before.text()).toBe(original);

    const q = new URLSearchParams({ url: FOO, title: 't' });
    const ws = new WebSocket(
      `ws://127.0.0.1:${relay.port}/at/${generateTotp(SECRET)}/target/t1?${q}`,
    );
    await new Promise((r) => ws.on('open', r));
    await new Promise((r) => setTimeout(r, 100));

    const during = await fetchScript();
    expect(during.status).toBe(200);
    expect(during.headers.get('cache-control')).toBe('no-store');
    const text = await during.text();
    expect(text).not.toBe(original);
    expect(text).toContain(original ?? '');
    expect(text).toContain('foo.private-apps.tossmini.com');
    const guardPart = text.slice(0, text.indexOf(original ?? ''));
    expect(guardPart).not.toContain('654321');
    expect(guardPart).not.toContain('at=');
    expect(guardPart).not.toContain('secret-relay');
    expect(guardPart).not.toContain('127.0.0.1');

    ws.close();
    await new Promise((r) => setTimeout(r, 200));
    const after = await fetchScript();
    expect(await after.text()).toBe(original);
  });

  it('unauthenticated request is still rejected', async () => {
    const res = await fetch(`http://127.0.0.1:${relay.port}/at/000000/target.js`);
    expect(res.status).toBe(401);
  });
});
