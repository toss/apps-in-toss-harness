/**
 * The attach window of the relay (relay-arming.ts), alone and live.
 *
 * Unit: the state machine with a fake clock. Live: a real chii relay with
 * `requireArming`, phones simulated as tunnel requests (the headers the edge adds)
 * on real sockets.
 */
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, type RelayRevokeReason, startChiiRelay } from '../chii-relay.js';
import {
  CLAIM_LEASE_MS,
  createRelayArming,
  fingerprintDevice,
  type RelayClaimEvent,
  sanitizeCountry,
  uaFamilyOf,
} from '../relay-arming.js';

describe('relay arming state machine', () => {
  it('is disarmed until armed, and expires on its own', () => {
    let now = 1_000;
    const changes: boolean[] = [];
    const arming = createRelayArming({ now: () => now, onChange: (a) => changes.push(a) });
    expect(arming.isArmed()).toBe(false);
    expect(arming.noteClaim('d1')).toBe('disarmed');
    arming.arm(5_000);
    expect(arming.isArmed()).toBe(true);
    now += 4_999;
    expect(arming.isArmed()).toBe(true);
    now += 2;
    expect(arming.isArmed()).toBe(false);
    expect(arming.state()).toEqual({ armed: false, armedUntil: null, claimedBy: null });
    expect(changes[0]).toBe(true);
    arming.close();
  });

  it('keeps the longer window when armed twice', () => {
    let now = 0;
    const arming = createRelayArming({ now: () => now });
    arming.arm(60_000);
    arming.arm(1_000);
    now += 30_000;
    expect(arming.isArmed()).toBe(true);
    arming.close();
  });

  it('gives the claim to the first device and calls another one contested', () => {
    const arming = createRelayArming({ now: () => 0 });
    arming.arm(120_000);
    expect(arming.noteClaim('phone-a')).toBe('first');
    expect(arming.noteClaim('phone-a')).toBe('same');
    expect(arming.noteClaim('phone-b')).toBe('contested');
    expect(arming.claimDevice()).toBe('phone-a');
    expect(arming.state().claimedBy).toBe(fingerprintDevice('phone-a'));
    arming.close();
  });

  it('releases a claim that never became a socket, and stays armed', () => {
    let now = 0;
    const arming = createRelayArming({ now: () => now });
    arming.arm(10_000);
    expect(arming.noteClaim('phone-a')).toBe('first');
    // The window stretches so the lease can run out while it is still open.
    now += CLAIM_LEASE_MS + 1;
    expect(arming.isArmed()).toBe(true);
    expect(arming.claimDevice()).toBeNull();
    expect(arming.noteClaim('phone-b')).toBe('first');
    arming.close();
  });

  it('closes the window when a socket is bound', () => {
    const arming = createRelayArming({ now: () => 0 });
    arming.arm(60_000);
    arming.noteClaim('phone-a');
    arming.markBound();
    expect(arming.isArmed()).toBe(false);
    expect(arming.claimDevice()).toBeNull();
    arming.close();
  });

  it('fingerprints a device with 8 hex characters and keeps no raw value', () => {
    expect(fingerprintDevice('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprintDevice('abc')).not.toContain('abc');
  });

  it('reduces a user agent to a family and a header to a country code', () => {
    expect(uaFamilyOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios');
    expect(uaFamilyOf('Mozilla/5.0 (Linux; Android 14)')).toBe('android');
    expect(uaFamilyOf('curl/8')).toBe('other');
    expect(uaFamilyOf(undefined)).toBe('none');
    expect(sanitizeCountry(' kr ')).toBe('KR');
    expect(sanitizeCountry('korea')).toBeUndefined();
    expect(sanitizeCountry(undefined)).toBeUndefined();
  });
});

const CODE_A = 'a'.repeat(32);
const CODE_B = 'b'.repeat(32);
const CODE_C = 'c'.repeat(32);
const PHONE_A = 'AbCdEfGhIjKlMnOpQrStUv';
const PHONE_B = 'zYxWvUtSrQpOnMlKjIhGfE';
const ORIGIN = 'https://demo.private-apps.tossmini.com';
const PAGE = `${ORIGIN}/p`;
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

const TUNNEL = {
  Host: 'relay.trycloudflare.com',
  'cf-connecting-ip': '203.0.113.9',
  'cf-ipcountry': 'kr',
  'user-agent': IOS_UA,
};

let relay: ChiiRelay;
let clock: number;
let accepted: Set<string>;
let claims: RelayClaimEvent[];
let armChanges: boolean[];
let rejectReasons: string[];

beforeEach(async () => {
  clock = 1_000_000;
  accepted = new Set([CODE_A, CODE_B, CODE_C]);
  claims = [];
  armChanges = [];
  rejectReasons = [];
  relay = await startChiiRelay({
    port: 0,
    keepaliveIntervalMs: 0,
    requireArming: true,
    verifyAuth: (req) =>
      accepted.has(new URL(req.url ?? '', 'http://x').searchParams.get('at') ?? ''),
    authThrottle: { now: () => clock, maxFailures: 2 },
    onClaim: (e) => claims.push(e),
    onArmChange: (a) => armChanges.push(a),
    onAuthReject: (e) => rejectReasons.push(`${e.kind}:${e.reason}`),
  });
});

afterEach(async () => {
  await relay.close();
});

const prefix = (code: string, device: string): string => `/v3/at/${code}/d/${device}`;

function get(path: string, headers: Record<string, string> = TUNNEL): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: relay.port, path, headers: { Origin: ORIGIN, ...headers } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

interface Dialed {
  ws: WebSocket;
  closeCode: number | null;
  closeReason: string;
}

function dial(
  code: string,
  device: string,
  id: string,
  opts: { page?: string | null; headers?: Record<string, string>; settleMs?: number } = {},
): Promise<Dialed> {
  return new Promise((resolve, reject) => {
    const page = opts.page === undefined ? PAGE : opts.page;
    const q = new URLSearchParams(page === null ? { title: 't' } : { url: page, title: 't' });
    const ws = new WebSocket(
      `ws://127.0.0.1:${relay.port}${prefix(code, device)}/target/${id}?${q}`,
      { headers: { Origin: ORIGIN, ...(opts.headers ?? TUNNEL) } },
    );
    const out: Dialed = { ws, closeCode: null, closeReason: '' };
    ws.on('close', (c, r) => {
      out.closeCode = c;
      out.closeReason = r.toString();
    });
    ws.on('error', reject);
    setTimeout(() => resolve(out), opts.settleMs ?? 250);
  });
}

const closed = (d: Dialed): Promise<void> =>
  new Promise((resolve) => {
    if (d.closeCode !== null) return resolve();
    d.ws.on('close', () => setTimeout(resolve, 50));
    d.ws.terminate();
  });

describe('a disarmed relay', () => {
  it('refuses a fresh code through the tunnel on every phone route without counting it', async () => {
    expect(relay.armState().armed).toBe(false);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(401);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3`)).toBe(401);
    const refused = await dial(CODE_A, PHONE_A, 'p1');
    expect(refused.closeCode).toBe(4401);
    // maxFailures is 2: counted refusals would have locked the scope by now.
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
  });

  it('keeps answering loopback callers (the daemon and the inspector)', async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: '127.0.0.1', port: relay.port, path: `/targets?at=${CODE_A}` },
        (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res).toBe(200);
    // Attach a phone through the window, which then closes; a loopback client still dials in.
    relay.arm(60_000);
    const phone = await dial(CODE_A, PHONE_A, 'p1');
    expect(relay.armState().armed).toBe(false);
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/client/c1?target=p1&at=${CODE_C}`);
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => {
        setTimeout(() => {
          resolve('open');
          ws.close();
        }, 150);
      });
      ws.on('close', (c) => resolve(`close:${c}`));
      ws.on('error', () => resolve('error'));
    });
    expect(outcome).toBe('open');
    phone.ws.terminate();
  });
});

