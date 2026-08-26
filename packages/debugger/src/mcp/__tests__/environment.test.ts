/**
 * Unit tests for the derived environment model (issue #348, #665, #103).
 *
 * The 5-step precedence chain + URL sniffing was deleted: env is now derived
 * from `connection.kind` alone (mock vs relay). `liveIntent` / `relay-live`
 * removed in #665; the `relayOrigin` discriminator went away with `relay-mobile`
 * (env 2) in #103.
 *
 * These tests cover:
 *   - `deriveEnvironment(kind)` — both arms
 *   - `isRelayEnv` / `toLegacyEnv`
 *   - the narrow `setEnvironmentOverride` test hook
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveEnvironment,
  getEnvironmentOverride,
  isRelayEnv,
  setEnvironmentOverride,
  toLegacyEnv,
} from '../environment.js';

describe('deriveEnvironment — connection.kind', () => {
  it('local kind → mock', () => {
    expect(deriveEnvironment('local')).toBe('mock');
  });

  it('relay kind → relay-dev (the intoss-private relay)', () => {
    expect(deriveEnvironment('relay')).toBe('relay-dev');
  });
});

// liveIntent tests removed — relay-live (env 4) and the liveIntent bit are
// fully removed in #665.

describe('isRelayEnv', () => {
  it('covers the relay variant (relay-live removed #665, relay-mobile #103)', () => {
    expect(isRelayEnv('relay-dev')).toBe(true);
    expect(isRelayEnv('mock')).toBe(false);
  });
});

// isLiveRelayEnv removed — relay-live and LIVE guard removed in #665.

describe('toLegacyEnv', () => {
  it('collapses the two-value env to mock | relay', () => {
    expect(toLegacyEnv('mock')).toBe('mock');
    expect(toLegacyEnv('relay-dev')).toBe('relay');
  });
});

describe('setEnvironmentOverride — narrow test hook', () => {
  afterEach(() => setEnvironmentOverride(null));

  it('stores and clears the override', () => {
    expect(getEnvironmentOverride()).toBeNull();
    setEnvironmentOverride('relay-dev');
    expect(getEnvironmentOverride()).toBe('relay-dev');
    setEnvironmentOverride(null);
    expect(getEnvironmentOverride()).toBeNull();
  });
});
