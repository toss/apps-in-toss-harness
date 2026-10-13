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

import { ATTACH_HANDSHAKE_PATH } from '@apps-in-toss/internal-protocol/attach-handshake';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('accepts the published debug-console 0.1.5 handshake (version only, no protocol)', () => {
    // Regression: 0.1.5 sends only `v=0.1.5`. Comparing package versions made
    // every attach against debugger 0.2.x fail with a nonexistent target.
    const monitor = createProtocolVersionMonitor();
    monitor.record({ protocol: '', version: '0.1.5' });
    expect(monitor.getMismatch()).toBeNull();
  });

  it('flags a different protocol and keeps both numbers', () => {
    const monitor = createProtocolVersionMonitor(2);
    monitor.record({ protocol: '1', version: '0.1.6' });
    const skew = monitor.getMismatch();
    expect(skew).not.toBeNull();
    expect(skew?.deviceProtocol).toBe(1);
    expect(skew?.hostProtocol).toBe(2);
  });

  it('flags a legacy device against a bumped host protocol', () => {
    const monitor = createProtocolVersionMonitor(2);
    monitor.record({ protocol: '', version: '0.1.5' });
    expect(monitor.getMismatch()?.deviceProtocol).toBe(1);
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

  it('accepts the handshake through the /at/<code>/ path prefix', async () => {
    // The device prefixes every relay request with its auth path segment; the
    // handshake must survive the same rewrite that `target.js` goes through.
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}/at/123456${ATTACH_HANDSHAKE_PATH}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.0', deviceProtocol: '' }]);
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

describe('daemon-side version defines', () => {
  it('substitutes `__VERSION__` as a bare identifier', () => {
    // A `globalThis.__VERSION__` property access would NOT be substituted by
    // the bundler's `define` and would silently read `undefined` — the exact
    // failure this handshake exists to make loud, so the define itself has to
    // be pinned.
    expect(__VERSION__).toBe('0.0.0-test');
  });
});
