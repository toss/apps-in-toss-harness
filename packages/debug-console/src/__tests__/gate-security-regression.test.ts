/**
 * Regression table for the runtime attach gate.
 *
 * This table is a contract: rows may be added, never removed or loosened
 * without maintainer sign-off. Rows that duplicate cases in gate.test.ts are
 * kept on purpose, so the contract stays readable in one place.
 *
 * Invariants pinned here:
 *  - A page attaches only on a loopback host or a QR test host
 *    (`<label>.private-apps.tossmini.com`, `<label>.private-web.tossmini.com`).
 *    Production hosts, other tossmini hosts and look-alikes are refused before
 *    any query parameter is read.
 *  - A QR test page accepts only a one-label `*.trycloudflare.com` relay with
 *    no port, a 32-hex `at` code and a well-formed `sig`. A loopback page
 *    accepts only a loopback relay.
 *  - A host suffix is never proof of ownership: the signature is mandatory on
 *    a QR test host.
 */

import { describe, expect, it } from 'vitest';
import { evaluateDebugGate } from '../gate.js';

/** Well-formed v2 `sig` shape (session key, window, cert and link signatures); never verifies. */
const SIG = `${'A'.repeat(8)}.${'A'.repeat(86)}`;
const AT = '0123456789abcdef0123456789abcdef';
const TUNNEL_RELAY = 'wss://abc-123.trycloudflare.com';

type Expected =
  | 'attach'
  | 'host'
  | 'opt-in'
  | 'invalid-relay'
  | 'auth'
  | 'update-required'
  | 'relay-signature';

interface Row {
  readonly name: string;
  readonly host: string;
  /** `undefined` keeps the valid default; `null` omits the parameter. */
  readonly relay?: string | null;
  readonly at?: string | null;
  readonly sig?: string | null;
  readonly debug?: string | null;
  readonly expected: Expected;
}

/** Defaults model a fully valid QR-test-host entry; each row overrides one thing. */
const row = (r: Row): Row => r;

function build(r: {
  relay?: string | null;
  at?: string | null;
  sig?: string | null;
  debug?: string | null;
}): URLSearchParams {
  const q = new URLSearchParams();
  const put = (k: string, v: string | null | undefined, dflt: string | null) => {
    const value = v === undefined ? dflt : v;
    if (value !== null) q.set(k, value);
  };
  put('debug', r.debug, '1');
  put('relay', r.relay, TUNNEL_RELAY);
  put('at', r.at, AT);
  put('sig', r.sig, SIG);
  return q;
}

const QR_APPS = 'demo.private-apps.tossmini.com';
const QR_WEB = 'demo.private-web.tossmini.com';

