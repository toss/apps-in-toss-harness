/**
 * device↔host `__VERSION__` handshake — monitor, diagnostic, and relay wiring.
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
    const monitor = createProtocolVersionMonitor('0.1.0');
    expect(monitor.getLastCheck()).toBeNull();
    expect(monitor.getMismatch()).toBeNull();
  });

  it('records a matching pair without flagging it', () => {
    const monitor = createProtocolVersionMonitor('0.1.0');
    monitor.record('0.1.0');
    expect(monitor.getLastCheck()).toEqual({ match: true, device: '0.1.0', host: '0.1.0' });
    expect(monitor.getMismatch()).toBeNull();
  });

  it('flags a skewed pair and keeps both versions', () => {
    const monitor = createProtocolVersionMonitor('0.2.0');
    monitor.record('0.1.0');
    const skew = monitor.getMismatch();
    expect(skew).not.toBeNull();
    expect(skew?.device).toBe('0.1.0');
    expect(skew?.host).toBe('0.2.0');
  });

  it('stays silent when the device reported nothing', () => {
    // A device on a build predating the handshake, or one whose
    // fire-and-forget report was dropped, must not be called skewed.
    const monitor = createProtocolVersionMonitor('0.2.0');
    monitor.record('');
    expect(monitor.getMismatch()).toBeNull();
  });

  it('stays silent when the daemon does not know its own version', () => {
    const monitor = createProtocolVersionMonitor(null);
    monitor.record('0.1.0');
    expect(monitor.getMismatch()).toBeNull();
  });

  it('tracks the latest report, so a corrected device clears the skew', () => {
    const monitor = createProtocolVersionMonitor('0.2.0');
    monitor.record('0.1.0');
    expect(monitor.getMismatch()).not.toBeNull();
    monitor.record('0.2.0');
    expect(monitor.getMismatch()).toBeNull();
  });
});

describe('protocolVersionMismatchError', () => {
  const result = protocolVersionMismatchError('0.1.0', '0.2.0');
  const text = result.content[0]?.text ?? '';

  it('is an MCP error result', () => {
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
  });

  it('names both packages and both versions', () => {
    expect(text).toContain('@ait-co/debug-console');
    expect(text).toContain('@ait-co/debugger');
    expect(text).toContain('0.1.0');
    expect(text).toContain('0.2.0');
  });

  it('tells the operator what to do next', () => {
    // The whole value of this diagnostic is that it is actionable at the point
    // where the cause is still legible.
    expect(text).toMatch(/재배포|실행/);
  });

  it('carries no URL, host, or auth material', () => {
    for (const forbidden of ['wss://', 'ws://', 'http://', 'https://', 'trycloudflare', 'at=']) {
      expect(text).not.toContain(forbidden);
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
    expect(events).toEqual([{ deviceVersion: '0.1.0' }]);
  });

  it('accepts the handshake through the /at/<code>/ path prefix', async () => {
    // The device prefixes every relay request with its auth path segment; the
    // handshake must survive the same rewrite that `target.js` goes through.
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}/at/123456${ATTACH_HANDSHAKE_PATH}?v=0.1.0`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '0.1.0' }]);
  });

  it('reports an empty version rather than nothing when the param is absent', async () => {
    const { base, events } = await bootRelay();
    const res = await fetch(`${base}${ATTACH_HANDSHAKE_PATH}`);
    expect(res.status).toBe(204);
    expect(events).toEqual([{ deviceVersion: '' }]);
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
