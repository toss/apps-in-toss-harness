/**
 * One phone per code: the relay binds a code to the device id of the first
 * phone page that opens its socket. Other devices holding the same code are
 * refused like a wrong code; the same phone's reloads and other pages are not.
 * Real chii relay and real sockets; the code check is a stub.
 */
import { request } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  atPrefixDevice,
  type ChiiRelay,
  rewriteAtPathPrefix,
  startChiiRelay,
} from '../chii-relay.js';

const CODE = 'a'.repeat(32);
const OTHER_CODE = 'b'.repeat(32);
const PHONE = 'AbCdEfGhIjKlMnOpQrStUv';
const OTHER_PHONE = 'zYxWvUtSrQpOnMlKjIhGfE';
const PAGE = 'https://foo.private-apps.tossmini.com/p';

let relay: ChiiRelay;
let accepted: Set<string>;
let clock: number;
let rejects: number;

beforeEach(async () => {
  accepted = new Set([CODE, OTHER_CODE]);
  clock = 1_000_000;
  rejects = 0;
  relay = await startChiiRelay({
    port: 0,
    verifyAuth: (req) =>
      accepted.has(new URL(req.url ?? '', 'http://x').searchParams.get('at') ?? ''),
    authThrottle: { now: () => clock, maxFailures: 2 },
    onAuthReject: () => {
      rejects += 1;
    },
  });
});

afterEach(async () => {
  await relay.close();
});

const prefix = (code: string, device: string | null): string =>
  device === null ? `/v3/at/${code}` : `/v3/at/${code}/d/${device}`;

function dial(code: string, device: string | null, id: string, settleMs = 250) {
  return new Promise<{ closeCode: number | null; ws: WebSocket }>((resolve, reject) => {
    const q = new URLSearchParams({ url: PAGE, title: 't' });
    const ws = new WebSocket(
      `ws://127.0.0.1:${relay.port}${prefix(code, device)}/target/${id}?${q}`,
    );
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

describe('device id in the path prefix', () => {
  it('is read from the path and dropped before chii sees the URL', () => {
    const url = `/v3/at/${CODE}/d/${PHONE}/target/t1?url=x`;
    expect(atPrefixDevice(url)).toBe(PHONE);
    expect(rewriteAtPathPrefix(url)).toBe(`/target/t1?url=x&at=${CODE}`);
    expect(rewriteAtPathPrefix(`/v3/at/${CODE}/d/${PHONE}/target.js`)).toBe(
      `/target.js?at=${CODE}`,
    );
  });

  it('is never read from the query, and a malformed segment is not a device id', () => {
    expect(atPrefixDevice(`/v3/at/${CODE}/target.js?d=${PHONE}`)).toBeNull();
    expect(atPrefixDevice(`/v3/at/${CODE}/d/short/target.js`)).toBeNull();
    expect(atPrefixDevice(`/v3/at/${CODE}/d/${PHONE}x/target.js`)).toBeNull();
    expect(atPrefixDevice('/target.js?at=x')).toBeNull();
    // A malformed segment stays in the path, so it reaches no route.
    expect(rewriteAtPathPrefix(`/v3/at/${CODE}/d/short/target.js`)).toBe(
      `/d/short/target.js?at=${CODE}`,
    );
  });
});

describe('one phone per code', () => {
  it('refuses a second device with the same code on every phone route', async () => {
    const mine = await dial(CODE, PHONE, 'page-1');
    expect(mine.closeCode).toBeNull();

    const theirs = await dial(CODE, OTHER_PHONE, 'page-x');
    expect(theirs.closeCode).toBe(4401);
    expect(await get(`${prefix(CODE, OTHER_PHONE)}/target.js`)).toBe(401);
    expect(await get(`${prefix(CODE, OTHER_PHONE)}/ait-attach?p=3`)).toBe(401);
    // No /proxy route: the unknown-route answer, whichever device asks.
    expect(await get(`${prefix(CODE, OTHER_PHONE)}/proxy`)).toBe(404);
    mine.ws.terminate();
  });

  it('refuses the same code without a device id once a phone holds it', async () => {
    const mine = await dial(CODE, PHONE, 'page-1');
    expect((await dial(CODE, null, 'page-x')).closeCode).toBe(4401);
    expect(await get(`${prefix(CODE, null)}/target.js`)).toBe(401);
    // The unprefixed query form cannot skip the check either.
    expect(await get(`/target.js?at=${CODE}`)).toBe(401);
    expect(await get(`/target.js?at=${CODE}&d=${PHONE}`)).toBe(401);
    mine.ws.terminate();
  });

  it('accepts a new page of the same phone (another target id)', async () => {
    const first = await dial(CODE, PHONE, 'page-1');
    const second = await dial(CODE, PHONE, 'page-2');
    expect(second.closeCode).toBeNull();
    expect(await get(`${prefix(CODE, PHONE)}/target.js`)).toBe(200);
    expect(await get(`${prefix(CODE, PHONE)}/proxy`)).toBe(404);
    first.ws.terminate();
    second.ws.terminate();
  });

  it('accepts the same phone reloading after the code aged out', async () => {
    const first = await dial(CODE, PHONE, 'page-1');
    await closeSocket(first.ws);
    accepted = new Set();
    expect(await get(`${prefix(CODE, PHONE)}/target.js`)).toBe(200);
    const again = await dial(CODE, PHONE, 'page-1');
    expect(again.closeCode).toBeNull();
    // A reload gets a new chii id: still the same phone.
    const reloaded = await dial(CODE, PHONE, 'page-1b');
    expect(reloaded.closeCode).toBeNull();
    again.ws.terminate();
    reloaded.ws.terminate();
  });

  it('a refused device does not count toward the code lock', async () => {
    const mine = await dial(CODE, PHONE, 'page-1');
    for (let i = 0; i < 5; i++) {
      expect(await get(`${prefix(CODE, OTHER_PHONE)}/target.js`)).toBe(401);
    }
    expect(rejects).toBeGreaterThanOrEqual(5);
    // maxFailures is 2: a lock would turn this into 429.
    expect(await get(`${prefix(OTHER_CODE, OTHER_PHONE)}/target.js`)).toBe(200);
    mine.ws.terminate();
  });

  it('binds each code separately', async () => {
    const mine = await dial(CODE, PHONE, 'page-1');
    const theirs = await dial(OTHER_CODE, OTHER_PHONE, 'page-x');
    expect(theirs.closeCode).toBeNull();
    mine.ws.terminate();
    theirs.ws.terminate();
  });

  it('frees the code for another device once the session has expired', async () => {
    const first = await dial(CODE, PHONE, 'page-1');
    await closeSocket(first.ws);
    clock += 5 * 60_000 + 1;
    const theirs = await dial(CODE, OTHER_PHONE, 'page-x');
    expect(theirs.closeCode).toBeNull();
    theirs.ws.terminate();
  });

  it('does not bind the daemon side (/targets with the same code)', async () => {
    const mine = await dial(CODE, PHONE, 'page-1');
    expect(await get(`/targets?at=${CODE}`)).toBe(200);
    mine.ws.terminate();
  });
});
