/**
 * `DualConnectionRouter` direction-symmetry tests (issues #356, #378, #396).
 *
 * #354 introduced the dual-connection router but wired it only into the
 * relay-launched `runDebugServer`. A `--target=local` start (`runLocalDebugServer`)
 * still pinned a single-connection router, so a cross-family `start_debug`
 * (local → relay) was rejected as "restart required". #356 generalized the
 * router to be **direction-neutral**: any family could be the eager (startup)
 * one and a lazy resolver booted the rest. #378 generalized the lazy slot from a
 * single "opposite kind" into a `bootLazyFor(key: FamilyKey)` resolver keyed by
 * `local-browser | relay-intoss` (the third key, `relay-sandbox`, went away with
 * 환경 2 in #103). #396 makes the router **all-lazy**:
 * NO family boots at startup; every
 * family boots on its first `start_debug` via `bootLazyFor(key)`. So before the
 * first switch `router.active` is the NULL sentinel and `bootedFamilies()` is
 * empty. (This routes every relay boot through `switchMode` → the project-local
 * `.ait_relay` secret load runs first.)
 *
 * This suite exercises the real `DualConnectionRouter` (not a test double) with
 * fake `BootedFamily` deps, over the matrix:
 *   (first-switch target family) × (same-family vs cross-family follow-up)
 *
 * It covers the #356 core (local → relay hot-switch), warm reuse of a booted
 * family, `relayTunnelStatus()` sourcing,
 * `bootedFamilies()` for unified shutdown, and the #396 all-lazy pre-boot state.
 *
 * No real Chromium / relay / tunnel — fakes only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import {
  type BootedFamily,
  bootRelayFamily,
  DualConnectionRouter,
  type FamilyKey,
  familyKeyForMode,
  type StartDebugMode,
} from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { InMemoryDiagnosticsCollector, type TunnelStatus } from '../tools.js';

// ---- Fakes -----------------------------------------------------------------

class FakeConn implements CdpConnection {
  readonly kind: 'relay' | 'local';
  constructor(kind: 'relay' | 'local') {
    this.kind = kind;
  }
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return [];
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error(`no canned result for ${_m}`));
  }
}

/** A `BootedFamily` fake that tracks teardown and (for relay) tunnel status. */
function makeFamily(
  kind: 'relay' | 'local',
  tunnel?: TunnelStatus,
): BootedFamily & { stopped: number } {
  const family = {
    connection: new FakeConn(kind),
    stopped: 0,
    stop() {
      family.stopped += 1;
    },
    ...(tunnel ? { getTunnelStatus: () => tunnel } : {}),
  };
  return family;
}

/**
 * Builds an all-lazy router (#396): NO family boots at construction. The router
 * holds a `local` family and a single intoss-relay family, BOTH resolved lazily
 * by `bootLazyFor(key)` on the first `start_debug` for that key. Since 환경 2
 * was removed (#103) `relay-intoss` is the only relay key, so any `relay-*` key
 * resolves the same warm `relay` family.
 *
 * `primaryKind` names the family the suite treats as the "first booted" one
 * (`eager` in the returned bag, for readability of the legacy assertions); with
 * all-lazy boot it is simply whichever family the test switches to first.
 * `getRelayBootCount` counts boots of the relay family (the lazily-booted slot
 * the cross-family assertions track); `getLocalBootCount` counts local boots.
 */