describe('an armed relay', () => {
  it('reports the first claim without a url, a code or a raw device id', async () => {
    relay.arm(60_000);
    expect(armChanges).toEqual([true]);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    expect(claims).toHaveLength(1);
    const [claim] = claims;
    expect(claim?.kind).toBe('claim');
    expect(claim?.ua).toBe('ios');
    expect(claim?.country).toBe('KR');
    expect(claim?.device).toBe(fingerprintDevice(PHONE_A));
    const dump = JSON.stringify(claims);
    expect(dump).not.toContain(CODE_A);
    expect(dump).not.toContain(PHONE_A);
    expect(dump).not.toContain('trycloudflare');
    expect(dump).not.toContain('203.0.113.9');
    expect(relay.armState().claimedBy).toBe(fingerprintDevice(PHONE_A));
  });

  it('closes the window at the first bound socket and then serves only that phone', async () => {
    relay.arm(60_000);
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    expect(mine.closeCode).toBeNull();
    expect(relay.armState().armed).toBe(false);
    expect(armChanges).toEqual([true, false]);

    // A different device with another valid code is refused, on every phone route.
    expect(await get(`${prefix(CODE_B, PHONE_B)}/target.js`)).toBe(401);
    expect((await dial(CODE_B, PHONE_B, 'x1')).closeCode).toBe(4401);

    // The same device reconnects, even with a code that has aged out.
    accepted.delete(CODE_A);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    const again = await dial(CODE_A, PHONE_A, 'p1-second-page');
    expect(again.closeCode).toBeNull();
    mine.ws.terminate();
    again.ws.terminate();
  });

  it('refuses a second device that presents a valid code during a claim', async () => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    expect(await get(`${prefix(CODE_B, PHONE_B)}/target.js`)).toBe(401);
    expect(claims.map((c) => c.kind)).toEqual(['claim', 'contested']);
    // The first device is unaffected.
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    expect(mine.closeCode).toBeNull();
    mine.ws.terminate();
  });

  it('lets another device claim once a claim lease runs out without a socket', async () => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    clock += CLAIM_LEASE_MS + 1_000;
    expect(await get(`${prefix(CODE_B, PHONE_B)}/target.js`)).toBe(200);
    expect(relay.armState().armed).toBe(true);
    expect(claims.map((c) => c.kind)).toEqual(['claim', 'claim']);
  });

  it('stops answering a fresh code when the window runs out', async () => {
    relay.arm(10_000);
    clock += 10_001;
    expect(relay.armState().armed).toBe(false);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(401);
  });
});

