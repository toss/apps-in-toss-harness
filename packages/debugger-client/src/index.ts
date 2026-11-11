/**
 * @apps-in-toss/debugger-client entry point.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 *
 * Phase 1 — gate + browser-side Chii target injection.
 * WebSocket relay, QR/paste UI, and AI-host MCP bin are later phases that
 * require real-device validation and are not included here.
 *
 * This thin entry reads `window.location` and calls the pure
 * {@link evaluateDebugGate} function. All testable logic lives in `./gate.ts`
 * and `./attach.ts`, not here.
 *
 * Layer A of the activation gate (build-time) is NOT enforced in this module.
 * It is the consumer's responsibility: the consumer wraps its
 * `import('@apps-in-toss/debugger-client')` call site in `if (__DEBUG_BUILD__) { … }`
 * (see sdk-example `src/main.tsx`), where `__DEBUG_BUILD__` is a
 * consumer-build-time constant. A release consumer build folds that constant
 * to `false` and dead-code-eliminates this whole module. This package is
 * pre-built and ships with `__DEBUG_BUILD__` already resolved at devtools'
 * publish time, so it could never re-evaluate the consumer's build channel —
 * which is exactly why Layer A lives at the consumer guard, not here.
 */

import { isDebugAttached, type MaybeAttachOptions, maybeAttach } from './attach.js';
import { evaluateDebugGate, type GateResult } from './gate.js';
import { pageSearchWithAttachParams } from './page-at-code.js';
import { installSdkBridge } from './sdk-bridge.js';
import { installRemoteDebuggerTab } from './vconsole-tab.js';

export type { MaybeAttachOptions, RelayPublicKeyPin } from './attach.js';
export {
  deriveTargetScriptUrl,
  detachDebugSurface,
  disconnectDebugger,
  maybeAttach,
} from './attach.js';
export {
  BRIDGE_CALL_EVENT,
  type BridgeLastCall,
  type BridgeObserverState,
  type BridgePendingCall,
  installBridgeObserver,
  uninstallBridgeObserver,
} from './bridge-observer.js';
export type { GateInput, GateResult, GateResultAttach, GateResultBlocked } from './gate.js';
export { evaluateDebugGate, isPrivateAppsHost, isTossminiHost } from './gate.js';
export type { DebugStatus } from './status-banner.js';

/**
 * Evaluates the runtime debug activation layers (B and C) against the current
 * page URL.
 *
 * Returns the gate result. Callers can check `result.attach` to decide whether
 * to proceed with debug surface attachment.
 *
 * This function reads `window.location` only — both the hostname (Layer B1
 * host allowlist) and the search params (Layers B2 and C). Layer A
 * (build-time) is enforced by the consumer's `if (__DEBUG_BUILD__)` guard
 * around the import site, not here — see the file-level comment. Consumers
 * call this with no arguments, so the Layer B1 host check is picked up with
 * no change at the call site. After attach the `at` code and the `relay` address live on the history
 * entry instead of the URL (see `page-at-code.ts`), so a reload still gates.
 */
export function checkDebugGate(): GateResult {
  const searchParams = pageSearchWithAttachParams();
  return evaluateDebugGate({ hostname: window.location.hostname, searchParams });
}

/**
 * Gates the current page and, when the gate passes, attaches the debug surface.
 * The entry point a debug build calls:
 *
 * ```ts
 * if (__DEBUG_BUILD__) {
 *   import('@apps-in-toss/debugger-client').then((m) =>
 *     m.startDebugConsole({ relayPublicKeys: [<output of `debugger relay-key`>] }),
 *   );
 * }
 * ```
 *
 * `relayPublicKeys` are the public keys of the projects whose debugger may
 * serve this bundle. On a QR test page the relay address in the URL is trusted
 * only when its signature verifies against one of them. Public values: safe to
 * commit. See {@link maybeAttach}. On a QR test page that asked for a debug
 * session, a "Remote Debugging" tab is also added to the page's vConsole when one
 * is found (`options.vConsole`, `window.vConsole`, or one created shortly after).
 */
export function startDebugConsole(options?: MaybeAttachOptions): Promise<void> | undefined {
  installRemoteDebuggerTab({ vConsole: options?.vConsole });
  const attaching = maybeAttach(checkDebugGate(), options);
  // The SDK bridge (`window.__sdk` / `window.__sdkCall`, used by the debugger's
  // `call_sdk`) goes in only once the attach was accepted: never on a blocked
  // gate or a relay signature that did not verify.
  const installBridge = (): Promise<void> | undefined =>
    isDebugAttached() ? installSdkBridge() : undefined;
  if (attaching === undefined) {
    void installBridge();
    return undefined;
  }
  return attaching.then(installBridge);
}
