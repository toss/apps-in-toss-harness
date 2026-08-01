/**
 * Pins the wire constants both packages duplicate by value.
 *
 * These assertions look tautological, and that is the point: nothing in the
 * type system connects the daemon's close-frame emitter to the device's
 * close-frame reader, or the device's `window.__ait_bridge` writer to the
 * source string the daemon evaluates. Changing a literal here is a deliberate
 * protocol break; the test makes it one that fails loudly rather than one that
 * silently produces an empty indicator.
 */

import { describe, expect, it } from 'vitest';
import {
  BRIDGE_CALL_EVENT,
  BRIDGE_STATE_GLOBAL,
  RELAY_WS_OBSERVED_FLAG,
  RELAY_WS_STATE_EVENT,
} from '../bridge-observer-state.js';
import { RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON } from '../relay-auth-close.js';

describe('relay auth rejection', () => {
  it('uses an application close code, not a protocol one', () => {
    // RFC 6455 §7.4.2 reserves 4000–4999 for applications. Anything below it
    // is either reserved or already means something else to the browser.
    expect(RELAY_AUTH_REJECT_CLOSE_CODE).toBeGreaterThanOrEqual(4000);
    expect(RELAY_AUTH_REJECT_CLOSE_CODE).toBeLessThanOrEqual(4999);
    expect(RELAY_AUTH_REJECT_CLOSE_CODE).toBe(4401);
  });

  it('names the rejection with a fixed enum string', () => {
    expect(RELAY_AUTH_REJECT_REASON).toBe('totp-rejected');
    // A close reason is capped at 123 UTF-8 bytes and a value that overflows is
    // truncated or throws depending on the runtime. Pinning it to plain ASCII
    // makes the character count the byte count — and keeps the assertion inside
    // this package's deliberately dependency-free lib (no Node, no DOM, so no
    // `TextEncoder` to measure with).
    expect(RELAY_AUTH_REJECT_REASON).toMatch(/^[\x20-\x7e]+$/);
    expect(RELAY_AUTH_REJECT_REASON.length).toBeLessThanOrEqual(123);
  });
});

describe('bridge observer names', () => {
  it('pins the event names the daemon interpolates into CDP source', () => {
    expect(BRIDGE_CALL_EVENT).toBe('ait:bridge-call');
    expect(RELAY_WS_STATE_EVENT).toBe('ait:relay-ws-state');
  });

  it('pins the window property names', () => {
    expect(BRIDGE_STATE_GLOBAL).toBe('__ait_bridge');
    expect(RELAY_WS_OBSERVED_FLAG).toBe('__ait_relay_ws_observed');
  });

  it('keeps the window names usable as bare property accessors', () => {
    // The daemon reaches these as `window.<name>` inside a source string it
    // builds by concatenation, so a name needing bracket syntax would emit
    // code that does not parse.
    for (const name of [BRIDGE_STATE_GLOBAL, RELAY_WS_OBSERVED_FLAG]) {
      expect(name).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
    }
  });
});
