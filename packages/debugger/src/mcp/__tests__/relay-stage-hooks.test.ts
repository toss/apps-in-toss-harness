/**
 * Relay stage hooks (`onTargetScriptServed` / `onWsUpgrade` / `onTargetClose`) —
 * REAL chii + real sockets, same harness as relay-auth-e2e.test.ts.
 *
 * Pins:
 *   - target vs client upgrade paths are told apart (`/target/<id>` vs `/client/<id>`),
 *     including the `/at/<code>/` path-prefix form;
 *   - a rejected target upgrade reports `accepted: false`; an accepted one `true`;
 *   - `/target.js` serving is reported once per served script and not for a 401;
 *   - the observer fires even with NO TOTP gate (`verifyAuth` undefined);
 *   - a target socket close fires `onTargetClose`;
 *   - SECRET-HANDLING: no hook payload carries the code, `at=`, `/at/`, the id or any URL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, type RelayWsUpgradeEvent, startChiiRelay } from '../chii-relay.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const TEST_SECRET = 'deadbeef'.repeat(8);

function wrongCode(): string {
  const now = Date.now();
  const valid = new Set([
    generateTotp(TEST_SECRET, now - 30_000),
    generateTotp(TEST_SECRET, now),
    generateTotp(TEST_SECRET, now + 30_000),
  ]);
  for (let digit = 0; digit <= 9; digit++) {
    const candidate = String(digit).repeat(6);
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error('no invalid candidate found');
}

function dialWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

function dialWsAwaitClose(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('close', (code) => resolve(code));
    ws.on('error', (err) => reject(err));
  });
}

async function waitFor(pred: () => boolean, ms = 2_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}

interface Seen {
  upgrades: RelayWsUpgradeEvent[];
  scriptServed: number;
  targetCloses: number;
}

function newSeen(): Seen {
  return { upgrades: [], scriptServed: 0, targetCloses: 0 };
}

describe('relay stage hooks — TOTP gate on', () => {
  let relay: ChiiRelay;
  const seen = newSeen();

  beforeAll(async () => {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth was not built');
    relay = await startChiiRelay({
      port: 0,
      verifyAuth,
      onWsUpgrade: (e) => seen.upgrades.push(e),
      onTargetScriptServed: () => {
        seen.scriptServed += 1;
      },
      onTargetClose: () => {
        seen.targetCloses += 1;
      },
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('reports an accepted target upgrade (path-prefix form) and then its close', async () => {
    seen.upgrades.length = 0;
    seen.targetCloses = 0;
    const code = generateTotp(TEST_SECRET);
    const ws = await dialWs(
      `ws://127.0.0.1:${relay.port}/at/${code}/target/stage-hook-id?${new URLSearchParams({ url: 'https://example.invalid/p', title: 't' })}`,
    );
    await waitFor(() => seen.upgrades.length > 0);
    expect(seen.upgrades).toEqual([{ kind: 'target', accepted: true }]);
    expect(seen.targetCloses).toBe(0);
    ws.close();
    await waitFor(() => seen.targetCloses > 0);
    expect(seen.targetCloses).toBe(1);
  });

  it('reports a rejected target upgrade as accepted:false and fires no target close', async () => {
    seen.upgrades.length = 0;
    seen.targetCloses = 0;
    const closeCode = await dialWsAwaitClose(
      `ws://127.0.0.1:${relay.port}/at/${wrongCode()}/target/stage-bad-id?url=u`,
    );
    expect(closeCode).toBe(4401);
    await waitFor(() => seen.upgrades.length > 0);
    expect(seen.upgrades).toEqual([{ kind: 'target', accepted: false }]);
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.targetCloses).toBe(0);
  });

  it('tells a daemon /client/<id> upgrade (query form) apart from a target', async () => {
    seen.upgrades.length = 0;
    const code = generateTotp(TEST_SECRET);
    // The client connection only needs the upgrade observed, not a working session.
    await Promise.race([
      dialWsAwaitClose(
        `ws://127.0.0.1:${relay.port}/client/stage-client?target=nope&at=${encodeURIComponent(code)}`,
      ).catch(() => -1),
      new Promise<number>((r) => setTimeout(() => r(-1), 500)),
    ]);
    await waitFor(() => seen.upgrades.length > 0);
    expect(seen.upgrades[0]).toEqual({ kind: 'client', accepted: true });
  });

  it('counts /target.js only when it is actually served (valid code), not on a 401', async () => {
    seen.scriptServed = 0;
    const bad = await fetch(`${relay.baseUrl}/at/${wrongCode()}/target.js`);
    expect(bad.status).toBe(401);
    expect(seen.scriptServed).toBe(0);

    const ok = await fetch(`${relay.baseUrl}/at/${generateTotp(TEST_SECRET)}/target.js`);
    expect(ok.status).toBe(200);
    expect(seen.scriptServed).toBe(1);
  });

  it('never exposes a code, at=, /at/, the target id or a URL in any hook payload', async () => {
    seen.upgrades.length = 0;
    const code = generateTotp(TEST_SECRET);
    const ws = await dialWs(
      `ws://127.0.0.1:${relay.port}/at/${code}/target/secret-probe-id?url=https%3A%2F%2Fexample.invalid%2F&title=t`,
    );
    await waitFor(() => seen.upgrades.length > 0);
    ws.close();
    const dump = JSON.stringify(seen);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain('at=');
    expect(dump).not.toContain('/at/');
    expect(dump).not.toContain('secret-probe-id');
    expect(dump).not.toContain('example.invalid');
    // payload shape is exactly {kind, accepted}
    for (const e of seen.upgrades) expect(Object.keys(e).sort()).toEqual(['accepted', 'kind']);
  });
});

describe('relay stage hooks — no TOTP gate (verifyAuth undefined)', () => {
  let relay: ChiiRelay;
  const seen = newSeen();

  beforeAll(async () => {
    relay = await startChiiRelay({
      port: 0,
      onWsUpgrade: (e) => seen.upgrades.push(e),
      onTargetScriptServed: () => {
        seen.scriptServed += 1;
      },
      onTargetClose: () => {
        seen.targetCloses += 1;
      },
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('still reports target upgrades, script serving and target close', async () => {
    const res = await fetch(`${relay.baseUrl}/target.js`);
    expect(res.status).toBe(200);
    expect(seen.scriptServed).toBe(1);

    const ws = await dialWs(
      `ws://127.0.0.1:${relay.port}/target/open-gate-id?url=https%3A%2F%2Fexample.invalid%2F&title=t`,
    );
    await waitFor(() => seen.upgrades.length > 0);
    expect(seen.upgrades).toEqual([{ kind: 'target', accepted: true }]);
    ws.close();
    await waitFor(() => seen.targetCloses > 0);
    expect(seen.targetCloses).toBe(1);
  });

  it('a throwing hook never breaks the relay', async () => {
    const throwing = await startChiiRelay({
      port: 0,
      onWsUpgrade: () => {
        throw new Error('hook failure');
      },
      onTargetScriptServed: () => {
        throw new Error('hook failure');
      },
      onTargetClose: () => {
        throw new Error('hook failure');
      },
    });
    try {
      const res = await fetch(`${throwing.baseUrl}/target.js`);
      expect(res.status).toBe(200);
      const ws = await dialWs(
        `ws://127.0.0.1:${throwing.port}/target/throw-id?url=https%3A%2F%2Fexample.invalid%2F&title=t`,
      );
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      await throwing.close();
    }
  });
});
