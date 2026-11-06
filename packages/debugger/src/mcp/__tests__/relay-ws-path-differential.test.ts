/**
 * The relay gate matches the raw request path with a regex, while chii's
 * WebSocketServer reads it with legacy `url.parse` (backslash becomes `/`) and
 * takes the last two segments. `/v2/at/<code>/d/<id>/target/x\client\evil` is a
 * `/target/<id>` upgrade to the gate and a `/client/evil` upgrade to chii.
 *
 * Every request here is written to a raw socket, because `ws` and `fetch` run the
 * URL through WHATWG `URL`, which turns a backslash into `/` before it is sent.
 */

import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChiiRelay, hasAmbiguousPathChar, startChiiRelay } from '../chii-relay.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const SECRET = 'ef'.repeat(32);
const code = (): string => generateTotp(SECRET);
const wrongCode = (): string => generateTotp('22'.repeat(32), Date.now() + 90_000);
const DEVICE = 'A'.repeat(22);
const PAGE = 'url=https%3A%2F%2Fexample.invalid%2F&title=t';

let relay: ChiiRelay;
let authRejects = 0;

beforeAll(async () => {
  relay = await startChiiRelay({
    port: 0,
    verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
    keepaliveIntervalMs: 0,
    onAuthReject: () => {
      authRejects += 1;
    },
  });
});

afterAll(async () => {
  await relay?.close();
});

/** Sends a WebSocket upgrade with `rawPath` byte for byte; resolves the status line seen (or `null` when the socket just closed). */
function rawUpgrade(rawPath: string): Promise<{ status: number | null; socketClosed: boolean }> {
  return new Promise((resolve) => {
    const sock = connect(relay.port, '127.0.0.1');
    let buf = '';
    let settled = false;
    const done = (status: number | null): void => {
      if (settled) return;
      settled = true;
      const closed = sock.destroyed;
      sock.destroy();
      resolve({ status, socketClosed: closed });
    };
    sock.on('connect', () => {
      sock.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${relay.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      );
    });
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const m = /^HTTP\/1\.1 (\d{3})/.exec(buf);
      if (m) done(Number(m[1]));
    });
    sock.on('close', () => done(null));
    sock.on('error', () => done(null));
    setTimeout(() => done(null), 1500);
  });
}

function rawGet(rawPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = connect(relay.port, '127.0.0.1');
    let buf = '';
    sock.on('connect', () => {
      sock.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: 127.0.0.1:${relay.port}\r\nConnection: close\r\n\r\n`,
      );
    });
    sock.on('data', (d) => {
      buf += d.toString('latin1');
    });
    sock.on('close', () => {
      const m = /^HTTP\/1\.1 (\d{3})/.exec(buf);
      resolve(m ? Number(m[1]) : null);
    });
    sock.on('error', () => resolve(null));
  });
}

describe('hasAmbiguousPathChar', () => {
  it.each([
    ['/target/x\\client\\evil', true],
    ['/target/x#client/evil', true],
    ['/target/x;client/evil', true],
    ['/target/x\u0000', true],
    ['/target/x\t', true],
    ['/target/x\u007f', true],
    ['/target/x', false],
    ['/v2/at/abc/d/id/target/x?url=a\\b#c;d', false],
  ])('%j -> %s', (url, expected) => {
    expect(hasAmbiguousPathChar(url)).toBe(expected);
  });
});

describe('relay: WS upgrade path differential', () => {
  it('control: the canonical target and client shapes upgrade', async () => {
    expect((await rawUpgrade(`/v2/at/${code()}/target/t1?${PAGE}`)).status).toBe(101);
    // the daemon's client socket on loopback (what the exploit below tries to reach)
    expect((await rawUpgrade(`/v2/at/${code()}/client/evil?target=t1`)).status).toBe(101);
  });

  it.each([
    ['backslashes after a device id', `/d/${DEVICE}/target/x\\client\\evil?${PAGE}`],
    ['backslashes without a device id', `/target/x\\client\\evil?${PAGE}`],
    ['one backslash', `/target/x\\evil?${PAGE}`],
    ['a backslash before the kind', `/x\\target/evil?${PAGE}`],
    ['a fragment', `/target/x#/client/evil?${PAGE}`],
    ['a semicolon', `/target/x;/client/evil?${PAGE}`],
    ['a tab', `/target/x\t/client/evil?${PAGE}`],
    ['a percent escape in the id', `/target/x%5Cclient%5Cevil?${PAGE}`],
    ['a percent escape in a client id', `/client/x%2Fevil?target=t1`],
  ])('refuses %s and never hands chii a socket', async (_label, tail) => {
    const before = authRejects;
    // a VALID code, so only the path check can be what stops it
    const withPrefix = await rawUpgrade(`/v2/at/${code()}${tail}`);
    expect(withPrefix.status).not.toBe(101);
    // the unprefixed (daemon query transport) spelling is refused the same way
    const query = tail.includes('?') ? '&' : '?';
    const bare = await rawUpgrade(`${tail}${query}at=${code()}`);
    expect(bare.status).not.toBe(101);
    expect(authRejects).toBe(before);
  });

  it('does not count a malformed path toward the code lock', async () => {
    const before = authRejects;
    for (let i = 0; i < 40; i++) {
      const out = await rawUpgrade(`/v2/at/${wrongCode()}/target/x\\client\\evil?${PAGE}`);
      expect(out.status).not.toBe(101);
    }
    // refused before the code check: no auth rejection was ever recorded
    expect(authRejects).toBe(before);
    expect((await rawUpgrade(`/v2/at/${code()}/target/t2?${PAGE}`)).status).toBe(101);
  });

  it('refuses a malformed HTTP path before the code check', async () => {
    const before = authRejects;
    expect(await rawGet(`/v2/at/${wrongCode()}/target.js\\x`)).toBe(404);
    expect(await rawGet(`/v2/at/${wrongCode()}/target.js;x`)).toBe(404);
    expect(authRejects).toBe(before);
    expect(await rawGet(`/v2/at/${code()}/target.js`)).toBe(200);
  });
});
