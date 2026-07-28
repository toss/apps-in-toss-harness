/**
 * `navigator.share` shim.
 *
 * Inside Apps in Toss → routes through SDK `share({ message })`. The SDK only
 * accepts a single `message` string, so we concatenate `title`, `text`, and
 * `url` with newline separators (skipping missing/empty values).
 *
 * Outside Apps in Toss → defers to the browser's native `navigator.share`, or
 * throws `NotSupportedError` if unavailable.
 *
 * Install strategy: **method-level** on `navigator`. Assigning
 * `navigator.share = fn` creates an own property that shadows the prototype
 * method. Uninstall deletes the own shadow so the prototype method surfaces
 * again. We do not mutate `Navigator.prototype` — in real browsers its
 * descriptor may be non-configurable, which would throw on reassignment.
 *
 * Caveat: the SDK's share has no counterpart for `files` (Web Share Level 2).
 * `canShare({ files })` returns `false` whenever the sync-accessible detection
 * says Toss is active (or is being forced via the test override).
 */

import { isTossEnvironment, isTossEnvironmentCached, loadTossSdk } from '../detect.js';
import { installSentinel } from '../sentinel.js';
import {
  installObjectMethods,
  type MethodInstallSnapshot,
  restoreObjectMethods,
} from './_install-helpers.js';

// Explicit call (not a bare side-effect import) so the sentinel survives
// tree-shaking in both our own build and consumer bundlers — see #74.
installSentinel();

const SHARE_BACKUP_KEY = Symbol.for('@ait-co/polyfill/share.original');
const SHARE_SNAPSHOT_KEY = Symbol.for('@ait-co/polyfill/share.snapshot');

type ShareFn = (data?: ShareData) => Promise<void>;
type CanShareFn = (data?: ShareData) => boolean;

interface Backup {
  share: ShareFn | undefined;
  canShare: CanShareFn | undefined;
}

interface BackupHost {
  [SHARE_BACKUP_KEY]?: Backup | undefined;
  [SHARE_SNAPSHOT_KEY]?: MethodInstallSnapshot | undefined;
}

function buildSdkMessage(data: ShareData | undefined): string {
  // Use presence checks rather than truthiness so an intentionally empty
  // string in one field is handled correctly alongside a non-empty sibling.
  const parts: string[] = [];
  if (data?.title != null && data.title !== '') parts.push(data.title);
  if (data?.text != null && data.text !== '') parts.push(data.text);
  if (data?.url != null && data.url !== '') parts.push(data.url);
  return parts.join('\n');
}

async function shareShim(data?: ShareData): Promise<void> {
  if (await isTossEnvironment()) {
    const sdk = await loadTossSdk();
    const fn = (sdk as { share?: unknown } | null)?.share;
    if (typeof fn === 'function') {
      const message = buildSdkMessage(data);
      if (!message) {
        throw new TypeError(
          '[@ait-co/polyfill] navigator.share requires at least one of title, text, or url.',
        );
      }
      try {
        await (fn as (o: { message: string }) => Promise<void>)({ message });
      } catch (e) {
        // Spec says navigator.share rejects with a DOMException. Wrap SDK
        // errors as AbortError (the most common cause is user cancellation),
        // attaching the original as `.cause` for Sentry-style telemetry.
        const message_ = e instanceof Error ? e.message : String(e);
        const wrapped = new DOMException(message_, 'AbortError');
        if (e instanceof Error) {
          (wrapped as Error).cause = e;
        }
        throw wrapped;
      }
      return;
    }
  }
  const host = navigator as unknown as BackupHost;
  const backup = host[SHARE_BACKUP_KEY];
  const original = backup?.share;
  if (!original) {
    throw new DOMException(
      '[@ait-co/polyfill] navigator.share is not available in this environment.',
      'NotSupportedError',
    );
  }
  return original(data);
}

function canShareShim(data?: ShareData): boolean {
  const hasFiles = Boolean(data?.files && data.files.length > 0);
  const toss = isTossEnvironmentCached();

  if (hasFiles) {
    // SDK does not share files. If we know we're in Toss (or it's being
    // forced), say so honestly. If detection hasn't resolved yet, be
    // pessimistic — a false negative is safer than promising a capability
    // we'll turn around and deny.
    if (toss === true) return false;
    if (toss === undefined) return false;
  }

  // Toss with non-file payloads: true iff there's at least one field.
  if (toss === true) {
    return Boolean(
      (data?.title != null && data.title !== '') ||
        (data?.text != null && data.text !== '') ||
        (data?.url != null && data.url !== ''),
    );
  }

  // `toss === undefined` (detection not resolved) with non-file payload falls
  // through to the browser-native answer. Rationale: `canShare` is rarely
  // load-bearing — consumers care about `share()` itself, which awaits the
  // async detection correctly. A false-negative here would needlessly hide a
  // Share button while detection settles.
  // Browser path: delegate to native when present.
  const host = navigator as unknown as BackupHost;
  const backup = host[SHARE_BACKUP_KEY];
  const originalCanShare = backup?.canShare;
  if (originalCanShare) {
    return originalCanShare(data);
  }
  return Boolean(
    (data?.title != null && data.title !== '') ||
      (data?.text != null && data.text !== '') ||
      (data?.url != null && data.url !== ''),
  );
}

export function installShareShim(): () => void {
  if (typeof navigator === 'undefined') {
    return () => {};
  }

  const host = navigator as unknown as BackupHost;
  if (SHARE_BACKUP_KEY in host) {
    // Already installed. Use `in` so the absence of `share` / `canShare` on
    // the pre-install navigator (legitimately stored as `undefined`) doesn't
    // re-trigger install.
    return () => uninstallShareShim();
  }

  const nav = navigator as Navigator & {
    share?: ShareFn;
    canShare?: CanShareFn;
  };
  // Capture the native methods BEFORE patching, bound to `navigator` so that
  // fallback calls keep the correct `this` and never recurse through our shim.
  host[SHARE_BACKUP_KEY] = {
    share: nav.share ? nav.share.bind(navigator) : undefined,
    canShare: nav.canShare ? nav.canShare.bind(navigator) : undefined,
  };

  const snapshot = installObjectMethods(navigator, {
    share: shareShim as (...args: never[]) => unknown,
    canShare: canShareShim as (...args: never[]) => unknown,
  });

  if (!snapshot) {
    // Slots frozen. Back out the backup bookkeeping so a later install can retry.
    delete host[SHARE_BACKUP_KEY];
    return () => uninstallShareShim();
  }

  host[SHARE_SNAPSHOT_KEY] = snapshot;
  return uninstallShareShim;
}

export function uninstallShareShim(): void {
  if (typeof navigator === 'undefined') return;
  const host = navigator as unknown as BackupHost;
  if (!(SHARE_BACKUP_KEY in host)) return;

  const snapshot = host[SHARE_SNAPSHOT_KEY];
  if (snapshot) restoreObjectMethods(snapshot);

  delete host[SHARE_BACKUP_KEY];
  delete host[SHARE_SNAPSHOT_KEY];
}