function makeRouter(
  primaryKind: 'relay' | 'local',
  opts: { eagerTunnel?: TunnelStatus; lazyTunnel?: TunnelStatus } = {},
) {
  // Map the legacy `eagerTunnel`/`lazyTunnel` opts onto the two families: the
  // primary-kind family carries `eagerTunnel`, the opposite-kind carries
  // `lazyTunnel`.
  const localTunnel = primaryKind === 'local' ? opts.eagerTunnel : opts.lazyTunnel;
  const relayTunnel = primaryKind === 'relay' ? opts.eagerTunnel : opts.lazyTunnel;
  const local = makeFamily('local', localTunnel);
  const relay = makeFamily('relay', relayTunnel);
  const eager = primaryKind === 'local' ? local : relay;
  const lazy = primaryKind === 'local' ? relay : local;
  let relayBootCount = 0;
  let localBootCount = 0;
  const bootLazyFor = vi.fn(async (key: FamilyKey) => {
    if (key === 'local-browser') {
      localBootCount += 1;
      return local;
    }
    relayBootCount += 1;
    return relay;
  });
  const router = new DualConnectionRouter({
    bootLazyFor,
    diagnosticsCollector: new InMemoryDiagnosticsCollector(),
    devtoolsOpener: new AutoDevtoolsOpener(),
  });
  return {
    router,
    eager,
    lazy,
    local,
    relay,
    bootLazyFor,
    // Legacy name kept: the "lazy" slot the cross-family tests track is always
    // the relay family (the suite swaps between local and the intoss relay).
    getLazyBootCount: () => relayBootCount,
    getRelayBootCount: () => relayBootCount,
    getLocalBootCount: () => localBootCount,
  };
}

// ---- (eager-kind × target) matrix ------------------------------------------

describe('DualConnectionRouter — relay-first (runDebugServer entry, #354 behavior preserved, all-lazy #396)', () => {
  it('relay first switch (relay-staging) lazy-boots the relay family once', async () => {
    const { router, relay, getRelayBootCount } = makeRouter('relay');
    // All-lazy: nothing booted at construction.
    expect(getRelayBootCount()).toBe(0);
    const report = await router.switchMode('relay-staging');
    expect(report.kind).toBe('relay');
    // Output env layer unchanged ('relay-dev' from deriveEnvironment).
    expect(report.environment).toBe('relay-dev');
    expect(router.active).toBe(relay.connection);
    expect(getRelayBootCount()).toBe(1);
  });

  it('relay → relay-staging twice reuses the warm relay family (no re-boot)', async () => {
    const { router, relay, getRelayBootCount } = makeRouter('relay');
    await router.switchMode('relay-staging');
    await router.switchMode('relay-staging');
    expect(router.active).toBe(relay.connection);
    expect(getRelayBootCount()).toBe(1);
  });

  it('relay → then local lazy-boots local as a separate family', async () => {
    const { router, local, getLocalBootCount } = makeRouter('relay');
    await router.switchMode('relay-staging');
    const report = await router.switchMode('local-browser');
    expect(report.kind).toBe('local');
    expect(report.environment).toBe('mock');
    expect(router.active).toBe(local.connection);
    expect(getLocalBootCount()).toBe(1);
  });
});

describe('DualConnectionRouter — local-first (runLocalDebugServer entry, #356 core, all-lazy #396)', () => {
  it('local first switch lazy-boots the local family, never booting relay', async () => {
    const { router, local, getRelayBootCount, getLocalBootCount } = makeRouter('local');
    const report = await router.switchMode('local-browser');
    expect(report.kind).toBe('local');
    expect(report.environment).toBe('mock');
    expect(router.active).toBe(local.connection);
    expect(router.active.kind).toBe('local');
    expect(getLocalBootCount()).toBe(1);
    expect(getRelayBootCount()).toBe(0);
  });

  it('local → local twice reuses the warm local family, no relay boot', async () => {
    const { router, local, getRelayBootCount, getLocalBootCount } = makeRouter('local');
    await router.switchMode('local-browser');
    await router.switchMode('local-browser');
    expect(router.active).toBe(local.connection);
    expect(getLocalBootCount()).toBe(1);
    expect(getRelayBootCount()).toBe(0);
  });

  it('CROSS-FAMILY HOT-SWITCH local-browser → relay-staging lazy-boots relay once (#356)', async () => {
    const { router, relay, getRelayBootCount } = makeRouter('local');
    await router.switchMode('local-browser');
    expect(router.active.kind).toBe('local');
    const report = await router.switchMode('relay-staging');
    expect(report.kind).toBe('relay');
    // Output env layer unchanged ('relay-dev' from deriveEnvironment).
    expect(report.environment).toBe('relay-dev');
    // The active pointer flipped to the lazily-booted relay — no restart needed.
    expect(router.active).toBe(relay.connection);
    expect(getRelayBootCount()).toBe(1);
  });
});

