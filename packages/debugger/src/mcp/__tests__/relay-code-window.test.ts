/**
 * The relay code is accepted for 30 to 35 s. A phone that already attached keeps
 * working with that code (reload, lock and unlock) for as long as its session
 * lives. Real chii relay and real sockets, the real code gate, and a clock the
 * test moves: the code gate reads `Date.now`, the session store reads the
 * injected throttle clock, and both follow `clock`.
 */
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import {
  buildRelayVerifyAuth,
  generateTotp,
  RELAY_CODE_MAX_AGE_SECONDS,
  RELAY_CODE_MIN_AGE_SECONDS,
  RELAY_CODE_STEP_SECONDS,
  RELAY_VERIFY_SKEW_STEPS,
} from '../totp.js';

const SECRET = 'ef'.repeat(32);
const PAGE = 'https://foo.private-apps.tossmini.com/p';
const STEP_MS = RELAY_CODE_STEP_SECONDS * 1000;
/** Steps a code stays accepted after the one it was minted in. */
const SKEW = RELAY_VERIFY_SKEW_STEPS;
/** Start of a code step, so offsets inside it are exact. */
const STEP_START = 1_700_000_010_000 - (1_700_000_010_000 % STEP_MS);

let relay: ChiiRelay;
let clock: number;

beforeEach(async () => {
  clock = STEP_START;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  relay = await startChiiRelay({
    port: 0,
    verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
    authThrottle: { now: () => clock, maxFailures: 1000 },
    keepaliveIntervalMs: 0,
  });
});

afterEach(async () => {
  await relay.close();
  vi.restoreAllMocks();
});

const codeNow = (): string => generateTotp(SECRET, clock);

function dial(code: string, id: string, settleMs = 250) {
  return new Promise<{ closeCode: number | null; ws: WebSocket }>((resolve, reject) => {
    const q = new URLSearchParams({ url: PAGE, title: 't' });
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/v3/at/${code}/target/${id}?${q}`);
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
    ws.on('close', () => setTimeout(resolve, 50));
    ws.terminate();
  });

describe('relay code window (30 to 35 s)', () => {
  it('states the window the tests below pin', () => {
    expect(RELAY_CODE_STEP_SECONDS).toBe(5);
    expect(RELAY_VERIFY_SKEW_STEPS).toBe(6);
    expect(RELAY_CODE_MIN_AGE_SECONDS).toBe(30);
    expect(RELAY_CODE_MAX_AGE_SECONDS).toBe(35);
  });

  it('accepts a code minted at the start of a step until the end of the last accepted step', async () => {
    const code = codeNow();
    clock = STEP_START + (SKEW + 1) * STEP_MS - 1_000;
    expect(await get(`/v3/at/${code}/target.js`)).toBe(200);
    clock = STEP_START + (SKEW + 1) * STEP_MS + 1_000;
    expect(await get(`/v3/at/${code}/target.js`)).toBe(401);
  });

  it('accepts a code minted at the end of a step for at least SKEW steps (30 s)', async () => {
    clock = STEP_START + STEP_MS - 1;
    const code = codeNow();
    clock = STEP_START + STEP_MS - 1 + SKEW * STEP_MS;
    expect(await get(`/v3/at/${code}/target.js`)).toBe(200);
  });

  it('refuses a fresh connection with a code that is older than the window', async () => {
    const code = codeNow();
    clock += (SKEW + 2) * STEP_MS;
    expect((await dial(code, 'tid')).closeCode).toBe(4401);
  });

  it('keeps an attached phone working with the aged code, and refuses a newcomer on it', async () => {
    const code = codeNow();
    const first = await dial(code, 'tid');
    expect(first.closeCode).toBeNull();
    clock += 10 * 60_000;
    // Reload while the socket is still up: the page fetches the script, the
    // handshake with the code it kept in history.state.
    expect(await get(`/v3/at/${code}/target.js`)).toBe(200);
    expect(await get(`/v3/at/${code}/ait-attach?v=0.0.0`)).not.toBe(401);
    // There is no /proxy route to reach, aged code or not.
    expect(await get(`/v3/at/${code}/proxy`)).toBe(401);
    // Another phone cannot join on the aged code.
    expect((await dial(code, 'someone-else')).closeCode).toBe(4401);
    first.ws.terminate();
  });

  it('lets a reload re-attach the same id with the aged code after the old socket closed', async () => {
    const code = codeNow();
    const first = await dial(code, 'tid');
    await closeSocket(first.ws);
    clock += 3 * 60_000; // the code is long past its window, the session is inside its grace
    expect(await get(`/v3/at/${code}/target.js`)).toBe(200);
    const again = await dial(code, 'tid');
    expect(again.closeCode).toBeNull();
    again.ws.terminate();
  });

  it('lets a lock and unlock reconnect with the aged code inside the grace period', async () => {
    const code = codeNow();
    const first = await dial(code, 'tid');
    await closeSocket(first.ws);
    clock += 4 * 60_000 + 30_000;
    const again = await dial(code, 'tid');
    expect(again.closeCode).toBeNull();
    again.ws.terminate();
  });

  it('ends the session five minutes after the last socket closed', async () => {
    const code = codeNow();
    const first = await dial(code, 'tid');
    await closeSocket(first.ws);
    clock += 5 * 60_000 + 1_000;
    expect((await dial(code, 'tid')).closeCode).toBe(4401);
    expect(await get(`/v3/at/${code}/target.js`)).toBe(401);
  });
});
