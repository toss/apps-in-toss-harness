// Minimal release-consumer reference for the build-time absence guard
// (devtools#647, ported to this split's package boundary).
//
// This is NOT a panel/mock fixture — it is the smallest possible consumer
// that imports the in-app debug surface the way a real mini-app does: a
// dynamic `import('@ait-co/debug-console')` guarded by
// `if (__DEBUG_BUILD__)`. The guard is the only thing under test, so this
// file deliberately avoids any mock/panel self-alias graph.
//
// scripts/check-debug-surface-absent.sh builds this in two modes:
//   - release (AIT_DEBUG_BUILD unset -> __DEBUG_BUILD__ false): the whole
//     `import('@ait-co/debug-console')` graph — Chii target.js injection AND
//     the eruda console it pulls in — must DCE to 0 bytes.
//   - debug (AIT_DEBUG_BUILD=1 -> true): the surface must survive (positive
//     control), and the inner runtime gate (debug=1 + relay + Layer B/C TOTP
//     in maybeAttach) still applies.
//
// Note: this fixture depends on the sibling @ait-co/debug-console package's
// BUILT dist/ output (its `exports` map points at ./dist/*), so it only
// resolves correctly after `pnpm build` has run for that package — which is
// why this file is excluded from the static `pnpm typecheck` sweep (see
// ../tsconfig.json) and is instead exercised only by the real `vite build`
// this check script runs.
if (__DEBUG_BUILD__ && typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') === '1' && params.get('relay')) {
    import('@ait-co/debug-console').then(({ maybeAttach }) => {
      maybeAttach();
    });
  }
}
