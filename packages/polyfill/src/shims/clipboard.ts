/**
 * `navigator.clipboard` shim.
 *
 * Inside Apps in Toss → routes `readText` / `writeText` through the SDK
 * (`getClipboardText` / `setClipboardText`).
 *
 * Outside Apps in Toss → defers to the browser's native `navigator.clipboard`.
 * If the browser doesn't implement it, the standard `TypeError` / `DOMException`
 * surfaces unchanged — we don't paper over missing support.
 */

import { isTossEnvironment, loadTossSdk } from '../detect.js';
import { installSentinel } from '../sentinel.js';
import {
  type InstallSnapshot,
  installNavigatorProperty,
  restoreNavigatorProperty,
} from './_install-helpers.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

const BACKUP_KEY = Symbol.for('@ait-co/polyfill/clipboard.original');
const SNAPSHOT_KEY = Symbol.for('@ait-co/polyfill/clipboard.snapshot');

interface BackupHost {
  [BACKUP_KEY]?: Clipboard | undefined;
  [SNAPSHOT_KEY]?: InstallSnapshot | undefined;
}

/**
 * Produces a Clipboard-compatible object whose `readText` / `writeText` methods
 * route to the SDK when in Toss, else fall through to the supplied `fallback`.
 */
function createClipboardShim(fallback: Clipboard | undefined): Clipboard {
  const shim = {
    async readText(): Promise<string> {
      if (await isTossEnvironment()) {
        const sdk = await loadTossSdk();
        if (sdk?.getClipboardText) {
          return sdk.getClipboardText();
        }
      }
      if (!fallback) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.readText is not available in this environment.',
          'NotSupportedError',
        );
      }
      return fallback.readText();
    },

    async writeText(text: string): Promise<void> {
      if (await isTossEnvironment()) {
        const sdk = await loadTossSdk();
        if (sdk?.setClipboardText) {
          return sdk.setClipboardText(text);
        }
      }
      if (!fallback) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.writeText is not available in this environment.',
          'NotSupportedError',
        );
      }
      return fallback.writeText(text);
    },

    // `read` / `write` (ClipboardItem-based) are passed through to the
    // fallback when in browser mode; the SDK has no rich-content counterpart,
    // so in Toss mode they throw.
    async read(): Promise<ClipboardItems> {
      if (await isTossEnvironment()) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.read (rich content) is not supported in the Apps in Toss environment. Use readText instead.',
          'NotSupportedError',
        );
      }
      if (!fallback?.read) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.read is not available.',
          'NotSupportedError',
        );
      }
      return fallback.read();
    },

    async write(items: ClipboardItems): Promise<void> {
      if (await isTossEnvironment()) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.write (rich content) is not supported in the Apps in Toss environment. Use writeText instead.',
          'NotSupportedError',
        );
      }
      if (!fallback?.write) {
        throw new DOMException(
          '[@ait-co/polyfill] navigator.clipboard.write is not available.',
          'NotSupportedError',
        );
      }
      return fallback.write(items);
    },

    // EventTarget passthrough. `navigator.clipboard` extends EventTarget in the
    // spec; mini-apps rarely use it. We forward to the fallback when one exists;
    // in Toss mode (no fallback) we silently drop subscriptions — the SDK emits
    // no clipboard events, so there is nothing to dispatch. This is lossy but
    // preserves the spec-compatible shape.
    addEventListener: (
      ...args: Parameters<EventTarget['addEventListener']>
    ): ReturnType<EventTarget['addEventListener']> => fallback?.addEventListener(...args),
    removeEventListener: (
      ...args: Parameters<EventTarget['removeEventListener']>
    ): ReturnType<EventTarget['removeEventListener']> => fallback?.removeEventListener(...args),
    // Returns `false` in Toss mode (no backing EventTarget). A caller that reads
    // this as "default action cancelled" should check context — there are no
    // listeners to run because the SDK doesn't surface clipboard events.
    dispatchEvent: (event: Event): boolean => fallback?.dispatchEvent(event) ?? false,
  } satisfies Clipboard;

  return shim;
}

/**
 * Install the `navigator.clipboard` shim.
 *
 * @returns an uninstall function that restores the original `navigator.clipboard`.
 *          Calling install twice without uninstalling is a no-op on the second call
 *          and returns the same uninstall function.
 */
export function installClipboardShim(): () => void {
  if (typeof navigator === 'undefined') {
    // No-op in non-DOM environments (pure Node).
    return () => {};
  }

  const host = navigator as unknown as BackupHost;
  if (BACKUP_KEY in host) {
    // Already installed. Use `in` (not `!== undefined`) because the stored
    // backup is legitimately `undefined` when the browser has no native
    // `navigator.clipboard` — without this, we'd re-wrap on each install.
    // Note: the returned uninstall is global. Any caller's uninstall fully
    // removes the shim; callers do not have independent install handles.
    return () => uninstallClipboardShim();
  }

  const original = navigator.clipboard as Clipboard | undefined;
  host[BACKUP_KEY] = original;

  const shim = createClipboardShim(original);
  host[SNAPSHOT_KEY] = installNavigatorProperty('clipboard', {
    value: shim,
    configurable: true,
    writable: true,
  });

  return uninstallClipboardShim;
}

/**
 * Remove the shim and restore the pre-install shape.
 */
export function uninstallClipboardShim(): void {
  if (typeof navigator === 'undefined') return;
  const host = navigator as unknown as BackupHost;
  if (!(BACKUP_KEY in host)) return;

  const snapshot = host[SNAPSHOT_KEY];
  if (snapshot) restoreNavigatorProperty('clipboard', snapshot);
  delete host[BACKUP_KEY];
  delete host[SNAPSHOT_KEY];
}
