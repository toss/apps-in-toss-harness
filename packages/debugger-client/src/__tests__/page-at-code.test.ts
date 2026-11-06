import { afterEach, describe, expect, it } from 'vitest';
import {
  hidePageAttachParams,
  pageSearchWithAttachParams,
  readPageAtCode,
  readPageAttachParams,
} from '../page-at-code.js';

const RELAY = 'wss://a.example/';
const RELAY_ENC = encodeURIComponent(RELAY);
const CODE = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);

describe('page-at-code', () => {
  afterEach(() => {
    history.replaceState(null, '', '/');
  });

  it('reads the code from the URL first', () => {
    history.replaceState({ __ait_debug_attach: { at: OTHER } }, '', `/?at=${CODE}`);
    expect(readPageAtCode()).toBe(CODE);
  });

  it('reads code and relay from the history entry after hiding them', () => {
    history.replaceState(null, '', `/?at=${CODE}&relay=${RELAY_ENC}&a=1`);
    hidePageAttachParams();
    expect(window.location.search).toBe('?a=1');
    expect(readPageAttachParams()).toEqual({ at: CODE, relay: RELAY, sig: null });
  });

  it('returns nulls with nothing anywhere', () => {
    history.replaceState({ other: 1 }, '', '/?a=1');
    expect(readPageAttachParams()).toEqual({ at: null, relay: null, sig: null });
  });

  it('keeps other parameters byte for byte, and the path and hash', () => {
    history.replaceState(null, '', `/p/q?x=a%20b&at=1&empty&relay=${RELAY_ENC}&y=c+d#h`);
    hidePageAttachParams();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/p/q?x=a%20b&empty&y=c+d#h',
    );
  });

  it('removes a percent-encoded parameter name', () => {
    history.replaceState(null, '', '/?%61t=1&%72elay=wss%3A%2F%2Fa.example%2F&a=1');
    hidePageAttachParams();
    expect(window.location.search).toBe('?a=1');
    expect(readPageAttachParams()).toEqual({ at: '1', relay: RELAY, sig: null });
  });

  it('leaves no query string when only those parameters were there', () => {
    history.replaceState(null, '', `/app?relay=${RELAY_ENC}&at=${CODE}#frag`);
    hidePageAttachParams();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/app#frag',
    );
  });

  it('moves a relay that has no code', () => {
    history.replaceState(null, '', `/?debug=1&relay=${RELAY_ENC}`);
    hidePageAttachParams();
    expect(window.location.search).toBe('?debug=1');
    expect(readPageAttachParams()).toEqual({ at: null, relay: RELAY, sig: null });
  });

  it('keeps the app state keys', () => {
    history.replaceState({ route: 'home' }, '', `/?at=${CODE}&relay=${RELAY_ENC}`);
    hidePageAttachParams();
    expect(history.state).toEqual({
      route: 'home',
      __ait_debug_attach: { at: CODE, relay: RELAY },
    });
  });

  it('leaves a non-object app state alone', () => {
    history.replaceState('app-state', '', `/?at=${CODE}`);
    hidePageAttachParams();
    expect(history.state).toBe('app-state');
    expect(window.location.search).toBe('');
  });

  it('does nothing when neither parameter is in the URL', () => {
    history.replaceState({ route: 'home' }, '', '/?a=1');
    hidePageAttachParams();
    expect(history.state).toEqual({ route: 'home' });
    expect(window.location.search).toBe('?a=1');
  });

  it('does not treat a parameter that merely contains the name as one', () => {
    history.replaceState(null, '', '/?format=1&relayed=2&x_at=3');
    hidePageAttachParams();
    expect(window.location.search).toBe('?format=1&relayed=2&x_at=3');
  });

  it('survives a reload: the cleaned URL still yields both values for the gate', () => {
    history.replaceState(null, '', `/?debug=1&at=${CODE}&relay=${RELAY_ENC}`);
    hidePageAttachParams();
    // A reload re-reads the same history entry: URL without them, state intact.
    const params = pageSearchWithAttachParams();
    expect(params.get('debug')).toBe('1');
    expect(params.get('at')).toBe(CODE);
    expect(params.get('relay')).toBe(RELAY);
  });

  it('moves sig with the other two and a reload still yields it', () => {
    const SIG = 'S'.repeat(86);
    history.replaceState(null, '', `/?debug=1&at=${CODE}&relay=${RELAY_ENC}&sig=${SIG}&a=1`);
    hidePageAttachParams();
    expect(window.location.search).toBe('?debug=1&a=1');
    expect(readPageAttachParams()).toEqual({ at: CODE, relay: RELAY, sig: SIG });
    expect(pageSearchWithAttachParams().get('sig')).toBe(SIG);
  });

  it('does not carry the values into a new navigation entry', () => {
    history.replaceState(null, '', `/?at=${CODE}&relay=${RELAY_ENC}`);
    hidePageAttachParams();
    history.pushState(null, '', '/next?debug=1');
    const params = pageSearchWithAttachParams();
    expect(params.has('at')).toBe(false);
    expect(params.has('relay')).toBe(false);
    expect(params.has('sig')).toBe(false);
  });

  it('never throws when replaceState refuses, and leaves the URL as it was', () => {
    history.replaceState(null, '', `/?at=${CODE}`);
    const original = history.replaceState.bind(history);
    history.replaceState = () => {
      throw new Error('SecurityError');
    };
    try {
      expect(() => hidePageAttachParams()).not.toThrow();
      expect(window.location.search).toBe(`?at=${CODE}`);
    } finally {
      history.replaceState = original;
    }
  });
});
