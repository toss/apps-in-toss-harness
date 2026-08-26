/**
 * Injected by tsdown at build time from `package.json`'s version.
 *
 * This is the device half of the attach version handshake: it rides on the
 * `/ait-attach` ping so the daemon can name a device↔host version skew instead
 * of letting the two sides misbehave silently (see
 * `@apps-in-toss/internal-protocol/attach-handshake`).
 */
declare const __VERSION__: string;

// Note: no `__DEBUG_BUILD__` global is declared here. That is a CONSUMER-build
// constant — the consumer guards `import('@apps-in-toss/debug-console')` with
// `if (__DEBUG_BUILD__)`. This package's own source never references it; the
// gate evaluates only the runtime layers (see src/gate.ts).
