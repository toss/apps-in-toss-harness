/**
 * The device id the page sends to the relay after the code, so the relay can
 * bind a code to one phone. Kept on the history entry (reload) and in this
 * tab's sessionStorage (another page of the same tab).
 */
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relayDeviceId } from '../page-at-code.js';

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.sessionStorage.clear();
  window.history.replaceState({ __ait_debug_attach: { at: 'a', relay: 'r', sig: 's' } }, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('relayDeviceId', () => {
  it('makes a random 128-bit id and keeps it on the history entry and in sessionStorage', () => {
    const id = relayDeviceId();
    expect(id).toMatch(ID_RE);
    expect(window.history.state.__ait_debug_attach).toMatchObject({ at: 'a', d: id });
    expect(window.sessionStorage.getItem('__ait_debug_device')).toBe(id);
  });

  it('a reload of the page keeps the id (history entry)', () => {
    const id = relayDeviceId();
    window.sessionStorage.clear();
    expect(relayDeviceId()).toBe(id);
  });

  it('another page of the same tab keeps the id (sessionStorage)', () => {
    const id = relayDeviceId();
    window.history.replaceState({ __ait_debug_attach: { at: 'b' } }, '', '/next');
    expect(relayDeviceId()).toBe(id);
    expect(window.history.state.__ait_debug_attach.d).toBe(id);
  });

  it('another tab (fresh storage, fresh entry) gets another id', () => {
    const id = relayDeviceId();
    window.sessionStorage.clear();
    window.history.replaceState({ __ait_debug_attach: {} }, '', '/');
    const other = relayDeviceId();
    expect(other).toMatch(ID_RE);
    expect(other).not.toBe(id);
  });

  it('ignores a malformed stored value', () => {
    window.sessionStorage.setItem('__ait_debug_device', 'x/../y');
    window.history.replaceState({ __ait_debug_attach: { d: 'short' } }, '', '/');
    const id = relayDeviceId();
    expect(id).toMatch(ID_RE);
    expect(id).not.toBe('x/../y');
  });

  it('works when storage and history throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(relayDeviceId()).toMatch(ID_RE);
  });

  it('uses crypto.getRandomValues', () => {
    const spy = vi.spyOn(webcrypto, 'getRandomValues');
    relayDeviceId();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