const ROWS: readonly Row[] = [
  // --- positive controls -------------------------------------------------
  row({
    name: 'control: private-apps host, tunnel relay, at, sig',
    host: QR_APPS,
    expected: 'attach',
  }),
  row({
    name: 'control: private-web host, tunnel relay, at, sig',
    host: QR_WEB,
    expected: 'attach',
  }),
  row({
    name: 'control: relay with trailing slash',
    host: QR_APPS,
    relay: `${TUNNEL_RELAY}/`,
    expected: 'attach',
  }),
  row({
    name: 'control: underscore and digits in app label',
    host: 'my_app-2.private-apps.tossmini.com',
    expected: 'attach',
  }),
  row({
    name: 'control: host case-insensitive',
    host: 'DEMO.PRIVATE-APPS.TOSSMINI.COM',
    expected: 'attach',
  }),
  row({
    name: 'control: localhost, loopback relay, no sig',
    host: 'localhost',
    relay: 'wss://127.0.0.1:8443',
    sig: null,
    expected: 'attach',
  }),
  row({
    name: 'control: 127.0.0.1 page, localhost relay',
    host: '127.0.0.1',
    relay: 'wss://localhost:9229/',
    sig: null,
    expected: 'attach',
  }),
  row({
    name: 'control: [::1] page',
    host: '[::1]',
    relay: 'wss://[::1]:8443',
    sig: null,
    expected: 'attach',
  }),
  row({
    name: 'control: 0.0.0.0 page',
    host: '0.0.0.0',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'attach',
  }),
  row({
    name: 'control: *.localhost page',
    host: 'app.localhost',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'attach',
  }),

  // --- production hosts: refused even with every parameter valid ---------
  row({ name: 'production apps host', host: 'demo.apps.tossmini.com', expected: 'host' }),
  row({ name: 'production web host', host: 'demo.web.tossmini.com', expected: 'host' }),
  row({
    name: 'production apps host, uppercase',
    host: 'DEMO.APPS.TOSSMINI.COM',
    expected: 'host',
  }),
  row({
    name: 'production apps host, multi-label prefix',
    host: 'a.b.apps.tossmini.com',
    expected: 'host',
  }),
  row({
    name: 'production web host, multi-label prefix',
    host: 'a.b.web.tossmini.com',
    expected: 'host',
  }),
  row({
    name: 'production apps host, trailing dot',
    host: 'demo.apps.tossmini.com.',
    expected: 'host',
  }),
  row({
    name: 'production apps host without sig',
    host: 'demo.apps.tossmini.com',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'production apps host with loopback relay',
    host: 'demo.apps.tossmini.com',
    relay: 'wss://127.0.0.1:8443',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'production apps host without debug flag',
    host: 'demo.apps.tossmini.com',
    debug: null,
    expected: 'host',
  }),

  // --- other tossmini hosts and look-alikes ------------------------------
  row({ name: 'other tossmini subdomain', host: 'demo.tossmini.com', expected: 'host' }),
  row({ name: 'tossmini apex', host: 'tossmini.com', expected: 'host' }),
  row({
    name: 'other tossmini family label',
    host: 'demo.dev-apps.tossmini.com',
    expected: 'host',
  }),
  row({ name: 'qr suffix without app label', host: 'private-apps.tossmini.com', expected: 'host' }),
  row({
    name: 'qr suffix with empty app label',
    host: '.private-apps.tossmini.com',
    expected: 'host',
  }),
  row({
    name: 'qr web suffix without app label',
    host: 'private-web.tossmini.com',
    expected: 'host',
  }),
  row({ name: 'label glued to qr suffix', host: 'xprivate-apps.tossmini.com', expected: 'host' }),
  row({
    name: 'multi-label prefix before private-apps',
    host: 'a.b.private-apps.tossmini.com',
    expected: 'host',
  }),
  row({
    name: 'multi-label prefix before private-web',
    host: 'a.b.private-web.tossmini.com',
    expected: 'host',
  }),
  row({
    name: 'qr host as a prefix of another domain',
    host: 'demo.private-apps.tossmini.com.example.org',
    expected: 'host',
  }),
  row({
    name: 'qr host with trailing dot',
    host: 'demo.private-apps.tossmini.com.',
    expected: 'host',
  }),
  row({ name: 'different TLD', host: 'demo.private-apps.tossmini.co', expected: 'host' }),
  row({
    name: 'different registrable domain',
    host: 'demo.private-apps.tossmini.example',
    expected: 'host',
  }),
  row({
    name: 'hyphen-joined look-alike domain',
    host: 'demo.private-apps-tossmini.com',
    expected: 'host',
  }),
  row({ name: 'unrelated host', host: 'example.com', expected: 'host' }),
  row({ name: 'trycloudflare page host', host: 'abc.trycloudflare.com', expected: 'host' }),
  row({ name: 'empty host', host: '', expected: 'host' }),
  row({
    name: 'localhost as a label of a foreign domain',
    host: 'localhost.example.org',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'loopback address as a label of a foreign domain',
    host: '127.0.0.1.example.org',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'localhost with trailing dot',
    host: 'localhost.',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'bare ::1 without brackets',
    host: '::1',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'host',
  }),
  row({
    name: 'private-range IPv4 page',
    host: '192.168.0.2',
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'host',
  }),

  // --- opt-in ------------------------------------------------------------
  row({ name: 'qr host, debug flag absent', host: QR_APPS, debug: null, expected: 'opt-in' }),
  row({ name: 'qr host, debug=0', host: QR_APPS, debug: '0', expected: 'opt-in' }),
  row({ name: 'qr host, debug=true', host: QR_APPS, debug: 'true', expected: 'opt-in' }),
  row({
    name: 'localhost, debug flag absent',
    host: 'localhost',
    debug: null,
    relay: 'wss://127.0.0.1:1',
    sig: null,
    expected: 'opt-in',
  }),

  // --- relay shapes on a QR test host ------------------------------------
  row({ name: 'qr host: relay absent', host: QR_APPS, relay: null, expected: 'invalid-relay' }),
  row({ name: 'qr host: relay empty', host: QR_APPS, relay: '', expected: 'invalid-relay' }),
  row({
    name: 'qr host: relay not a URL',
    host: QR_APPS,
    relay: 'not a url',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: ws scheme',
    host: QR_APPS,
    relay: 'ws://abc.trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: https scheme',
    host: QR_APPS,
    relay: 'https://abc.trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: explicit port',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com:8443',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: default port spelled out',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com:443',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: userinfo',
    host: QR_APPS,
    relay: 'wss://user:pw@abc.trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: userinfo naming the tunnel host in front of another host',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com@evil.example',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: path',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com/x',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: query',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com/?x=1',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: empty query marker',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com?',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: fragment',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com/#x',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: multi-label tunnel prefix',
    host: QR_APPS,
    relay: 'wss://a.b.trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: tunnel apex without label',
    host: QR_APPS,
    relay: 'wss://trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: tunnel suffix appended to another domain',
    host: QR_APPS,
    relay: 'wss://abc.trycloudflare.com.evil.example',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: tunnel name glued to another host',
    host: QR_APPS,
    relay: 'wss://evil.example/.trycloudflare.com',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: other hosting domain',
    host: QR_APPS,
    relay: 'wss://abc.example.org',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: loopback relay',
    host: QR_APPS,
    relay: 'wss://127.0.0.1:8443',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: localhost relay',
    host: QR_APPS,
    relay: 'wss://localhost',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: IPv6 loopback relay',
    host: QR_APPS,
    relay: 'wss://[::1]',
    expected: 'invalid-relay',
  }),
  row({
    name: 'qr host: relay that is another QR host',
    host: QR_APPS,
    relay: 'wss://other.private-apps.tossmini.com',
    expected: 'invalid-relay',
  }),

  // --- relay shapes on a loopback page -----------------------------------
  row({
    name: 'loopback page: tunnel relay',
    host: 'localhost',
    relay: TUNNEL_RELAY,
    sig: null,
    expected: 'invalid-relay',
  }),
  row({
    name: 'loopback page: foreign relay',
    host: 'localhost',
    relay: 'wss://evil.example',
    sig: null,
    expected: 'invalid-relay',
  }),
  row({
    name: 'loopback page: loopback look-alike relay',
    host: 'localhost',
    relay: 'wss://127.0.0.1.evil.example',
    sig: null,
    expected: 'invalid-relay',
  }),
  row({
    name: 'loopback page: ws scheme',
    host: 'localhost',
    relay: 'ws://127.0.0.1:8443',
    sig: null,
    expected: 'invalid-relay',
  }),
  row({
    name: 'loopback page: relay with path',
    host: 'localhost',
    relay: 'wss://127.0.0.1:8443/x',
    sig: null,
    expected: 'invalid-relay',
  }),
  row({
    name: 'loopback page: relay with userinfo',
    host: 'localhost',
    relay: 'wss://a@127.0.0.1:8443',
    sig: null,
    expected: 'invalid-relay',
  }),

  // --- auth code ---------------------------------------------------------
  row({ name: 'qr host: at absent', host: QR_APPS, at: null, expected: 'auth' }),
  row({ name: 'qr host: at empty', host: QR_APPS, at: '', expected: 'auth' }),
  row({ name: 'qr host: at too short', host: QR_APPS, at: 'abc123', expected: 'auth' }),
  row({
    name: 'qr host: at uppercase hex',
    host: QR_APPS,
    at: AT.toUpperCase().replace(/^0/, 'A'),
    expected: 'auth',
  }),
  row({ name: 'qr host: at not hex', host: QR_APPS, at: 'z'.repeat(32), expected: 'auth' }),
  row({ name: 'qr host: at too long', host: QR_APPS, at: `${AT}0`, expected: 'auth' }),
  row({
    name: 'qr host: six-digit code from an older debugger',
    host: QR_APPS,
    at: '123456',
    expected: 'update-required',
  }),
  row({ name: 'qr web host: at absent', host: QR_WEB, at: null, expected: 'auth' }),

  // --- signature ---------------------------------------------------------
  row({ name: 'qr host: sig absent', host: QR_APPS, sig: null, expected: 'relay-signature' }),
  row({ name: 'qr host: sig empty', host: QR_APPS, sig: '', expected: 'relay-signature' }),
  row({
    name: 'qr host: sig too short',
    host: QR_APPS,
    sig: 'S'.repeat(85),
    expected: 'relay-signature',
  }),
  row({
    name: 'qr host: sig too long',
    host: QR_APPS,
    sig: 'S'.repeat(87),
    expected: 'relay-signature',
  }),
  row({
    name: 'qr host: sig with non-base64url characters',
    host: QR_APPS,
    sig: `${'S'.repeat(85)}+`,
    expected: 'relay-signature',
  }),
  row({
    name: 'qr host: sig with padding',
    host: QR_APPS,
    sig: `${'S'.repeat(85)}=`,
    expected: 'relay-signature',
  }),
  row({ name: 'qr web host: sig absent', host: QR_WEB, sig: null, expected: 'relay-signature' }),
];

