// Release-consumer reference for the `/auto` entry, used by
// scripts/check-debug-surface-absent.sh next to main.ts.
//
// `@apps-in-toss/debugger-client/auto` is a runtime self-gating entry: imported
// on its own it keeps its code in the bundle and only stays asleep at runtime.
// The only way a release bundle drops it is the same build-time guard main.ts
// uses, so this file imports it that way:
//   - release (AIT_DEBUG_BUILD unset -> __DEBUG_BUILD__ false): the `/auto`
//     graph (attach injection, status banner, SDK bridge) must DCE to 0 bytes.
//   - debug (AIT_DEBUG_BUILD=1 -> true): the graph must survive (positive
//     control).
//
// Like main.ts this resolves against the built dist/ of the sibling
// @apps-in-toss/debugger-client package, so it is exercised only by the real
// `vite build` the check script runs, not by the static typecheck sweep.
if (__DEBUG_BUILD__) {
  void import('@apps-in-toss/debugger-client/auto');
}
