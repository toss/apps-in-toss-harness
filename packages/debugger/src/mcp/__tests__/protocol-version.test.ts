/**
 * device↔host protocol-version handshake — monitor, diagnostic, and relay wiring.
 *
 * The thing under test is a diagnosis, not a behaviour: a skewed pair attaches
 * perfectly happily and then misbehaves silently, because every clause of the
 * protocol is a value-duplicated literal with no compile-time linkage. So the
 * assertions here are about (a) never crying wolf when a version is simply
 * unknown, (b) producing a message that names both versions when there is a
 * real skew, and (c) the relay actually reporting the device's version without
 * leaking anything else.
 *
 * SECRET-HANDLING: the relay is bound to loopback and checks codes from the
 * public test secret in `relay-test-auth.ts`; no real secret or tunnel host
 * exists in this suite. The message assertions additionally pin that the
 * diagnostic carries two version strings and no URL.
 */

import {
  ATTACH_HANDSHAKE_PATH,
  PROTOCOL_VERSION,
  RELAY_UPDATE_REQUIRED_CLOSE_CODE,
  relayAuthPathPrefix,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type AttachHandshakeEvent, type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import { protocolVersionMismatchError } from '../errors.js';
import { createProtocolVersionMonitor } from '../protocol-version.js';
import { updateRequiredText } from '../target-guard.js';
import { testCode, testVerifyAuth } from './relay-test-auth.js';

describe('createProtocolVersionMonitor', () => {
  it('reports no mismatch before any device has spoken', () => {
    const monitor = createProtocolVersionMonitor(1);
    expect(monitor.getLastCheck()).toBeNull();
    expect(monitor.getMismatch()).toBeNull();
  });

  it('records a matching protocol without flagging it', () => {
    const monitor = createProtocolVersionMonitor(1);
    monitor.record({ protocol: '1', version: '0.1.6' });
    expect(monitor.getLastCheck()).toEqual({
      match: true,
      deviceProtocol: 1,
      hostProtocol: 1,
      deviceVersion: '0.1.6',
    });
    expect(monitor.getMismatch()).toBeNull();
  });

  it('flags a report with a version but no protocol number instead of assuming one', () => {
    const monitor = createProtocolVersionMonitor();
    monitor.record({ protocol: '', version: '0.1.5' });
    expect(monitor.getMismatch()?.deviceProtocol).toBeNull();
    expect(monitor.getMismatch()?.deviceVersion).toBe('0.1.5');
  });

  it('flags a different protocol and keeps both numbers', () => {
    const monitor = createProtocolVersionMonitor(2);
    monitor.record({ protocol: '1', version: '0.1.6' });
    const skew = monitor.getMismatch();
    expect(skew).not.toBeNull();
    expect(skew?.deviceProtocol).toBe(1);
    expect(skew?.hostProtocol).toBe(2);
  });

  it('flags a device that reports protocol 1 against the current host', () => {
    const monitor = createProtocolVersionMonitor();
    monitor.record({ protocol: '1', version: '0.2.0' });
    expect(monitor.getMismatch()?.deviceProtocol).toBe(1);
    expect(monitor.getMismatch()?.hostProtocol).toBe(PROTOCOL_VERSION);
  });

  it('stays silent when the device reported nothing', () => {
    const monitor = createProtocolVersionMonitor(2);
    monitor.record({ protocol: '', version: '' });
    expect(monitor.getMismatch()).toBeNull();
  });

  it('tracks the latest report, so a corrected device clears the skew', () => {
    const monitor = createProtocolVersionMonitor(2);
    monitor.record({ protocol: '1' });
    expect(monitor.getMismatch()).not.toBeNull();
    monitor.record({ protocol: '2' });
    expect(monitor.getMismatch()).toBeNull();
  });
});

describe('protocolVersionMismatchError', () => {
  // Protocol 3 is the rename release: a protocol-2 device is a 0.3.0 `debug-console`.
  const older = protocolVersionMismatchError({
    match: false,
    deviceProtocol: 2,
    hostProtocol: 3,
    deviceVersion: '0.3.0',
  });
  const unnumbered = protocolVersionMismatchError({
    match: false,
    deviceProtocol: null,
    hostProtocol: 3,
    deviceVersion: '0.1.5',
  });
  const newer = protocolVersionMismatchError({
    match: false,
    deviceProtocol: 4,
    hostProtocol: 3,
    deviceVersion: '0.4.0',
  });
  const olderText = older.content[0]?.text ?? '';
  const newerText = newer.content[0]?.text ?? '';

  it('is an MCP error result', () => {
    expect(older.isError).toBe(true);
    expect(older.content).toHaveLength(1);
  });

  it('names both packages, both protocol numbers and the device package label', () => {
    expect(olderText).toContain('@apps-in-toss/debug-console');
    expect(olderText).toContain('@apps-in-toss/debugger-client');
    expect(olderText).toContain('@apps-in-toss/debugger');
    expect(olderText).toContain('프로토콜 2');
    expect(olderText).toContain('프로토콜 3');
    expect(olderText).toContain('0.3.0');
  });

  it('does not repeat the word 패키지 in the pre-rename mismatch text', () => {
    expect(olderText.match(/패키지/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(olderText).toContain('옛 @apps-in-toss/debug-console (0.3.0)');
    expect(olderText).not.toContain('들어 있는 패키지');
  });

  it('says that an update is required and that the device was not connected', () => {
    expect(olderText).toContain('업데이트가 필요합니다');
    expect(olderText).toContain('연결하지 않았습니다');
  });

  it('tells a pre-rename device to switch to the renamed package at debugger and debugger-client 0.4.0 or later', () => {
    expect(olderText).toContain('이름이 바뀌었습니다');
    expect(olderText).toContain('/ait:setup-debugger');
    expect(olderText).toContain('/ait:test-on-device');
    expect(olderText).toContain('attach가 매번 실패합니다');
    expect(olderText).toContain('@apps-in-toss/debugger-client 0.4.0 이상');
  });

  it('treats a device without a protocol number as the older side', () => {
    const text = unnumbered.content[0]?.text ?? '';
    expect(text).toContain('@apps-in-toss/debugger-client 0.4.0 이상');
    expect(text).toContain('옛 버전');
  });

  it('does not call a protocol-3 debugger-client the old debug-console once the host moves to 4', () => {
    const text =
      protocolVersionMismatchError({
        match: false,
        deviceProtocol: 3,
        hostProtocol: 4,
        deviceVersion: '0.4.0',
      }).content[0]?.text ?? '';
    expect(text).toContain('기기의 @apps-in-toss/debugger-client');
    expect(text).not.toContain('debug-console');
    expect(text).not.toContain('지우고');
    expect(text).toContain('최신 릴리스로 올려');
  });

  it('gives a protocol-3 device on a protocol-4 relay the generic update text, not the rename text', () => {
    const generic = updateRequiredText(3, 4);
    expect(generic).not.toContain('debug-console');
    expect(generic).toContain('debugger-client를 최신 버전으로');
    expect(updateRequiredText(2, 4)).toContain('이름이 바뀌었고');
    expect(updateRequiredText(2, 3)).toContain('이름이 바뀌었고');
  });

  it('tells the operator to update the daemon when the device is newer', () => {
    expect(newerText).toContain('@apps-in-toss/debugger를 0.4.0 이상');
    expect(newerText).toContain('@apps-in-toss/debugger-client');
    expect(newerText).not.toContain('지우고');
  });

  it('only ever names the first-release floors besides the device label', () => {
    // The packages are versioned independently; a version borrowed from the other
    // package does not exist. Each floor is that package's own first release of the rename.
    expect(new Set(olderText.match(/\d+\.\d+\.\d+/g))).toEqual(new Set(['0.3.0', '0.4.0']));
    expect(olderText).not.toMatch(/맞춰/);
  });

  it('carries no URL, host, or auth material', () => {
    for (const forbidden of ['wss://', 'ws://', 'http://', 'https://', 'trycloudflare', 'at=']) {
      expect(olderText).not.toContain(forbidden);
    }
  });
});

describe('relay handshake endpoint', () => {
  let relay: ChiiRelay | null = null;

  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  /** Boots a relay on an ephemeral loopback port, collecting handshake events. */
  async function bootRelay(): Promise<{ base: string; events: AttachHandshakeEvent[] }> {
    const events: AttachHandshakeEvent[] = [];
    relay = await startChiiRelay({
      verifyAuth: testVerifyAuth(),
      port: 0,
      onAttachHandshake: (event) => events.push(event),
    });
    // Loopback only — the one address class this repo is allowed to print.
    return { base: relay.baseUrl, events };
  }

  /** The handshake path under the current protocol's auth prefix, with a fresh code. */
  const handshake = (base: string): string =>
    `${base}${relayAuthPathPrefix()}/${testCode()}${ATTACH_HANDSHAKE_PATH}`;

  it('reports the version the device sent and answers 204', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${handshake(base)}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.0', deviceProtocol: '' }]);
  });

  it('reports the protocol alongside the version label', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${handshake(base)}?p=1&v=0.1.6`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.6', deviceProtocol: '1' }]);
  });

  it('accepts the handshake through the versioned auth path prefix', async () => {
    // The device prefixes every relay request with its auth path segment; the
    // handshake must survive the same rewrite that `target.js` goes through.
    const { base, events } = await bootRelay();
    const res = await fetch(`${handshake(base)}?p=${PROTOCOL_VERSION}&v=0.3.0`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.3.0', deviceProtocol: String(PROTOCOL_VERSION) }]);
  });

  it('reports an empty version rather than nothing when the param is absent', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(handshake(base));
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '', deviceProtocol: '' }]);
  });

  it('ignores unrelated paths', async () => {
    const { base, events } = await bootRelay();
    await fetch(`${base}/something-else?v=0.1.0`).catch(() => undefined);
    expect(events).toEqual([]);
  });

  it('survives a throwing observer — the device must never see a failure', async () => {
    const events: AttachHandshakeEvent[] = [];
    relay = await startChiiRelay({
      verifyAuth: testVerifyAuth(),
      port: 0,
      onAttachHandshake: (event) => {
        events.push(event);
        throw new Error('observer blew up');
      },
    });
    const res = await fetch(`${handshake(`http://127.0.0.1:${relay.port}`)}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toHaveLength(1);
  });
});

describe('relay refuses a device on another protocol', () => {
  let relay: ChiiRelay | null = null;
  let CODE = '';

  beforeEach(() => {
    CODE = testCode();
  });

  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  async function boot(): Promise<{ base: string; events: AttachHandshakeEvent[] }> {
    const events: AttachHandshakeEvent[] = [];
    relay = await startChiiRelay({
      verifyAuth: testVerifyAuth(),
      port: 0,
      onAttachHandshake: (e) => events.push(e),
    });
    return { base: relay.baseUrl, events };
  }

  it('answers the unversioned /at/ prefix (protocol 1) with an update-required script', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/at/${CODE}/target.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('@apps-in-toss/debugger-client 0.4.0 이상');
    expect(body).toContain('debug-console');
    // It is the notice, not chii.
    expect(body).not.toContain('ChiiServerUrl');
    expect(body).not.toContain(CODE);
    expect(events).toEqual([{ deviceVersion: '', deviceProtocol: '1' }]);
  });

  it('reports the version label an old device sent on its handshake', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/at/${CODE}${ATTACH_HANDSHAKE_PATH}?p=1&v=0.2.0`);
    expect(res.status).toBe(426);
    expect(events).toEqual([{ deviceVersion: '0.2.0', deviceProtocol: '1' }]);
    const bare = await fetch(`${base}/at/${CODE}${ATTACH_HANDSHAKE_PATH}?v=0.1.5`);
    expect(bare.status).toBe(426);
    expect(events.at(-1)).toEqual({ deviceVersion: '0.1.5', deviceProtocol: '1' });
  });

  it('answers a protocol-2 device (debug-console 0.3.0) on /v2/at/ with the rename notice', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/v2/at/${CODE}/target.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain(
      '@apps-in-toss/debug-console은 @apps-in-toss/debugger-client로 이름이 바뀌었고',
    );
    expect(body).toContain('@apps-in-toss/debugger-client 0.4.0 이상');
    expect(body).toContain("window.__ait_debug_status='update-required'");
    expect(body).not.toContain('ChiiServerUrl');
    expect(body).not.toContain(CODE);
    expect(events).toEqual([{ deviceVersion: '', deviceProtocol: '2' }]);
    const ping = await fetch(`${base}/v2/at/${CODE}${ATTACH_HANDSHAKE_PATH}?p=2&v=0.3.0`);
    expect(ping.status).toBe(426);
    expect(events.at(-1)).toEqual({ deviceVersion: '0.3.0', deviceProtocol: '2' });
  });

  it('closes a protocol-2 WebSocket with the update-required code', async () => {
    const { base } = await boot();
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(
        `${base.replace('http', 'ws')}/v2/at/${CODE}/target/t2?url=x&title=t`,
      );
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
    });
    expect(closeCode).toBe(RELAY_UPDATE_REQUIRED_CLOSE_CODE);
  });

  it('names a newer device protocol so the daemon is the side to update', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/v${PROTOCOL_VERSION + 1}/at/${CODE}/target.js`);
    const body = await res.text();
    expect(body).toContain('디버거');
    expect(body).toContain('0.4.0 이상');
    expect(body).toContain('올려');
    expect(events).toEqual([{ deviceVersion: '', deviceProtocol: String(PROTOCOL_VERSION + 1) }]);
  });

  it('closes a WebSocket from an older device with the update-required code', async () => {
    const { base, events } = await boot();
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/at/${CODE}/target/t1?url=x&title=t`);
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
    });
    expect(closeCode).toBe(RELAY_UPDATE_REQUIRED_CLOSE_CODE);
    expect(events).toEqual([{ deviceVersion: '', deviceProtocol: '1' }]);
  });

  it('still serves the current protocol normally', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}${relayAuthPathPrefix()}/${CODE}/target.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain('업데이트');
    expect(events).toEqual([]);
  });

  it('checks the code before it says anything about the protocol', async () => {
    const events: AttachHandshakeEvent[] = [];
    relay = await startChiiRelay({
      port: 0,
      verifyAuth: () => false,
      authThrottle: { maxFailures: 1000 },
      onAttachHandshake: (e) => events.push(e),
    });
    const res = await fetch(`${relay.baseUrl}/at/${CODE}/target.js`);
    expect(res.status).toBe(401);
    expect(events).toEqual([]);
  });
});

describe('daemon-side version defines', () => {
  it('substitutes `__VERSION__` as a bare identifier', () => {
    // A `globalThis.__VERSION__` property access would NOT be substituted by
    // the bundler's `define` and would silently read `undefined` — the exact
    // failure this handshake exists to make loud, so the define itself has to
    // be pinned.
    expect(__VERSION__).toBe('0.0.0-test');
  });
});
