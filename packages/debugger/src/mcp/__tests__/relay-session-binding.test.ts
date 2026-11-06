/**
 * A phone socket that drops reconnects to the same URL with the same code. Once
 * that code has aged out, the relay still lets the same (code, target id) pair
 * back in for a bounded time. Real chii relay and real sockets; the code check
 * is a stub whose accepted code the test changes to model aging.
 */
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, startChiiRelay } from '../chii-relay.js';

const OLD = 'a'.repeat(32);
const OTHER_OLD = 'b'.repeat(32);
const FRESH = 'c'.repeat(32);
const PAGE = 'https://foo.private-apps.tossmini.com/p';

let relay: ChiiRelay;
let accepted: string;
let clock: number;

beforeEach(async () => {
  accepted = OLD;
  clock = 1_000_000;
  relay = await startChiiRelay({
    port: 0,
    verifyAuth: (req) => new URL(req.url ?? '', 'http://x').searchParams.get('at') === accepted,
    authThrottle: { now: () => clock },
  });
});

afterEach(async () => {
  await relay.close();
});

function dial(code: string, id: string, settleMs = 250) {
  return new Promise<{ closeCode: number | null; ws: WebSocket }>((resolve, reject) => {
    const q = new URLSearchParams({ url: PAGE, title: 't' });
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/v2/at/${code}/target/${id}?${q}`);
    const out: { closeCode: number | null; ws: WebSocket } = { closeCode: null, ws };
    ws.on('close', (c) => {
      out.closeCode = c;
    });
    ws.on('error', reject);
    setTimeout(() => resolve(out), settleMs);
  });
}

function get(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: relay.port, path }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

const closeSocket = (ws: WebSocket) =>
  new Promise<void>((resolve) => {
    // The relay sees the close a moment after the client does; let it record the time.
    ws.on('close', () => setTimeout(resolve, 50));
    ws.terminate();
  });

describe('phone session binding', () => {
  it('lets the same code and target id reconnect after the code aged out', async () => {
    const first = await dial(OLD, 'tid');
    expect(first.closeCode).toBeNull();
    await closeSocket(first.ws);
    accepted = FRESH;
    const again = await dial(OLD, 'tid');
    expect(again.closeCode).toBeNull();
    again.ws.terminate();
  });

  it('refuses an aged code with a different target id', async () => {
    const first = await dial(OLD, 'tid');
    await closeSocket(first.ws);
    accepted = FRESH;
    const other = await dial(OLD, 'someone-else');
    expect(other.closeCode).toBe(4401);
  });

  it('refuses an aged code that never had a session', async () => {
    accepted = FRESH;
    expect((await dial(OTHER_OLD, 'tid')).closeCode).toBe(4401);
  });

  it('serves the target script under the aged code while a bound socket is open, and never /proxy', async () => {
    const first = await dial(OLD, 'tid');
    accepted = FRESH;
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(200);
    // /proxy is not a route: an open session does not make it one.
    expect(await get(`/v2/at/${OLD}/proxy`)).toBe(401);
    expect(await get(`/v2/at/${OTHER_OLD}/proxy`)).toBe(401);
    first.ws.terminate();
  });

  it('keeps the script open for an aged code once its sockets are gone, while /proxy stays shut', async () => {
    const first = await dial(OLD, 'tid');
    await closeSocket(first.ws);
    accepted = FRESH;
    // Inside the grace period: a reload may still fetch the script.
    expect(await get(`/v2/at/${OLD}/proxy`)).toBe(401);
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(200);
    // The same code is still good for the bound id's reconnect.
    const again = await dial(OLD, 'tid');
    expect(again.closeCode).toBeNull();
    expect(await get(`/v2/at/${OLD}/proxy`)).toBe(401);
    again.ws.terminate();
  });

  it('answers /proxy with a fresh code like any unknown route', async () => {
    accepted = FRESH;
    expect(await get(`/v2/at/${FRESH}/proxy`)).toBe(404);
  });

  it('lets an aged code with a live bound session through the attach handshake', async () => {
    const first = await dial(OLD, 'tid');
    accepted = FRESH;
    // A reload with an aged code probes /ait-attach first; past the code check it is not a 401.
    expect(await get(`/v2/at/${OLD}/ait-attach?v=0.0.0`)).not.toBe(401);
    first.ws.terminate();
  });

  it('refuses the attach handshake for an aged code with no session', async () => {
    accepted = FRESH;
    expect(await get(`/v2/at/${OTHER_OLD}/ait-attach?v=0.0.0`)).toBe(401);
  });

  it('does not open other routes to an aged code', async () => {
    const first = await dial(OLD, 'tid');
    accepted = FRESH;
    expect(await get(`/targets?at=${OLD}`)).toBe(401);
    first.ws.terminate();
  });

  it('ends the session five minutes after the last disconnect', async () => {
    const first = await dial(OLD, 'tid');
    await closeSocket(first.ws);
    accepted = FRESH;
    clock += 5 * 60_000 - 1000;
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(200);
    clock += 2000;
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(401);
    expect((await dial(OLD, 'tid')).closeCode).toBe(4401);
  });

  it('keeps a session while its socket stays open', async () => {
    const first = await dial(OLD, 'tid');
    accepted = FRESH;
    clock += 60 * 60_000;
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(200);
    first.ws.terminate();
  });

  it('clears sessions when the tunnel is reissued', async () => {
    const first = await dial(OLD, 'tid');
    await closeSocket(first.ws);
    accepted = FRESH;
    relay.resetAuthLock('tunnel');
    expect(await get(`/v2/at/${OLD}/target.js`)).toBe(401);
  });

  it('keeps the first phone bound when a second target id dials the same code', async () => {
    const first = await dial(OLD, 'phone-a');
    const second = await dial(OLD, 'phone-b');
    expect(second.closeCode).toBeNull();
    await closeSocket(first.ws);
    accepted = FRESH;
    // phone-a reconnects with the aged code: its binding was not displaced.
    const again = await dial(OLD, 'phone-a');
    expect(again.closeCode).toBeNull();
    again.ws.terminate();
    second.ws.terminate();
  });

  it('refuses a fifth live target id on one code and never evicts a live one', async () => {
    const live = [];
    for (const id of ['t1', 't2', 't3', 't4']) {
      const d = await dial(OLD, id);
      expect(d.closeCode).toBeNull();
      live.push(d);
    }
    const fifth = await dial(OLD, 't5');
    expect(fifth.closeCode).toBe(4401);
    accepted = FRESH;
    // t1 is still bound (aged code, still open).
    const t1 = await dial(OLD, 't1');
    expect(t1.closeCode).toBeNull();
    for (const d of live) d.ws.terminate();
    t1.ws.terminate();
  });

  it('evicts a non-live target id first when the code is full', async () => {
    const live = [];
    for (const id of ['t1', 't2', 't3']) live.push(await dial(OLD, id));
    const gone = await dial(OLD, 't4');
    await closeSocket(gone.ws);
    clock += 5 * 60_000 + 1000; // t4's grace ran out; the three open ones stay live.
    const fifth = await dial(OLD, 't5');
    expect(fifth.closeCode).toBeNull();
    accepted = FRESH;
    // t4 is gone, t5 and the open ones are bound.
    expect((await dial(OLD, 't4')).closeCode).toBe(4401);
    const t5 = await dial(OLD, 't5');
    expect(t5.closeCode).toBeNull();
    for (const d of live) d.ws.terminate();
    fifth.ws.terminate();
    t5.ws.terminate();
  });

  it('refuses an aged code with an unbound id even when other ids are bound', async () => {
    const first = await dial(OLD, 'phone-a');
    accepted = FRESH;
    expect((await dial(OLD, 'phone-b')).closeCode).toBe(4401);
    first.ws.terminate();
  });

  it('bounds the number of remembered codes at 32', async () => {
    const codes = Array.from({ length: 34 }, (_, i) => i.toString(16).padStart(32, '0'));
    accepted = '';
    const sockets = [];
    for (const code of codes) {
      accepted = code;
      const d = await dial(code, 'tid', 20);
      await closeSocket(d.ws);
      sockets.push(d);
    }
    accepted = FRESH;
    // Closed sessions are inside their grace, so only the cap can have dropped the oldest.
    expect(await get(`/v2/at/${codes[0]}/target.js`)).toBe(401);
    expect(await get(`/v2/at/${codes[33]}/target.js`)).toBe(200);
  });

  it('clears every target of a code when the tunnel is reissued', async () => {
    const a = await dial(OLD, 'phone-a');
    const b = await dial(OLD, 'phone-b');
    await closeSocket(a.ws);
    await closeSocket(b.ws);
    accepted = FRESH;
    relay.resetAuthLock('tunnel');
    expect((await dial(OLD, 'phone-a')).closeCode).toBe(4401);
    expect((await dial(OLD, 'phone-b')).closeCode).toBe(4401);
  });
});
