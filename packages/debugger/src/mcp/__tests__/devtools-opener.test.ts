/**
 * Tests for devtools-opener: Chii self-hosted inspector URL assembly,
 * opt-out guard, and AutoDevtoolsOpener per-target dedupe semantics (issue #530).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoDevtoolsOpener,
  buildChiiInspectorUrl,
  isAutoDevtoolsDisabled,
} from '../devtools-opener.js';

// ---------------------------------------------------------------------------
// Fixture TOTP secret (hex, 32 bytes) — never a real secret value.
// ---------------------------------------------------------------------------
const FIXTURE_SECRET = 'deadbeef'.repeat(8); // 64 hex chars = 32 bytes
const fixtureMintTotp = () => '123456';

// ---------------------------------------------------------------------------
// buildChiiInspectorUrl
// ---------------------------------------------------------------------------

describe('buildChiiInspectorUrl', () => {
  // ── fail-closed: mintTotp 없으면 null 반환 (issue #509) ─────────────────
  it('returns null when mintTotp is undefined (fail-closed)', () => {
    // relay WS 게이트는 at= 없는 모든 업그레이드를 거부하므로, mintTotp 없이
    // URL을 만들면 항상 WS 4401이 된다 — null을 반환해 caller가 waiting hint를 표시하게 한다.
    expect(buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', undefined)).toBeNull();
  });

  it('returns null when mintTotp is omitted (fail-closed)', () => {
    expect(buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc')).toBeNull();
  });

  it('returns null for HTTPS tunnel relay when mintTotp is omitted (env 2, fail-closed)', () => {
    // relay-mobile(env 2) HTTPS tunnel URL에서도 mintTotp 없으면 null.
    expect(buildChiiInspectorUrl('https://abc.trycloudflare.com', 'target-abc')).toBeNull();
  });

  // ── URL 생성: mintTotp 있을 때만 string 반환 ──────────────────────────
  it('returns a URL pointing at the relay front_end/chii_app.html', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9100\/front_end\/chii_app\.html\?/);
  });

  it('includes the default console panel', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).toContain('panel=console');
  });

  it('accepts a custom panel', () => {
    const url = buildChiiInspectorUrl(
      'http://127.0.0.1:9100',
      'target-abc',
      fixtureMintTotp,
      'elements',
    );
    expect(url).toContain('panel=elements');
  });

  it('embeds target id in the ws= path', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'my-target-id', fixtureMintTotp);
    expect(url).not.toBeNull();
    // The ws= value is URL-encoded, so decode it to inspect the inner value.
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=my-target-id');
  });

  it('routes through /client/ path (chii relay client endpoint)', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('/client/');
  });

  it('includes at= TOTP code when mintTotp is provided', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('at=123456');
  });

  it('uses the relay host (not scheme) in the ws= value', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    // Should start with the host, not with http://
    expect(wssParam).toMatch(/^127\.0\.0\.1:9100/);
  });

  it('uses ws= (plain dial) for an http relay base — env 3/4 local relay', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    // wss= against a plain-HTTP relay would make the frontend attempt TLS and fail.
    expect(parsed.searchParams.get('ws')).toBeTruthy();
    expect(parsed.searchParams.get('wss')).toBeNull();
  });

  it('uses wss= (TLS dial) for an https relay base — env 2 tunnel', () => {
    const url = buildChiiInspectorUrl(
      'https://abc.trycloudflare.com',
      'target-abc',
      fixtureMintTotp,
    );
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get('wss')).toBeTruthy();
    expect(parsed.searchParams.get('ws')).toBeNull();
  });

  it('works with an external cloudflare tunnel base URL', () => {
    const url = buildChiiInspectorUrl(
      'https://abc.trycloudflare.com',
      'phone-target',
      fixtureMintTotp,
    );
    expect(url).toMatch(/^https:\/\/abc\.trycloudflare\.com\/front_end\/chii_app\.html\?/);
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=phone-target');
    expect(wssParam).toContain('at=123456');
  });

  it('tolerates a trailing slash on the relay base URL', () => {
    const urlWithSlash = buildChiiInspectorUrl('http://127.0.0.1:9100/', 'tgt', fixtureMintTotp);
    const urlWithout = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', fixtureMintTotp);
    // Both should produce the same structure (no double slash in the path).
    expect(urlWithSlash).not.toContain('//front_end');
    expect(urlWithout).not.toContain('//front_end');
  });

  it('does not embed the TOTP secret — only the code', () => {
    const mintWithSecret = () => {
      // Simulate a mintTotp that uses a real secret internally.
      // The function must return only the code.
      return fixtureMintTotp();
    };
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', mintWithSecret);
    // The fixture secret must never appear in the URL.
    expect(url).not.toContain(FIXTURE_SECRET);
    // The code (returned value) must appear.
    expect(url).toContain('123456');
  });
});

// ---------------------------------------------------------------------------
// isAutoDevtoolsDisabled
// ---------------------------------------------------------------------------

// isAutoDevtoolsDisabled — 기본값 OFF (opt-in) 모델 (#544)
// 기본(미설정): disabled=true (창 자동 열기 안 함)
// AIT_AUTO_DEVTOOLS=1: disabled=false (opt-in 자동 열기)
// AIT_AUTO_DEVTOOLS=0: disabled=true ('1'이 아닌 값)
// AIT_AUTO_DEVTOOLS=기타(false 등): disabled=true ('1'이 아닌 모든 값)
describe('isAutoDevtoolsDisabled', () => {
  const originalEnv = process.env.AIT_AUTO_DEVTOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIT_AUTO_DEVTOOLS;
    } else {
      process.env.AIT_AUTO_DEVTOOLS = originalEnv;
    }
  });

  it('returns true when env var is absent (default OFF — opt-in model, #544)', () => {
    delete process.env.AIT_AUTO_DEVTOOLS;
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });

  it('returns true when AIT_AUTO_DEVTOOLS=0 — only "1" opts in', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });

  it('returns false when AIT_AUTO_DEVTOOLS=1 (opt-in enables auto-open)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    expect(isAutoDevtoolsDisabled()).toBe(false);
  });

  it('returns true when AIT_AUTO_DEVTOOLS=false (string) — only "1" opts in', () => {
    process.env.AIT_AUTO_DEVTOOLS = 'false';
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// openUrlInBrowser — actual spawn is a side-effect; integration path is manual/E2E only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AutoDevtoolsOpener
// ---------------------------------------------------------------------------

// AutoDevtoolsOpener — #544 기본값 OFF 적용 후 테스트
// "열려야 하는" 케이스는 AIT_AUTO_DEVTOOLS=1 (opt-in) 설정 후 확인.
// "안 열려야 하는" 케이스는 미설정(default OFF) 또는 1이 아닌 값.
describe('AutoDevtoolsOpener', () => {
  let stderrOutput: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  const stableUrl = 'http://127.0.0.1:19000/inspector';

  beforeEach(() => {
    stderrOutput = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
    // 기본은 미설정(기본 OFF) — 개별 테스트에서 =1로 opt-in.
    delete process.env.AIT_AUTO_DEVTOOLS;
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.AIT_AUTO_DEVTOOLS;
    delete process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN;
  });

  // ── 기본값 OFF — 미설정 시 no-op 확인 (#544) ─────────────────────────────
  it('is a no-op by default (AIT_AUTO_DEVTOOLS not set — default OFF, #544)', () => {
    delete process.env.AIT_AUTO_DEVTOOLS;
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'target-abc', env: 'relay-dev' });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when AIT_AUTO_DEVTOOLS=0 — only "1" opts in', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'target-abc', env: 'relay-dev' });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  // ── opt-in (AIT_AUTO_DEVTOOLS=1) ─────────────────────────────────────────
  it('uses inspectorStableUrl — no tunnel host or TOTP code in stderr', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'tgt', env: 'relay-dev' });
    expect(opener.opened).toBe(true);
    // Dashboard URL only (no inspector path) is written to stderr.
    expect(stderrOutput).toContain('http://127.0.0.1:19000');
    expect(stderrOutput).not.toContain('trycloudflare.com');
    expect(stderrOutput).not.toContain('at=');
  });

  it('the tokened URL goes to the browser launch only, never to stderr', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const launched: string[] = [];
    const opener = new AutoDevtoolsOpener((url) => {
      launched.push(url);
      return true;
    });
    const token = 'c'.repeat(64);
    opener.open({
      inspectorStableUrl: stableUrl,
      inspectorOpenUrl: `http://127.0.0.1:19000/inspector?dashtoken=${token}`,
      targetId: 'tgt',
      env: 'relay-dev',
    });
    expect(launched).toEqual([`http://127.0.0.1:19000/inspector?dashtoken=${token}`]);
    expect(stderrOutput).not.toContain('dashtoken');
    expect(stderrOutput).not.toContain(token);
  });

  it('a failed launch prints the tokenless URL', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener(() => false);
    opener.open({
      inspectorStableUrl: stableUrl,
      inspectorOpenUrl: `http://127.0.0.1:19000/inspector?dashtoken=${'c'.repeat(64)}`,
      targetId: 'tgt',
      env: 'relay-dev',
    });
    expect(stderrOutput).toContain('브라우저 자동 열기 실패');
    expect(stderrOutput).toContain('http://127.0.0.1:19000/inspector');
    expect(stderrOutput).not.toContain('dashtoken');
  });

  it('is a no-op on second call for the same targetId (per-target dedupe)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'tgt', env: 'relay-dev' });
    stderrOutput = '';
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'tgt', env: 'relay-dev' });
    expect(stderrOutput).toBe('');
    expect(opener.opened).toBe(true);
  });

  it('fires again for a new targetId (per-target dedupe, issue #530)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    // A page reload on the phone yields a new targetId — should auto-open again.
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'tgt-first', env: 'relay-dev' });
    stderrOutput = '';
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'tgt-second', env: 'relay-dev' });
    expect(stderrOutput).toContain('http://127.0.0.1:19000');
    expect(opener.openedTargets.size).toBe(2);
  });

  it('is a no-op when env is mock', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId: 'target-abc', env: 'mock' });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it.each([null, undefined, ''])('is a no-op when inspectorStableUrl is %j', (url) => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: url, targetId: 'target-abc', env: 'relay-dev' });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it.each([null, undefined, ''])('is a no-op when targetId is %j', (targetId) => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({ inspectorStableUrl: stableUrl, targetId, env: 'relay-dev' });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });
});