// ---- #396: all-lazy — NO family boots at construction ----------------------

describe('DualConnectionRouter — all-lazy boot (#396)', () => {
  it('boots NO family at construction: active is the NULL sentinel', () => {
    const { router, getRelayBootCount, getLocalBootCount } = makeRouter('local');
    // Neither family booted — the active connection is the inert NULL sentinel.
    expect(getLocalBootCount()).toBe(0);
    expect(getRelayBootCount()).toBe(0);
    // The sentinel answers read calls inertly (empty lists, no targets)…
    expect(router.active.listTargets()).toEqual([]);
    expect(router.active.getBufferedEvents('Runtime.consoleAPICalled')).toEqual([]);
    // …and bootedFamilies() is empty (nothing to shut down yet).
    expect(router.bootedFamilies()).toEqual([]);
  });

  it('the NULL sentinel rejects any CDP command with a boot-first hint', async () => {
    const { router } = makeRouter('local');
    await expect(router.active.send('DOM.getDocument')).rejects.toThrow(
      /no family booted yet — call start_debug first/,
    );
  });

  it('relayTunnelStatus() is down before any family boots (start_attach gated)', () => {
    const { router } = makeRouter('local', {
      lazyTunnel: { up: true, wssUrl: 'wss://x.trycloudflare.com' },
    });
    // Even though the (not-yet-booted) relay family carries an up tunnel, the
    // router reports DOWN until that family actually boots.
    expect(router.relayTunnelStatus()).toEqual({ up: false, wssUrl: null });
  });
});

// ---- lazy boot happens exactly once, warm reuse afterwards -----------------

describe('DualConnectionRouter — lazy boot is once-only, family kept warm', () => {
  it('local-first: relay booted on first relay switch, both families reused after', async () => {
    const { router, local, relay, getRelayBootCount, getLocalBootCount } = makeRouter('local');
    // Boot local first, then cross to relay.
    await router.switchMode('local-browser');
    expect(getLocalBootCount()).toBe(1);
    await router.switchMode('relay-staging');
    expect(getRelayBootCount()).toBe(1);
    // Bounce back to local — the warm local family is reused, NOT re-booted.
    await router.switchMode('local-browser');
    expect(router.active).toBe(local.connection);
    expect(getLocalBootCount()).toBe(1);
    // Return to relay — the warm relay family is reused, NOT re-booted.
    await router.switchMode('relay-staging');
    expect(router.active).toBe(relay.connection);
    expect(getRelayBootCount()).toBe(1);
  });
});

// relay-live confirm gate tests removed — relay-live and LIVE guard removed (#665).

// ---- relayTunnelStatus() sourcing ------------------------------------------

describe('DualConnectionRouter — relayTunnelStatus()', () => {
  const upTunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };

  it('relay-first: down before the relay boots, then reads the relay tunnel', async () => {
    const { router } = makeRouter('relay', { eagerTunnel: upTunnel });
    // All-lazy: no relay family yet → tunnel is down (start_attach gated).
    expect(router.relayTunnelStatus()).toEqual({ up: false, wssUrl: null });
    await router.switchMode('relay-staging');
    expect(router.relayTunnelStatus()).toEqual(upTunnel);
  });

  it('local-first: reports down before the relay is booted, then follows it', async () => {
    const { router } = makeRouter('local', { lazyTunnel: upTunnel });
    await router.switchMode('local-browser');
    // No relay family yet → tunnel is down (start_attach stays gated).
    expect(router.relayTunnelStatus()).toEqual({ up: false, wssUrl: null });
    await router.switchMode('relay-staging');
    // After the relay switch the relay family's tunnel status is exposed.
    expect(router.relayTunnelStatus()).toEqual(upTunnel);
  });
});

