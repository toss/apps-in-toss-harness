/**
 * Unit tests for the runtime debug activation gate (Layers B and C).
 *
 * Covers every row of the decision matrix from
 * docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md plus edge cases.
 * No real device, no Chii, no WebSocket — pure logic only.
 *
 * Layer A (build-time) is intentionally NOT tested here: it is enforced by the
 * consumer's `if (__DEBUG_BUILD__)` guard around the import site, not by
 * `evaluateDebugGate`. See src/in-app/gate.ts for the rationale.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateDebugGate,
  isDebugAllowedHost,
  isLocalhostHost,
  isPrivateAppsHost,
  isTossminiHost,
} from '../gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Query params for a test. A well-formed `sig` is appended unless the query
 * already names one, so the cases that exercise other layers do not have to
 * restate it. Use `rawParams` to build a query exactly as written.
 */
function params(query: string): URLSearchParams {
  const built = new URLSearchParams(query);
  if (!built.has('sig')) built.set('sig', SIG);
  return built;
}

function rawParams(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

/**
 * A valid dogfood host — a `*.private-apps.tossmini.com` subdomain. Layer B1
 * passes for this host. Tests that are exercising Layers B2 / C use this as
 * the default host so they isolate the layer under test; the Layer B1 block
 * below varies the host explicitly.
 */
const VALID_HOST = 'example-app.private-apps.tossmini.com';

/** A well-formed signature (86 base64url characters). The gate checks its shape only. */
/** Well-formed v2 `sig` shape (session key, window, cert and link signatures); never verifies. */
const SIG = `${'A'.repeat(8)}.${'A'.repeat(86)}`;

/** A valid dogfood gate-passing set of query params. */
const VALID_PARAMS = params(
  `_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com%2F&at=0123456789abcdef0123456789abcdef&sig=${SIG}`,
);

/** The same set without the TOTP `at=` code (mandatory on every tossmini host). */
const PARAMS_NO_AT = params(
  `_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com%2F&sig=${SIG}`,
);

/**
 * Evaluate the gate with the valid dogfood host by default, so a test that
 * only varies query params does not have to restate the host every time.
 * Pass an explicit `hostname` to exercise Layer B1.
 */
function gate(searchParams: URLSearchParams, hostname: string = VALID_HOST) {
  return evaluateDebugGate({ hostname, searchParams });
}

// ---------------------------------------------------------------------------
// Layer B1 — host allowlist (the security gate)
// ---------------------------------------------------------------------------

describe('Layer B1 — host allowlist', () => {
  it.each(['example-app.apps.tossmini.com', 'example-app.web.tossmini.com'])(
    'production host %s is refused at B1 even with a full valid parameter set',
    (host) => {
      const result = gate(VALID_PARAMS, host);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('host');
    },
  );

  it('blocks an arbitrary unrelated host', () => {
    const result = gate(VALID_PARAMS, 'example.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks an empty hostname', () => {
    const result = gate(VALID_PARAMS, '');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks a spoofed host where the suffix is not a real subdomain segment', () => {
    // `.includes()` would wrongly accept this; the suffix check does not.
    const result = gate(VALID_PARAMS, 'private-apps.tossmini.com.evil.example');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it.each([
    'private-apps.tossmini.com',
    'private-web.tossmini.com',
    'evil-private-apps.tossmini.com',
    'evil-private-web.tossmini.com',
    'example-app.private-apps.tossmini.com.evil.example',
    'example-app.private-web.tossmini.com.evil.example',
    'example-app.private-apps.tossmini.com.',
    'example-app.private-apps.tossmini.com:443',
  ])('refuses the lookalike host %s at B1', (host) => {
    const result = gate(VALID_PARAMS, host);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('passes a *.private-web.tossmini.com QR test host', () => {
    const result = gate(VALID_PARAMS, 'example-app.private-web.tossmini.com');
    expect(result.attach).toBe(true);
  });

  it('matches the QR test host case-insensitively', () => {
    const result = gate(VALID_PARAMS, 'Example-App.PRIVATE-APPS.tossmini.com');
    expect(result.attach).toBe(true);
  });

  it('passes a *.private-apps.tossmini.com dogfood host', () => {
    const result = gate(VALID_PARAMS, 'example-app.private-apps.tossmini.com');
    expect(result.attach).toBe(true);
  });

  it('is checked before the entry gate — a bad host blocks even with no _deploymentId', () => {
    const result = gate(params('debug=1&relay=wss://r.example.com/'), 'example.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });
});

describe('isPrivateAppsHost', () => {
  it('accepts a *.private-apps.tossmini.com subdomain', () => {
    expect(isPrivateAppsHost('example-app.private-apps.tossmini.com')).toBe(true);
  });

  it('rejects a production *.apps.tossmini.com host', () => {
    expect(isPrivateAppsHost('example-app.apps.tossmini.com')).toBe(false);
  });

  it('rejects a suffix-spoofing host', () => {
    expect(isPrivateAppsHost('x.private-apps.tossmini.com.evil.example')).toBe(false);
  });

  it('rejects a bare private-apps.tossmini.com', () => {
    expect(isPrivateAppsHost('private-apps.tossmini.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPrivateAppsHost('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer B2 — `_deploymentId` is reported, never required
// ---------------------------------------------------------------------------

describe('Layer B2 — _deploymentId is optional', () => {
  const RELAY = 'relay=wss://abc-def-ghi.trycloudflare.com/';

  // Regression (real device, web-framework 3.7.0, 2026-10-14): the runtime
  // consumes `_deploymentId` and forwards only debug/relay/at to the page URL.
  it('private-apps host: attaches without _deploymentId when debug, relay and at are present', () => {
    const result = gate(params(`debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`));
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('private-apps host: blocks with auth when at= is absent (the bar B2 used to provide)', () => {
    const result = gate(params(`debug=1&${RELAY}`));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('private-apps host: an empty at= is blocked the same as an absent one', () => {
    const result = gate(params(`debug=1&${RELAY}&at=`));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('private-apps host: still reports _deploymentId when present', () => {
    const result = gate(
      params(`_deploymentId=abc-123&debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`),
    );
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('abc-123');
  });

  it('private-apps host: an empty _deploymentId no longer blocks', () => {
    const result = gate(
      params(`_deploymentId=&debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`),
    );
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('blocks an entirely empty query string at the opt-in layer', () => {
    const result = gate(params(''));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('passes the canonical valid param set', () => {
    expect(gate(VALID_PARAMS).attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C — explicit opt-in gate (debug=1 + relay)
// ---------------------------------------------------------------------------

describe('Layer C — opt-in gate (debug=1)', () => {
  it('blocks when debug param is absent', () => {
    const result = gate(params('_deploymentId=uuid&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=0', () => {
    const result = gate(params('_deploymentId=uuid&debug=0&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug is an empty string', () => {
    const result = gate(params('_deploymentId=uuid&debug=&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=true (string, not "1")', () => {
    const result = gate(params('_deploymentId=uuid&debug=true&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });
});

// ---------------------------------------------------------------------------
// Layer C — relay URL validation
// ---------------------------------------------------------------------------

describe('Layer C — relay URL validation', () => {
  it('blocks when relay param is absent', () => {
    const result = gate(params('_deploymentId=uuid&debug=1'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is an empty string', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay='));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is not a valid URL', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=not-a-url'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses http: scheme', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=http://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses https: scheme', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=https://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses plain ws: (no TLS)', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=ws://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is a random word', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=foobar'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('passes when relay uses wss: scheme', () => {
    const result = gate(
      params(
        '_deploymentId=uuid&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
  });

  it('accepts a trycloudflare wss URL (typical Phase 1 value)', () => {
    const result = gate(
      params(
        '_deploymentId=019e3b40&debug=1&relay=wss://abc-def.trycloudflare.com/&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.relayUrl).toBe('wss://abc-def.trycloudflare.com/');
    }
  });

  // -------------------------------------------------------------------------
  // G10 — relay URL host allowlist. A `wss:` scheme alone only proves the
  // transport is encrypted, not WHO is on the other end: a scheme-only check
  // lets an attacker point `relay=` at their own `wss://` endpoint, which
  // attach.ts then injects as a `<script src>` — arbitrary JS execution. The
  // relay host must also end in `.trycloudflare.com` (the legit relay is
  // always a cloudflared quick tunnel) or be localhost.
  // -------------------------------------------------------------------------

  it('(a) blocks an attacker-controlled relay host', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=wss://attacker.example/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('(b) blocks a suffix-spoofing relay host', () => {
    const result = gate(
      params('_deploymentId=uuid&debug=1&relay=wss://evil.trycloudflare.com.attacker.example/'),
    );
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('(c) passes a normal trycloudflare relay host', () => {
    const result = gate(
      params(
        '_deploymentId=uuid&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Attach result — field values
// ---------------------------------------------------------------------------

describe('GateResultAttach field values', () => {
  it('exposes relayUrl as the normalised wss URL', () => {
    const result = gate(
      params(
        '_deploymentId=deploy-123&debug=1&relay=wss%3A%2F%2Fabc-def-ghi.trycloudflare.com&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.relayUrl).toBe('wss://abc-def-ghi.trycloudflare.com/');
    }
  });

  it('exposes deploymentId from the _deploymentId param', () => {
    const result = gate(
      params(
        '_deploymentId=019e3b40-the-real-id&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.deploymentId).toBe('019e3b40-the-real-id');
    }
  });

  it('tolerates extra unrelated query params', () => {
    const result = gate(
      params(
        '_deploymentId=uuid&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&foo=bar&extra=123&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C3 — auth code shape (the page holds no secret and verifies no value)
// ---------------------------------------------------------------------------

describe('Layer C3 — auth code shape', () => {
  it('passes when at= is a well-formed code', () => {
    const result = gate(VALID_PARAMS);
    expect(result.attach).toBe(true);
  });

  it('blocks a malformed or absent code on a QR host (reason: auth)', () => {
    for (const bad of ['12345', 'SHORT', '0123456789ABCDEF0123456789ABCDEF', 'g'.repeat(32), '']) {
      const result = evaluateDebugGate({
        hostname: VALID_HOST,
        searchParams: new URLSearchParams({
          debug: '1',
          relay: 'wss://abc-def-ghi.trycloudflare.com/',
          at: bad,
        }),
      });
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('auth');
    }
  });

  it('treats a six-digit code as an auth failure', () => {
    const result = gate(params('debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=123456'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('blocks a 33-character code on a tossmini host', () => {
    const result = gate(
      params(`debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=${'a'.repeat(33)}`),
    );
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('auth check runs AFTER relay URL validation (invalid-relay still wins)', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=http://r.example.com/&at=0123456789abcdef0123456789abcdef',
    );
    const result = evaluateDebugGate({ hostname: VALID_HOST, searchParams: params_ });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('auth check runs AFTER opt-in check (opt-in still wins when debug absent)', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&relay=wss://r.example.com/&at=0123456789abcdef0123456789abcdef',
    );
    const result = evaluateDebugGate({ hostname: VALID_HOST, searchParams: params_ });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('does not surface the code value in any property of the blocked result', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=SECRET_CODE',
    );
    const result = evaluateDebugGate({ hostname: VALID_HOST, searchParams: params_ });
    expect(result.attach).toBe(false);
    // The reason must be an enum value, not contain any code fragment.
    if (!result.attach) {
      expect(result.reason).toBe('auth');
      expect(JSON.stringify(result)).not.toContain('SECRET_CODE');
    }
  });
});

// ---------------------------------------------------------------------------
// Full decision-matrix rows (explicit coverage)
// ---------------------------------------------------------------------------

describe('Full decision matrix', () => {
  // The `release / any / any → code absent` row is Layer A. It is not a row
  // of this function — `evaluateDebugGate` only ever runs in a debug build,
  // because the consumer's `if (__DEBUG_BUILD__)` guard DCEs the import out of
  // release bundles. There is nothing to assert about it here; the guarantee
  // is the absence of code, verified by the consumer's bundle output.

  it('row: production host / any / any → BLOCKED (host)', () => {
    for (const host of ['example-app.apps.tossmini.com', 'example-app.web.tossmini.com']) {
      const result = gate(VALID_PARAMS, host);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('host');
    }
  });

  it('row: QR test host / at absent → BLOCKED (auth — code mandatory)', () => {
    for (const host of [
      'example-app.private-apps.tossmini.com',
      'example-app.private-web.tossmini.com',
    ]) {
      const result = gate(PARAMS_NO_AT, host);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('auth');
    }
  });

  it('row: non-tossmini host / any / any → BLOCKED (host)', () => {
    const result = gate(VALID_PARAMS, 'example.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('row: private-apps host / _deploymentId absent / debug=1 / valid relay / at absent → BLOCKED (auth)', () => {
    const result = gate(params('debug=1&relay=wss://abc-def-ghi.trycloudflare.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('row: private-apps host / _deploymentId present / debug absent → BLOCKED (opt-in)', () => {
    const result = gate(params('_deploymentId=uuid&relay=wss://r.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('row: private-apps host / debug=1 / relay absent → BLOCKED (invalid-relay)', () => {
    const result = gate(params('_deploymentId=uuid&debug=1'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('row: private-apps host / _deploymentId present / debug=1 / valid wss relay / at present → ATTACH', () => {
    const result = gate(
      params(
        '_deploymentId=uuid&debug=1&relay=wss://abc-def-ghi.trycloudflare.com/&at=0123456789abcdef0123456789abcdef',
      ),
    );
    expect(result.attach).toBe(true);
  });

  it('row: localhost / _deploymentId (skipped) / debug=1 / valid wss relay → ATTACH', () => {
    const result = gate(params('debug=1&relay=wss://127.0.0.1:9100/'), '127.0.0.1');
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('row: localhost / debug absent → BLOCKED (opt-in), not entry', () => {
    const result = gate(params('relay=wss://r.example.com/'), '127.0.0.1');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });
});

// ---------------------------------------------------------------------------
// Positive-allowlist kill-switch: isDebugAllowedHost (#665)
// ---------------------------------------------------------------------------

describe('isDebugAllowedHost — positive-allowlist kill-switch (#665)', () => {
  // ── Allowed hosts ──────────────────────────────────────────────────────────

  it('allows localhost', () => {
    expect(isDebugAllowedHost('localhost')).toBe(true);
  });

  it('allows 127.0.0.1', () => {
    expect(isDebugAllowedHost('127.0.0.1')).toBe(true);
  });

  it('allows [::1] (bracketed IPv6 loopback — as URL parser produces)', () => {
    // URL parser converts http://[::1]:3000 → hostname = '[::1]' (with brackets).
    expect(isDebugAllowedHost('[::1]')).toBe(true);
  });

  it('allows *.private-apps.tossmini.com (env 3 dogfood)', () => {
    expect(isDebugAllowedHost('example-app.private-apps.tossmini.com')).toBe(true);
    expect(isDebugAllowedHost('my-app.private-apps.tossmini.com')).toBe(true);
  });

  it('allows *.private-web.tossmini.com (QR test, web-framework 3.0.0 to 3.1.0)', () => {
    expect(isDebugAllowedHost('example-app.private-web.tossmini.com')).toBe(true);
  });

  // ── Blocked hosts ──────────────────────────────────────────────────────────

  it('blocks arbitrary external host', () => {
    expect(isDebugAllowedHost('example.com')).toBe(false);
    expect(isDebugAllowedHost('evil.trycloudflare.com.attacker.com')).toBe(false);
  });

  it('blocks *.trycloudflare.com — 환경 2 제거로 allowlist에서 빠졌다 (#103)', () => {
    // 환경 3의 quick tunnel은 CDP relay 소켓만 나르고 페이지 origin이 아니다.
    expect(isDebugAllowedHost('abc-def-ghi.trycloudflare.com')).toBe(false);
  });

  it('blocks bare tossmini.com (no subdomain label)', () => {
    expect(isDebugAllowedHost('tossmini.com')).toBe(false);
  });

  it('blocks both production host families', () => {
    expect(isDebugAllowedHost('example-app.apps.tossmini.com')).toBe(false);
    expect(isDebugAllowedHost('example-app.web.tossmini.com')).toBe(false);
    expect(isDebugAllowedHost('apps.tossmini.com')).toBe(false);
  });

  it('blocks suffix tricks, a trailing dot and a port', () => {
    for (const host of [
      'private-apps.tossmini.com.evil.example',
      'private-web.tossmini.com.evil.example',
      'evil-private-apps.tossmini.com',
      'evil-private-web.tossmini.com',
      'example-app.private-apps.tossmini.com.',
      'example-app.private-web.tossmini.com:8080',
    ]) {
      expect(isDebugAllowedHost(host)).toBe(false);
    }
  });

  it('blocks a spoofed tossmini suffix that is not a real subdomain segment', () => {
    expect(isDebugAllowedHost('x.tossmini.com.evil.example')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTossminiHost
// ---------------------------------------------------------------------------

describe('isTossminiHost', () => {
  it('accepts QR test hosts', () => {
    expect(isTossminiHost('example-app.private-apps.tossmini.com')).toBe(true);
  });

  it('accepts production hosts (a family filter, not an allow rule)', () => {
    expect(isTossminiHost('example-app.apps.tossmini.com')).toBe(true);
    expect(isTossminiHost('apps.tossmini.com')).toBe(true);
  });

  it('rejects bare tossmini.com (leading dot forces a subdomain label)', () => {
    expect(isTossminiHost('tossmini.com')).toBe(false);
  });

  it('rejects a spoofed suffix (endsWith, not includes)', () => {
    expect(isTossminiHost('x.tossmini.com.evil.example')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate flow on the QR test host families
//
// Both QR test families (`private-apps`, `private-web`) take the same path:
// B1 passes on the host, B2 does not require `_deploymentId`, and C3 makes the
// `at=` code mandatory even without an injected verifier (the relay stays the
// authoritative verifier of the code value).
// ---------------------------------------------------------------------------

describe.each(['example-app.private-apps.tossmini.com', 'example-app.private-web.tossmini.com'])(
  'QR test host gate flow (%s)',
  (HOST) => {
    const RELAY = 'relay=wss%3A%2F%2Fabc.trycloudflare.com%2F';

    it('attaches with debug + wss relay + at code, no _deploymentId', () => {
      const result = gate(params(`debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`), HOST);
      expect(result.attach).toBe(true);
      if (result.attach) expect(result.deploymentId).toBe('');
    });

    it('reports _deploymentId when it is present', () => {
      const result = gate(
        params(`_deploymentId=abc-123&debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`),
        HOST,
      );
      expect(result.attach).toBe(true);
      if (result.attach) expect(result.deploymentId).toBe('abc-123');
    });

    it('blocks without an at= code even when no verifier is injected (mandatory code)', () => {
      const result = gate(params(`debug=1&${RELAY}`), HOST);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('auth');
    });

    it('blocks an empty at= value the same as an absent one', () => {
      const result = gate(params(`debug=1&${RELAY}&at=`), HOST);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('auth');
    });

    it.each(['a'.repeat(31), 'A'.repeat(32), 'g'.repeat(32)])(
      'blocks a malformed at= code (%s) without a verifier',
      (at) => {
        const result = gate(params(`debug=1&${RELAY}&at=${at}`), HOST);
        expect(result.attach).toBe(false);
        if (!result.attach) expect(result.reason).toBe('auth');
      },
    );

    it('still requires debug=1 opt-in', () => {
      const result = gate(params(`${RELAY}&at=0123456789abcdef0123456789abcdef`), HOST);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('opt-in');
    });

    it('still rejects a non-wss relay', () => {
      const result = gate(
        params(
          'debug=1&relay=https%3A%2F%2Fabc.trycloudflare.com%2F&at=0123456789abcdef0123456789abcdef',
        ),
        HOST,
      );
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('invalid-relay');
    });

    it('the gate does not judge the code value (the relay does)', () => {
      const result = evaluateDebugGate({
        hostname: HOST,
        searchParams: params(`debug=1&${RELAY}&at=99999999999999999999999999999999`),
      });
      expect(result.attach).toBe(true);
    });
  },
);

describe('production hosts never attach', () => {
  const RELAY = 'relay=wss%3A%2F%2Fabc.trycloudflare.com%2F';

  it.each(['example-app.apps.tossmini.com', 'example-app.web.tossmini.com'])(
    '%s is refused with every other layer satisfied',
    (host) => {
      const search = params(
        `_deploymentId=abc&debug=1&${RELAY}&at=0123456789abcdef0123456789abcdef`,
      );
      const result = gate(search, host);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('host');
    },
  );

  it('localhost still ignores at=', () => {
    const result = gate(params('debug=1&relay=wss%3A%2F%2Flocalhost%3A9100'), 'localhost');
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isLocalhostHost — 127.x spoofing guard (#665 작업 A)
// ---------------------------------------------------------------------------

describe('isLocalhostHost — 127.x spoofing resistance', () => {
  // ── 허용 케이스 ─────────────────────────────────────────────────────────────
  it('allows 127.0.0.1', () => {
    expect(isLocalhostHost('127.0.0.1')).toBe(true);
  });

  it('allows 127.x.x.x (full 127/8 loopback block)', () => {
    expect(isLocalhostHost('127.1.2.3')).toBe(true);
    expect(isLocalhostHost('127.255.255.255')).toBe(true);
  });

  it('allows localhost', () => {
    expect(isLocalhostHost('localhost')).toBe(true);
  });

  it('allows *.localhost subdomain', () => {
    expect(isLocalhostHost('app.localhost')).toBe(true);
  });

  it('allows [::1]', () => {
    expect(isLocalhostHost('[::1]')).toBe(true);
  });

  // ── 스푸핑 차단 ─────────────────────────────────────────────────────────────
  it('blocks 127.evil.com (startsWith 취약점 — 수정 후 차단되어야 함)', () => {
    // 작업 A 수정 전: startsWith('127.')이라 true를 반환하는 취약점.
    // 수정 후: 정규식 /^127\.\d+\.\d+\.\d+$/ 로 차단해야 함.
    expect(isLocalhostHost('127.evil.com')).toBe(false);
  });

  it('blocks 127.0.0.1.evil.com (suffix spoof)', () => {
    expect(isLocalhostHost('127.0.0.1.evil.com')).toBe(false);
  });

  it('blocks arbitrary host that starts with "127." but is not loopback', () => {
    expect(isLocalhostHost('127.not-loopback.example')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Positive-allowlist kill-switch: localhost attach path (#665)
// ---------------------------------------------------------------------------

describe('evaluateDebugGate — localhost (env 1) attach path', () => {
  it('attaches on localhost with debug=1 and valid relay (no _deploymentId required)', () => {
    const result = evaluateDebugGate({
      hostname: 'localhost',
      // A local dev relay is itself localhost — exercises the localhost
      // branch of the G10 relay host allowlist (isRelayAllowedHost).
      searchParams: params('debug=1&relay=wss://localhost:9222/'),
    });
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('attaches on 127.0.0.1 with debug=1 and valid relay', () => {
    const result = evaluateDebugGate({
      hostname: '127.0.0.1',
      searchParams: params('debug=1&relay=wss://127.0.0.1:9222/'),
    });
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Relay shape, host pairing and signature (Layers C2 and C4)
// ---------------------------------------------------------------------------

describe('relay URL shape and host pairing', () => {
  const AT = 'at=0123456789abcdef0123456789abcdef';
  const QR_HOST = 'example-app.private-apps.tossmini.com';

  /** Gate result for a relay value on a given page host (signature supplied). */
  function relayOn(relay: string, host: string) {
    return gate(params(`debug=1&relay=${encodeURIComponent(relay)}&${AT}`), host);
  }

  it.each([
    'wss://abc-def.trycloudflare.com',
    'wss://abc-def.trycloudflare.com/',
    'wss://ABC-DEF.trycloudflare.com',
  ])('QR test page accepts the tunnel relay %s', (relay) => {
    expect(relayOn(relay, QR_HOST).attach).toBe(true);
  });

  it.each([
    ['userinfo', 'wss://user:pass@abc.trycloudflare.com'],
    ['username only', 'wss://user@abc.trycloudflare.com'],
    ['explicit port', 'wss://abc.trycloudflare.com:8443'],
    ['explicit default port', 'wss://abc.trycloudflare.com:443'],
    ['path', 'wss://abc.trycloudflare.com/relay'],
    ['query', 'wss://abc.trycloudflare.com/?x=1'],
    ['empty query', 'wss://abc.trycloudflare.com/?'],
    ['hash', 'wss://abc.trycloudflare.com/#x'],
    ['empty hash', 'wss://abc.trycloudflare.com/#'],
    ['multi-label tunnel', 'wss://a.b.trycloudflare.com'],
    ['foreign host', 'wss://attacker.example'],
    ['suffix lookalike', 'wss://abc.trycloudflare.com.attacker.example'],
    ['bare suffix', 'wss://trycloudflare.com'],
    ['loopback relay on a QR page', 'wss://127.0.0.1:9100'],
    ['localhost relay on a QR page', 'wss://localhost'],
  ])('QR test page refuses %s', (_name, relay) => {
    const result = relayOn(relay, QR_HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it.each(['wss://localhost:9100', 'wss://127.0.0.1', 'wss://127.0.0.1:9100/', 'wss://[::1]:9100'])(
    'loopback page accepts the loopback relay %s',
    (relay) => {
      expect(relayOn(relay, 'localhost').attach).toBe(true);
    },
  );

  it.each([
    'wss://abc-def.trycloudflare.com',
    'wss://attacker.example',
    'wss://localhost:9100/path',
    'wss://user@localhost:9100',
    'wss://localhost:9100/?x=1',
  ])('loopback page refuses %s', (relay) => {
    const result = relayOn(relay, 'localhost');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it.each(['a.b.private-apps.tossmini.com', 'a.b.private-web.tossmini.com'])(
    'multi-label page host %s is refused at B1',
    (host) => {
      const result = gate(VALID_PARAMS, host);
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('host');
    },
  );
});

describe('relay signature shape (Layer C4)', () => {
  const BASE =
    'debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com&at=0123456789abcdef0123456789abcdef';
  const HOST = 'example-app.private-web.tossmini.com';

  it('QR test page without sig is blocked as relay-signature', () => {
    const result = gate(rawParams(BASE), HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('relay-signature');
  });

  it.each([
    '',
    'short',
    'S'.repeat(85),
    'S'.repeat(86), // the retired single-signature (v1) shape
    'S'.repeat(87),
    `${'S'.repeat(85)}=`,
    `${'S'.repeat(85)}+`,
    // the retired self-contained certificate shape (key, window, cert sig, link sig)
    `BA${'A'.repeat(85)}.1800000000.1800001200.${'A'.repeat(86)}.${'A'.repeat(86)}`,
    `${'A'.repeat(7)}.${'A'.repeat(86)}`,
    `${'A'.repeat(9)}.${'A'.repeat(86)}`,
    `${'A'.repeat(8)}.${'A'.repeat(85)}`,
    `${'A'.repeat(8)}${'A'.repeat(86)}`,
  ])('QR test page with malformed sig %j is blocked as relay-signature', (sig) => {
    const result = gate(rawParams(`${BASE}&sig=${encodeURIComponent(sig)}`), HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('relay-signature');
  });

  it('QR test page with a well-formed sig attaches (verification happens in attach.ts)', () => {
    expect(gate(rawParams(`${BASE}&sig=${SIG}`), HOST).attach).toBe(true);
  });

  it('a bad at code is reported before the signature', () => {
    const result = gate(rawParams('debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com&at=zz'), HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('loopback page needs no sig', () => {
    const result = gate(rawParams('debug=1&relay=wss%3A%2F%2F127.0.0.1%3A9100'), '127.0.0.1');
    expect(result.attach).toBe(true);
  });
});

describe('short codes', () => {
  it('a six-digit, seven-digit or non-numeric short code is an auth failure', () => {
    for (const at of ['123456', '000000', '1234567', '12345a']) {
      const result = gate(rawParams(`debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com&at=${at}`));
      expect(result.attach).toBe(false);
      if (!result.attach) expect(result.reason).toBe('auth');
    }
  });
});