describe('a phone that dropped and comes back', () => {
  it('is served on every route after its socket closed, with an aged code and the same page id', async () => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    const first = await dial(CODE_A, PHONE_A, 'p1');
    expect(first.closeCode).toBeNull();
    expect(relay.armState().armed).toBe(false);
    await closed(first);

    // The page reloads 2 s later: the code has aged out, the window is shut, no socket is open.
    clock += 2_000;
    accepted.delete(CODE_A);
    rejectReasons.length = 0;
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    const again = await dial(CODE_A, PHONE_A, 'p1');
    expect(again.closeCode).toBeNull();
    // A new page id of the same phone is let in as well.
    const other = await dial(CODE_A, PHONE_A, 'p2');
    expect(other.closeCode).toBeNull();
    expect(rejectReasons).toEqual([]);
    again.ws.terminate();
    other.ws.terminate();
  });
});

describe('why a request is refused', () => {
  it('names the rule that turned each request away, without any request data', async () => {
    // A code that never attached, window shut.
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(401);
    // No prefix at all.
    expect(await get(`/target.js?at=${CODE_A}`)).toBe(401);
    // A malformed code.
    expect(await get(`/v3/at/zzz/d/${PHONE_A}/target.js`)).toBe(401);
    expect(rejectReasons).toEqual([
      'http-request:window-closed',
      'http-request:no-prefix',
      'http-request:bad-code-shape',
    ]);

    // Armed: a well-formed code that is not valid.
    rejectReasons.length = 0;
    relay.arm(60_000);
    expect(await get(`${prefix('d'.repeat(32), PHONE_A)}/target.js`)).toBe(401);
    expect(rejectReasons).toEqual(['http-request:code-invalid']);

    // Claimed by one phone, a second one is contested.
    rejectReasons.length = 0;
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(200);
    expect(await get(`${prefix(CODE_B, PHONE_B)}/target.js`)).toBe(401);
    expect(rejectReasons).toEqual(['http-request:contested']);

    // Bound to PHONE_A: another device with the same code is refused as such.
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    rejectReasons.length = 0;
    expect(await get(`${prefix(CODE_A, PHONE_B)}/target.js`)).toBe(401);
    expect(rejectReasons).toEqual(['http-request:other-device']);

    // After the session grace ran out the same phone is told its session is gone.
    await closed(mine);
    clock += 5 * 60_000 + 1_000;
    accepted.delete(CODE_A);
    rejectReasons.length = 0;
    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(401);
    expect(rejectReasons).toEqual(['http-request:session-gone']);
    const dump = JSON.stringify(rejectReasons);
    expect(dump).not.toContain(CODE_A);
    expect(dump).not.toContain(PHONE_A);
  });
});

