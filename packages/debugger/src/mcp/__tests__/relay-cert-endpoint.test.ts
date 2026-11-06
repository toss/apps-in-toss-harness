/**
 * `GET /relay-cert`: the public session certificates the phone fetches to
 * check the QR `sig`. It needs no code, never counts toward the code lock,
 * answers only allowed mini-app origins through the tunnel, and is not cached.
 */

import { request } from 'node:http';
import {
  parseRelayCertDocument,
  parseRelaySignature,
  RELAY_CERT_PATH,
} from '@apps-in-toss/internal-protocol/relay-signature';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ChiiRelay, type StartChiiRelayOptions, startChiiRelay } from '../chii-relay.js';
import {
  relayCertDocument,
  resetRelaySessionKey,
  SESSION_KEY_ROTATE_MS,
  signRelay,
} from '../relay-signing.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

const SECRET = 'ab'.repeat(32);
const code = (): string => generateTotp(SECRET);
const TUNNEL = { Host: 'relay.trycloudflare.com', 'cf-connecting-ip': '203.0.113.9' };
const PRIVATE_APPS = 'https://demo.private-apps.tossmini.com';
const PRIVATE_WEB = 'https://demo.private-web.tossmini.com';
const RELAY = 'wss://relay.trycloudflare.com';

interface Raw {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function raw(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const req = request({ hostname, port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /relay-cert', () => {
  let relay: ChiiRelay | undefined;
  const rejects: Array<{ kind: string; reason: string }> = [];
  const boot = async (extra: Partial<StartChiiRelayOptions> = {}): Promise<void> => {
    rejects.length = 0;
    relay = await startChiiRelay({
      verifyAuth: buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: SECRET }, SECRET),
      authThrottle: { maxFailures: 3 },
      onOriginReject: (event) => rejects.push(event),
      getRelayCertDocument: () => relayCertDocument(SECRET),
      ...extra,
    });
  };
  const base = (): string => {
    if (relay === undefined) throw new Error('relay not started');
    return relay.baseUrl;
  };
  beforeEach(() => {
    resetRelaySessionKey();
  });
  afterEach(async () => {
    await relay?.close();
    relay = undefined;
    resetRelaySessionKey();
  });

  it('pins the path', () => {
    expect(RELAY_CERT_PATH).toBe('/relay-cert');
  });

  it('serves the strict document to an allowed origin through the tunnel, with no code', async () => {
    await boot();
    const sig = signRelay(SECRET, RELAY, code());
    const res = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBe(PRIVATE_APPS);
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    const doc = JSON.parse(res.body);
    expect(Object.keys(doc).sort()).toEqual(['certs', 'v']);
    expect(doc.v).toBe(1);
    const certs = parseRelayCertDocument(res.body);
    expect(certs).toHaveLength(1);
    expect(certs![0]!.keyId).toBe(parseRelaySignature(sig)!.keyId);
    expect(res.body).not.toContain(SECRET);
  });

  it('serves the private-web host too, and HEAD with no body', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    const web = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_WEB });
    expect(web.status).toBe(200);
    const head = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS }, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('keeps the previous certificate next to the current one across a rotation', async () => {
    const t0 = Date.now() - SESSION_KEY_ROTATE_MS - 1_000;
    const older = signRelay(SECRET, RELAY, code(), t0);
    const newer = signRelay(SECRET, RELAY, code());
    await boot();
    const res = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS });
    const ids = (parseRelayCertDocument(res.body) ?? []).map((c) => c.keyId);
    expect(ids).toEqual([parseRelaySignature(newer)!.keyId, parseRelaySignature(older)!.keyId]);
  });

  it.each([
    'https://demo.apps.tossmini.com',
    'https://demo.web.tossmini.com',
    'http://localhost:3000',
    'https://example.com',
    'null',
  ])('refuses origin %s through the tunnel, with no CORS header', async (origin) => {
    await boot();
    signRelay(SECRET, RELAY, code());
    const res = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: origin });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'origin-not-allowed' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.body).not.toContain('certs');
  });

  it('refuses a tunnel request without an Origin', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    const res = await raw(base(), RELAY_CERT_PATH, TUNNEL);
    expect(res.status).toBe(403);
    expect(rejects).toEqual([{ kind: 'http-request', reason: 'no-origin' }]);
  });

  it('narrows to the exact app name when the daemon knows it', async () => {
    await boot({ getAppName: () => 'demo' });
    signRelay(SECRET, RELAY, code());
    expect((await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS })).status).toBe(
      200,
    );
    expect(
      (
        await raw(base(), RELAY_CERT_PATH, {
          ...TUNNEL,
          Origin: 'https://other.private-apps.tossmini.com',
        })
      ).status,
    ).toBe(403);
  });

  it('answers loopback without an Origin (the daemon itself)', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    expect((await raw(base(), RELAY_CERT_PATH)).status).toBe(200);
  });

  it('allows only GET and HEAD', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS }, method);
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    }
  });

  it('answers 404 while there is no certificate yet, or no provider', async () => {
    await boot();
    expect((await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS })).status).toBe(
      404,
    );
    await relay?.close();
    await boot({ getRelayCertDocument: undefined });
    signRelay(SECRET, RELAY, code());
    expect((await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS })).status).toBe(
      404,
    );
  });

  it('answers 404 when the provider throws', async () => {
    await boot({
      getRelayCertDocument: () => {
        throw new Error('boom');
      },
    });
    expect((await raw(base(), RELAY_CERT_PATH, { ...TUNNEL, Origin: PRIVATE_APPS })).status).toBe(
      404,
    );
  });

  it('never counts toward the code lock, whatever it carries', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    // maxFailures is 3. Two real failures first, then many certificate requests.
    for (let i = 0; i < 2; i++) {
      const bad = await raw(base(), `/v3/at/${'0'.repeat(32)}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
        ...TUNNEL,
        Origin: PRIVATE_APPS,
      });
      expect(bad.status).toBe(401);
    }
    for (const path of [
      RELAY_CERT_PATH,
      `${RELAY_CERT_PATH}?at=${'0'.repeat(32)}`,
      `${RELAY_CERT_PATH}?x=1`,
    ]) {
      for (let i = 0; i < 4; i++) {
        await raw(base(), path, { ...TUNNEL, Origin: PRIVATE_APPS });
        await raw(base(), path, { ...TUNNEL, Origin: 'https://example.com' });
        await raw(base(), path, TUNNEL);
      }
    }
    // Not locked: a valid code still loads the script.
    const ok = await raw(base(), `/v3/at/${code()}/d/Zm9vYmFyYmF6cXV4MTIzNA/target.js`, {
      ...TUNNEL,
      Origin: PRIVATE_APPS,
    });
    expect(ok.status).toBe(200);
  });

  it('is not served under the code prefix', async () => {
    await boot();
    signRelay(SECRET, RELAY, code());
    const wrong = await raw(
      base(),
      `/v3/at/${'0'.repeat(32)}${RELAY_CERT_PATH}/d/Zm9vYmFyYmF6cXV4MTIzNA`,
      {
        ...TUNNEL,
        Origin: PRIVATE_APPS,
      },
    );
    expect(wrong.status).toBe(401);
    const right = await raw(base(), `/v3/at/${code()}${RELAY_CERT_PATH}/d/Zm9vYmFyYmF6cXV4MTIzNA`, {
      ...TUNNEL,
      Origin: PRIVATE_APPS,
    });
    expect(right.status).not.toBe(200);
    expect(right.body).not.toContain('"certs"');
  });
});