// ---- bootedFamilies() for unified shutdown ---------------------------------

describe('DualConnectionRouter — bootedFamilies() drives unified shutdown', () => {
  it('all-lazy: empty before any switch, local after first, both after a cross switch', async () => {
    const { router, local, relay } = makeRouter('local');
    // #396: nothing booted at construction.
    expect(router.bootedFamilies()).toEqual([]);
    await router.switchMode('local-browser');
    expect(router.bootedFamilies()).toEqual([local]);
    await router.switchMode('relay-staging');
    expect(router.bootedFamilies()).toEqual([local, relay]);
    // Tearing down every booted family stops both (one Chromium + one relay).
    for (const family of router.bootedFamilies()) family.stop();
    expect(local.stopped).toBe(1);
    expect(relay.stopped).toBe(1);
  });
});

// ---- swapInFlight re-entrancy guard (preserved from #354) ------------------

describe('DualConnectionRouter — swapInFlight re-entrancy guard', () => {
  it('rejects a second switch while the first lazy boot is still in flight', async () => {
    const relay = makeFamily('relay');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const bootLazyFor = vi.fn(async (_key: FamilyKey) => {
      await gate;
      return relay;
    });
    const router = new DualConnectionRouter({
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
    });

    const first = router.switchMode('relay-staging');
    // Second call arrives while the first is awaiting the lazy boot.
    await expect(router.switchMode('relay-staging')).rejects.toThrow(/이전 전환이 아직 진행 중/);
    release();
    await first;
    expect(bootLazyFor).toHaveBeenCalledTimes(1);
    expect(router.active).toBe(relay.connection);
  });
});

// ---- #378: family-key mapping + relay-boot auth baseline -------------------

describe('familyKeyForMode (#378)', () => {
  it('maps each mode to its serving family slot', () => {
    expect(familyKeyForMode('local-browser')).toBe('local-browser');
    expect(familyKeyForMode('relay-staging')).toBe('relay-intoss');
    // relay-live (#665) and relay-sandbox (#103) removed — familyKeyForMode
    // returns undefined for them (no matching case in the exhaustive switch).
    expect(familyKeyForMode('relay-live' as StartDebugMode)).toBeUndefined();
    expect(familyKeyForMode('relay-sandbox' as StartDebugMode)).toBeUndefined();
  });
});

// Relay-auth baseline wiring (issue #250): the guard lives in the relay-boot
// site, so booting the relay WITHOUT a configured secret must fail fast before
// the Chii relay / cloudflared tunnel comes up. This proves the guard is wired
// into the boot path (not just the standalone unit in relay-auth-required.test.ts).
describe('bootRelayFamily — relay-auth baseline (#250)', () => {
  beforeEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('rejects boot when AIT_DEBUG_TOTP_SECRET is unset (public relay must be authed)', async () => {
    await expect(bootRelayFamily()).rejects.toThrow(/AIT_DEBUG_TOTP_SECRET/);
  });

  it('rejects boot when AIT_DEBUG_TOTP_SECRET is a weak (non-hex) value', async () => {
    process.env.AIT_DEBUG_TOTP_SECRET = 'Z'.repeat(40);
    await expect(bootRelayFamily()).rejects.toThrow(/AIT_DEBUG_TOTP_SECRET/);
  });
});

// Local-only exemption (issue #250): `bootLocalFamily` launches a Chromium and
// NEVER opens a relay, so it must not call the relay-auth guard. We do NOT boot a
// real Chromium here (heavy/flaky); the exemption is structural — `bootLocalFamily`
// has no `assertRelayAuthConfigured` call in its body, and a local-only session
// only ever resolves the 'local-browser' family key. The relay-boot wiring tests
// above (which DO throw without a secret) confirm the guard is exclusive to relay
// boots.
//
// Pin the mode-type so an accidental literal typo fails to compile.
// relay-live removed (#665), relay-sandbox (#103) — 2-value exhaustive list.
const _exhaustive: StartDebugMode[] = ['local-browser', 'relay-staging'];
void _exhaustive;
