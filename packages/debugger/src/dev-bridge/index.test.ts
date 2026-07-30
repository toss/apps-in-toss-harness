/**
 * Vendored from devtools' `src/__tests__/unplugin-tunnel.test.ts`
 * (devtools@61aa2d0228df27c2c0ab2405726dd5301067981e) — specifically the
 * `describe('startTunnelDashboard', ...)` block (issue #408), which is the
 * test counterpart of the code slice vendored into `./index.ts`. The rest of
 * that source file (`parseTrycloudflareUrl`, `buildLauncherDeepLink`,
 * `printTunnelBanner`, `resolveTunnelOption`, `sanitizeCloudflaredOutput`,
 * the install-graph invariant checks) tests code that stays in devtools'
 * `src/unplugin/` and is not vendored here.
 *
 * Only the import path changed (`../unplugin/tunnel.js` → `./index.js`,
 * reflecting the new location); test bodies are otherwise unmodified.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTunnelDashboard } from './index.js';

// The real browser open is suppressed via AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN=1
// (openUrlInBrowser's test hook). The GUI/opt-out gate is driven explicitly via
// the injected `shouldOpen` override so platform/CI does not flake the test.

// ---------------------------------------------------------------------------
// startTunnelDashboard (issue #408) — env-2 HTML dashboard parity
// ---------------------------------------------------------------------------

describe('startTunnelDashboard', () => {
  // Secrets used only inside the dashboard URL — never expected in any log.
  const TUNNEL_URL = 'https://app-host-secret.trycloudflare.com';
  const RELAY_WSS = 'wss://relay-host-secret.trycloudflare.com';
  // 64 hex chars = 32 bytes — a valid relay-auth TOTP secret.
  const SECRET = 'a'.repeat(64);

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Never spawn a real browser in tests.
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
    delete process.env.AIT_AUTO_DEVTOOLS;
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined (no server) when no relay is wired — screen-only tunnel', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: '',
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('returns undefined when qr:false (opt-out toggle shared with ASCII QR)', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      qr: false,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('returns undefined when the gate is closed (headless / AIT_AUTO_DEVTOOLS=0)', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => false,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('honours AIT_AUTO_DEVTOOLS=0 through the real opt-out predicate (no shouldOpen override)', async () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('starts the HTML dashboard and serves QR + connect steps + FAQ when the gate is open', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeDefined();
    if (!handle) throw new Error('dashboard did not start');
    try {
      // The dashboard URL is local only.
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
      const html = await res.text();

      // QR image (inline base64) + connect steps + FAQ (same dashboard env 3/4 uses).
      expect(html).toContain('<img class="qr" src="data:image/png;base64,');
      // Dashboard surfaces the attach URL in the url-box; that URL carries the
      // launcher deep-link with the relay folded in (the QR encodes the same).
      expect(html).toContain('devtools.aitc.dev/launcher');
    } finally {
      await handle.close();
    }
  });

  it('hides the "연결된 Pages" section — env 2 has no live target list (#411)', async () => {
    // env 2 getDashboardState returns pages: null because the unplugin tunnel
    // handle can't enumerate connected targets. The dashboard must therefore
    // omit the section entirely rather than show a perpetually-empty list.
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: () => {},
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const html = await (await fetch(handle.url)).text();
      // The static "연결된 Pages" section (header + container) is gone. (The
      // "attach된 페이지 없음" string also lives in the inline SSE script, so we
      // assert on static-only markers — section header + element ids.)
      expect(html).not.toContain('연결된 Pages');
      expect(html).not.toContain('id="pages-section"');
      expect(html).not.toContain('id="pages-list"');
      // The rest of the dashboard (Attach QR) still renders.
      expect(html).toContain('Attach QR');
    } finally {
      await handle.close();
    }
  });

  it('env 2 dashboard: 인스펙터 URL은 null — target ID 불가 → 대기 hint 표시 (#503)', async () => {
    // env 2(unplugin tunnel)에서 getDashboardState는 pages: null 이고
    // inspectorUrl: null 이다 — unplugin relay는 connected target ID를 노출하지 않아
    // buildChiiInspectorUrl에 필요한 targetId를 알 수 없다. 대시보드는 링크 없이
    // 대기 hint를 표시해야 한다.
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: () => {},
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const html = await (await fetch(handle.url, { headers: { 'Accept-Language': 'ko' } })).text();
      // 링크 없이 대기 힌트 노출
      expect(html).not.toContain('class="inspector-link"');
      expect(html).toContain('class="inspector-hint"');
    } finally {
      await handle.close();
    }
  });

  it('mints a FRESH 6-digit TOTP folded into at= on each getDashboardState call (no stale bake-in)', async () => {
    // Capture the dashboard state by reading the served SSE/HTML attachUrl across
    // two different time windows. Easiest deterministic probe: hit /qr.png twice
    // — but to assert the at= code we read the attach URL out of the dashboard
    // HTML directly, which is built from a fresh getDashboardState() each request.
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: () => {},
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const html = await (await fetch(handle.url)).text();
      // attachUrl is rendered into the url-box with `&` HTML-escaped to `&#38;`,
      // so match `at=<code>` regardless of the preceding (escaped) separator.
      const atMatch = html.match(/at=(\d{6})\b/);
      expect(atMatch).not.toBeNull();
      const code = atMatch?.[1] ?? '';
      // It is a real RFC-6238 code for the secret at "now", not a placeholder.
      const { generateTotp } = await import('../mcp/totp.js');
      const { verifyTotp } = await import('../mcp/totp.js');
      expect(/^\d{6}$/.test(code)).toBe(true);
      expect(verifyTotp(SECRET, code)).toBe(true);
      // Sanity: regenerating at the same step reproduces the code.
      expect(generateTotp(SECRET, Date.now())).toBe(code);
    } finally {
      await handle.close();
    }
  });

  it('SECRET-HANDLING: logs only the local 127.0.0.1 URL — never tunnel host, relay wss, or TOTP', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const joined = out.join('\n');
      // The one log line points at the local dashboard.
      expect(joined).toContain('127.0.0.1');
      // No secret material leaks into the log sink.
      expect(joined).not.toContain('app-host-secret');
      expect(joined).not.toContain('relay-host-secret');
      expect(joined).not.toContain('trycloudflare.com');
      expect(joined).not.toContain(SECRET);
      // No TOTP code in the log (any 6-digit run derived from the secret).
      const { generateTotp } = await import('../mcp/totp.js');
      expect(joined).not.toContain(generateTotp(SECRET, Date.now()));
    } finally {
      await handle.close();
    }
  });
});
