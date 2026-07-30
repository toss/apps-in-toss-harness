/**
 * The `window.__ait_bridge` snapshot shape and the event/global names the
 * device publishes it under.
 *
 * The device (`@ait-co/debug-console`) writes the snapshot; the daemon
 * (`@ait-co/debugger`) reads it back field-by-field from inside a CDP
 * `Runtime.evaluate` source string it assembles as text. There is therefore no
 * compile-time link between writer and reader — the daemon's use of the
 * interface is type-only (erased entirely) and its use of the name constants is
 * string interpolation. Keeping both in one module is what makes a rename a
 * compile error on the writing side and a single edit on the reading side,
 * instead of a silent no-op badge.
 *
 * SECRET-HANDLING: the snapshot holds API METHOD NAMES + timestamps + a
 * correlation id ONLY. It must never grow fields for call arguments, results,
 * relay URLs, or auth codes.
 */

/** Name of the API being called (never its arguments). */
export interface BridgePendingCall {
  method: string;
  /** `Date.now()` epoch ms when the call was dispatched. */
  startedAt: number;
}

/** The most-recent bridge activity — API name + wall-clock + settle status. */
export interface BridgeLastCall {
  method: string;
  /** `Date.now()` epoch ms of the start or settle that produced this record. */
  at: number;
  status: 'pending' | 'resolved' | 'rejected';
}

/**
 * The snapshot exposed on `window.__ait_bridge`. `pending` is keyed by
 * correlation id so a settle is an O(1) delete; the indicator reads
 * `Object.values(pending)` and computes each call's live elapsed itself.
 */
export interface BridgeObserverState {
  pending: Record<string, BridgePendingCall>;
  last: BridgeLastCall | null;
}

/**
 * CustomEvent fired (no detail) on every bridge-call start/settle so the
 * indicator badge re-renders promptly. SECRET-HANDLING: carries no detail
 * payload at all — the badge reads the enum-only snapshot on receipt.
 */
export const BRIDGE_CALL_EVENT = 'ait:bridge-call';

/**
 * CustomEvent fired with `{ detail: { state } }` on every relay-WebSocket
 * open/close, so a CDP-injected indicator can follow relay liveness without
 * installing a second Proxy on `window.WebSocket`. `state` is an enum
 * (`'open' | 'closed'`) — never a URL.
 */
export const RELAY_WS_STATE_EVENT = 'ait:relay-ws-state';

/**
 * Window flag the device sets once its relay-WebSocket observer is installed.
 * The daemon reads it to decide between subscribing to
 * {@link RELAY_WS_STATE_EVENT} and installing its own fallback observer.
 */
export const RELAY_WS_OBSERVED_FLAG = '__ait_relay_ws_observed';

/** Window property the {@link BridgeObserverState} snapshot is published on. */
export const BRIDGE_STATE_GLOBAL = '__ait_bridge';
