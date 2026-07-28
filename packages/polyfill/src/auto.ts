/**
 * Side-effect entry point: `import '@ait-co/polyfill/auto'`
 *
 * Kicks off detection and, if we're inside Apps in Toss, installs every shim
 * this library ships. In a plain browser this is a no-op — browser native
 * APIs stay untouched. No-op idempotent: importing the entry more than once
 * doesn't re-install.
 *
 * Use this when you want the "just add the dep" experience. If you need to
 * observe when the polyfill actually attached (to gate init logic) or to tear
 * it down, import `install` / `uninstall` from `@ait-co/polyfill` directly.
 */

import { install } from './index.js';

void install();