describe('revokeSessions', () => {
  it('closes the phone socket with 4401 and refuses the same code and device afterwards', async () => {
    relay.arm(60_000);
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    expect(mine.closeCode).toBeNull();
    const closedCount = relay.revokeSessions('user-stopped' satisfies RelayRevokeReason);
    expect(closedCount).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(mine.closeCode).toBe(4401);
    expect(mine.closeReason).toBe('user-stopped');

    expect(await get(`${prefix(CODE_A, PHONE_A)}/target.js`)).toBe(401);
    expect((await dial(CODE_A, PHONE_A, 'p1')).closeCode).toBe(4401);
    expect(relay.armState().armed).toBe(false);
  });

  it('is safe with nothing attached', () => {
    expect(relay.revokeSessions('revoked')).toBe(0);
  });

  it.each([
    ['revoked', 'revoked'],
    ['user-stopped', 'user-stopped'],
    ['idle-timeout', 'idle-timeout'],
    ['session-expired', 'expired'],
  ] as const)('sends close 4410 (%s) to a client that announced support', async (reason, named) => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    expect(mine.closeCode).toBeNull();
    relay.revokeSessions(reason);
    await new Promise((r) => setTimeout(r, 200));
    expect(mine.closeCode).toBe(4410);
    expect(mine.closeReason).toBe(named);
  });

  it('keeps close 4401 for a 0.3.1 client and for one that announced nothing', async () => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.1`)).toBe(204);
    const old = await dial(CODE_A, PHONE_A, 'p1');
    relay.revokeSessions('idle-timeout');
    await new Promise((r) => setTimeout(r, 200));
    expect(old.closeCode).toBe(4401);
    expect(old.closeReason).toBe('idle-timeout');
  });

  it('keeps close 4401 when the session is replaced, even for a new client', async () => {
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    const mine = await dial(CODE_A, PHONE_A, 'p1');
    relay.revokeSessions('replaced');
    await new Promise((r) => setTimeout(r, 200));
    expect(mine.closeCode).toBe(4401);
  });
});

describe('status chip per attached phone', () => {
  it('follows the phone that is attached, not the last handshake', async () => {
    expect(relay.attachedTargetsHaveStatusChip()).toBe(false);
    relay.arm(60_000);
    // A 0.3.2 phone attaches, then a 0.3.1 handshake arrives: the attached phone still has a chip.
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    const fresh = await dial(CODE_A, PHONE_A, 'p1');
    expect(fresh.closeCode).toBeNull();
    expect(relay.attachedTargetsHaveStatusChip()).toBe(true);
    expect(await get(`${prefix(CODE_A, PHONE_A)}/ait-attach?p=3&v=0.3.1`)).toBe(204);
    expect(relay.attachedTargetsHaveStatusChip()).toBe(true);
    relay.revokeSessions('revoked');
    await new Promise((r) => setTimeout(r, 200));
    expect(relay.attachedTargetsHaveStatusChip()).toBe(false);

    // The other way round: a 0.3.1 phone attached, a 0.3.2 handshake after it.
    relay.arm(60_000);
    expect(await get(`${prefix(CODE_C, PHONE_B)}/ait-attach?p=3&v=0.3.1`)).toBe(204);
    const old = await dial(CODE_C, PHONE_B, 'p2');
    expect(old.closeCode).toBeNull();
    expect(await get(`${prefix(CODE_C, PHONE_B)}/ait-attach?p=3&v=0.3.2`)).toBe(204);
    expect(relay.attachedTargetsHaveStatusChip()).toBe(false);
  });
});

describe('replacing the attached page', () => {
  it('refuses a target without a page url through the tunnel', async () => {
    relay.arm(60_000);
    const out = await dial(CODE_A, PHONE_A, 'p1', { page: null });
    expect(out.closeCode).toBe(4409);
  });

  it('refuses a page url whose host is not the Origin host', async () => {
    relay.arm(60_000);
    const out = await dial(CODE_A, PHONE_A, 'p1', {
      page: 'https://other.private-apps.tossmini.com/p',
    });
    expect(out.closeCode).toBe(4409);
  });

  it('still accepts a target without a page url on loopback', async () => {
    const q = new URLSearchParams({ title: 't' });
    const ws = new WebSocket(
      `ws://127.0.0.1:${relay.port}/v3/at/${CODE_A}/d/${PHONE_A}/target/local1?${q}`,
    );
    const code = await new Promise<number | 'open'>((resolve) => {
      ws.on('open', () => setTimeout(() => resolve('open'), 150));
      ws.on('close', (c) => resolve(c));
    });
    expect(code).toBe('open');
    ws.terminate();
  });

  it('refuses a second device while the first is attached, and admits it after', async () => {
    relay.arm(60_000);
    const first = await dial(CODE_A, PHONE_A, 'p1');
    expect(first.closeCode).toBeNull();
    // Armed again for another QR, but the second device is not the claimant here:
    // it never presented a code while the window was open.
    const second = await dial(CODE_A, PHONE_B, 'x1');
    expect(second.closeCode).toBe(4401);
    await closed(first);
    relay.arm(60_000);
    const third = await dial(CODE_C, PHONE_B, 'y1');
    expect(third.closeCode).toBeNull();
    third.ws.terminate();
  });

  it('lets a device that claimed an armed window take the place, with a report', async () => {
    relay.arm(60_000);
    const first = await dial(CODE_A, PHONE_A, 'p1');
    expect(first.closeCode).toBeNull();
    claims.length = 0;

    relay.arm(60_000);
    expect(await get(`${prefix(CODE_B, PHONE_B)}/target.js`)).toBe(200);
    const second = await dial(CODE_B, PHONE_B, 'x1');
    expect(second.closeCode).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect(first.closeCode).toBe(4401);
    expect(first.closeReason).toBe('replaced');
    expect(claims.map((c) => c.kind)).toEqual(['claim', 'replaced']);
    second.ws.terminate();
  });
});

describe('forwarding headers', () => {
  it('does not let a client choose the address chii lists for its page', async () => {
    relay.arm(60_000);
    const mine = await dial(CODE_A, PHONE_A, 'p1', {
      headers: { ...TUNNEL, 'x-forwarded-for': '198.51.100.77, 203.0.113.9' },
    });
    expect(mine.closeCode).toBeNull();
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: relay.port,
          path: `/targets?at=${CODE_C}`,
          headers: { 'accept-encoding': 'identity' },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => {
            data += String(c);
          });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(body).toContain('p1');
    expect(body).not.toContain('198.51.100.77');
    mine.ws.terminate();
  });
});
