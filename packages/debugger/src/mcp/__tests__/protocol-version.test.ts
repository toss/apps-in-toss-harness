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
 * SECRET-HANDLING: the relay is bound to loopback and no TOTP verifier is
 * installed, so no code, secret, or tunnel host exists in this suite at all.
 * The message assertions additionally pin that the diagnostic carries two
 * version strings and no URL.
 */

import {
  ATTACH_HANDSHAKE_PATH,
  PROTOCOL_VERSION,
  RELAY_UPDATE_REQUIRED_CLOSE_CODE,
  relayAuthPathPrefix,
} from '@apps-in-toss/internal-protocol/attach-handshake';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type AttachHandshakeEvent, type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import { protocolVersionMismatchError } from '../errors.js';
import { createProtocolVersionMonitor } from '../protocol-version.js';

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

  it('flags the debug-console 0.1.5 handshake (version only, no protocol) instead of assuming one', () => {
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
  const older = protocolVersionMismatchError({
    match: false,
    deviceProtocol: 1,
    hostProtocol: 2,
    deviceVersion: '0.1.5',
  });
  const unnumbered = protocolVersionMismatchError({
    match: false,
    deviceProtocol: null,
    hostProtocol: 2,
    deviceVersion: '0.1.5',
  });
  const newer = protocolVersionMismatchError({
    match: false,
    deviceProtocol: 3,
    hostProtocol: 2,
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
    expect(olderText).toContain('@apps-in-toss/debugger');
    expect(olderText).toContain('프로토콜 1');
    expect(olderText).toContain('프로토콜 2');
    expect(olderText).toContain('0.1.5');
  });

  it('says that an update is required and that the device was not connected', () => {
    expect(olderText).toContain('업데이트가 필요합니다');
    expect(olderText).toContain('연결하지 않았습니다');
  });

  it('treats a device without a protocol number as the older side', () => {
    const text = unnumbered.content[0]?.text ?? '';
    expect(text).toContain('debug-console을 최신 릴리스로');
    expect(text).toContain('옛 버전');
  });

  it('tells the operator to update the older side', () => {
    expect(olderText).toContain('debug-console을 최신 릴리스로');
    expect(newerText).toContain('debugger를 최신 릴리스로');
  });

  it('never recommends a concrete target version', () => {
    // The packages are versioned independently; a version borrowed from the
    // other package does not exist (the original bug told users to install
    // debug-console 0.2.3). Only the device label (0.1.5) may appear.
    expect(olderText.match(/\d+\.\d+\.\d+/g)).toEqual(['0.1.5']);
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
      port: 0,
      onAttachHandshake: (event) => events.push(event),
    });
    // Loopback only — the one address class this repo is allowed to print.
    return { base: relay.baseUrl, events };
  }

  it('reports the version the device sent and answers 204', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}${ATTACH_HANDSHAKE_PATH}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.0', deviceProtocol: '' }]);
  });

  it('reports the protocol alongside the version label', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}${ATTACH_HANDSHAKE_PATH}?p=1&v=0.1.6`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.6', deviceProtocol: '1' }]);
  });

  it('accepts the handshake through the versioned auth path prefix', async () => {
    // The device prefixes every relay request with its auth path segment; the
    // handshake must survive the same rewrite that `target.js` goes through.
    const { base, events } = await bootRelay();
    const res = await fetch(
      `${base}${relayAuthPathPrefix()}/${'a'.repeat(32)}${ATTACH_HANDSHAKE_PATH}?p=${PROTOCOL_VERSION}&v=0.3.0`,
    );
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.3.0', deviceProtocol: String(PROTOCOL_VERSION) }]);
  });

  it('reports an empty version rather than nothing when the param is absent', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}${ATTACH_HANDSHAKE_PATH}`);
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
      port: 0,
      onAttachHandshake: (event) => {
        events.push(event);
        throw new Error('observer blew up');
      },
    });
    const res = await fetch(`http://127.0.0.1:${relay.port}${ATTACH_HANDSHAKE_PATH}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toHaveLength(1);
  });
});

describe('relay refuses a device on another protocol', () => {
  let relay: ChiiRelay | null = null;
  const CODE = 'a'.repeat(32);

  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  async function boot(): Promise<{ base: string; events: AttachHandshakeEvent[] }> {
    const events: AttachHandshakeEvent[] = [];
    relay = await startChiiRelay({ port: 0, onAttachHandshake: (e) => events.push(e) });
    return { base: relay.baseUrl, events };
  }

  it('answers the unversioned /at/ prefix (protocol 1) with an update-required script', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/at/${CODE}/target.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('debug-console');
    expect(body).toContain('업데이트');
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

  it('names a newer device protocol so the daemon is the side to update', async () => {
    const { base, events } = await boot();
    const res = await fetch(`${base}/v${PROTOCOL_VERSION + 1}/at/${CODE}/target.js`);
    const body = await res.text();
    expect(body).toContain('디버거');
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