describe('attach gate regression table', () => {
  it('keeps the contract size (a table that shrinks needs maintainer sign-off)', () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(88);
  });

  it('has unique row names', () => {
    expect(new Set(ROWS.map((r) => r.name)).size).toBe(ROWS.length);
  });

  it('contains at least one attach row per host family', () => {
    const attach = ROWS.filter((r) => r.expected === 'attach').map((r) => r.host.toLowerCase());
    expect(attach.some((h) => h.endsWith('.private-apps.tossmini.com'))).toBe(true);
    expect(attach.some((h) => h.endsWith('.private-web.tossmini.com'))).toBe(true);
    expect(attach.some((h) => h === 'localhost')).toBe(true);
  });

  it.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, r) => {
    const result = evaluateDebugGate({ hostname: r.host, searchParams: build(r) });
    const got = result.attach ? 'attach' : result.reason;
    expect(got).toBe(r.expected);
  });

  it('refuses every production-host row regardless of the other parameters', () => {
    for (const host of ['demo.apps.tossmini.com', 'demo.web.tossmini.com']) {
      for (const relay of [TUNNEL_RELAY, 'wss://127.0.0.1:8443', null]) {
        for (const sig of [SIG, null]) {
          const result = evaluateDebugGate({
            hostname: host,
            searchParams: build({ relay, sig }),
          });
          expect(result).toEqual({ attach: false, reason: 'host' });
        }
      }
    }
  });

  it('there is no device-side verifier: a stray verifyTotpCode neither blocks nor admits', () => {
    // The relay secret never enters a bundle, so the gate has no verifier hook. A caller that
    // still passes one (an old integration) must get the same result as without it.
    const stray = (verifyTotpCode: () => boolean) =>
      ({ hostname: QR_APPS, verifyTotpCode }) as unknown as Parameters<typeof evaluateDebugGate>[0];
    const ok = evaluateDebugGate({ hostname: QR_APPS, searchParams: build({}) });
    expect(ok.attach).toBe(true);
    for (const verdict of [true, false]) {
      expect(evaluateDebugGate({ ...stray(() => verdict), searchParams: build({}) })).toEqual(ok);
      // An accepting verifier cannot stand in for a missing or malformed code.
      expect(
        evaluateDebugGate({ ...stray(() => verdict), searchParams: build({ at: null }) }),
      ).toEqual({ attach: false, reason: 'auth' });
    }
  });
});
