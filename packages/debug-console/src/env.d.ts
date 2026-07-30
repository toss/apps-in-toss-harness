/**
 * Injected by tsdown at build time from `package.json`'s version.
 *
 * This is the device half of the attach version handshake: it rides on the
 * `/ait-attach` ping so the daemon can name a device↔host version skew instead
 * of letting the two sides misbehave silently (see
 * `@ait-co/internal-protocol/attach-handshake`).
 */
declare const __VERSION__: string;

/**
 * Consumer-build constant injected by the devtools unplugin from the mini-app's
 * `granite.config.ts` `webViewProps.type` (`@default 'partner'`).
 *
 * Like `__DEBUG_BUILD__`, this is a CONSUMER-build define — it does NOT exist
 * in this package's own build/test runs. Source that reads it MUST guard with
 * `typeof __WEB_VIEW_TYPE__ !== 'undefined'` so a bare reference never throws a
 * ReferenceError where the define was not injected. Declared here only so the
 * `typeof` guard and the read narrow correctly under `tsc --noEmit`.
 *
 * `'external'` is the SDK's deprecated alias of `'partner'` (web-framework
 * 2.6.1); the in-app self-report maps it to `'partner'` before posting.
 */
declare const __WEB_VIEW_TYPE__: 'partner' | 'external' | 'game' | undefined;

// Note: no `__DEBUG_BUILD__` global is declared here. That is a CONSUMER-build
// constant — the consumer guards `import('@ait-co/debug-console')` with
// `if (__DEBUG_BUILD__)`. This package's own source never references it; the
// gate evaluates only the runtime layers (see src/gate.ts).
