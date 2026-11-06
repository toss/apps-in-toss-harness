#!/usr/bin/env bash
# Build-time absence guard for the in-app debug surface (issue #647).
#
# The in-app debug surface — Chii target.js injection AND the on-phone status
# banner it drives — must be PHYSICALLY ABSENT (zero bytes) from a release
# consumer bundle, not merely gated at runtime. A consumer guards its
# `import('@apps-in-toss/debug-console')` with `if (__DEBUG_BUILD__) { … }`; a
# release build defines `__DEBUG_BUILD__: false`, and the bundler
# dead-code-eliminates the whole in-app graph. This script is the mechanical
# proof of that, plus a check that the status banner never leaks into the MCP
# daemon bundles.
#
# Five checks (2 and 3 run once per entry fixture: `maybeAttach` and `/auto`):
#   1. MCP daemon bundles (dist/mcp/*.js) contain no status-banner host id —
#      those run via `npx -p @ait-co/debugger debugger` and must never pull the
#      browser-side banner into the install/runtime graph (mirrors
#      check-mcp-react-free.sh). The daemon may legitimately READ the
#      `window.__ait_debug_status` enum over CDP, so check 1 greps only the
#      banner's DOM host id, which the daemon has no reason to name.
#   2. RELEASE fixture build (AIT_DEBUG_BUILD unset, NODE_ENV=production,
#      minify ON) contains no debug-surface sentinels — proves DCE works.
#   3. POSITIVE CONTROL: DEBUG fixture build (AIT_DEBUG_BUILD=1) DOES contain
#      them — proves the toggle is alive (guards against a dead grep that would
#      pass even if the build guard silently stopped including anything).
#   4. DRIFT GUARD (G9/G12): the source fixture (scripts/debug-absence-fixture/main.ts)
#      and the inject skill's recommended-pattern doc
#      (../agent-plugin/shared/skills/inject/references/debug-console.md, "방식 B")
#      must both still carry the `__DEBUG_BUILD__` build-gate markers this whole
#      script is built around. This is a shallow textual check, not a build —
#      it exists so an edit to either file that silently drops the pattern (and
#      would make checks 2/3 above meaningless or the skill's guidance stale)
#      fails loudly instead of quietly drifting.
#   5. `/auto` DRIFT GUARD: scripts/debug-absence-fixture/auto-main.ts must still
#      guard `import('@apps-in-toss/debug-console/auto')` with `__DEBUG_BUILD__`.
#
# The `/auto` entry (`@apps-in-toss/debug-console/auto`) is a runtime self-gate:
# imported unguarded it stays in a release bundle as a dormant chunk. Checks 2/3
# therefore also build scripts/debug-absence-fixture/auto-main.ts, which imports
# it behind the same `if (__DEBUG_BUILD__)` guard, and require that the guarded
# import leaves 0 bytes of the surface in release and the full surface in debug.
#
# The fixtures used for checks 2/3 are the dedicated minimal release consumers in
# scripts/debug-absence-fixture/ — NOT the e2e panel fixture. The panel fixture
# aliases @apps-in-toss/web-framework back at the mock (a self-referential
# alias) and keeps a live dynamic in-app import for chunking reasons; DCE-ing
# that import there duplicates the mock graph. The minimal fixture isolates the
# only thing under test: the if(__DEBUG_BUILD__) guard on a real consumer's
# dynamic in-app import.
#
# IMPORTANT: the release build MUST be minified. With minify off, a dead
# `if(false){ … }` husk survives as text and its identifier strings (e.g.
# `__ait_debug_status`) match the grep — a false positive. Vite production
# builds minify by default; do not pass --minify=false here.
set -euo pipefail

cd "$(dirname "$0")/.."

# Sentinels that mark the in-app debug surface. `__ait_debug_status` (the
# status-enum global) and `__ait_status_banner` (the banner's DOM host id) are
# string literals, so they survive minification and cover the status banner; the
# others are unique identifiers from the Chii injection path that survive into a
# bundle only if the in-app graph was included.
# `__sdkCall` is the SDK bridge `startDebugConsole` installs once an attach was
# accepted; it is a string literal, so it survives minification.
# `startDebugConsole` is the consumer-side wiring call (a property name, so it
# survives minification) and `ait-attach` is the attach script's marker; neither
# may remain in a release bundle.
PATTERN="__ait_debug_status|__ait_status_banner|deriveTargetScriptUrl|installRelayWsObserver|maybeAttach|__sdkCall|startDebugConsole|ait-attach"
# The `/auto` entry installs the SDK bridge globals too (`__sdk` and `__sdkCall`).
AUTO_PATTERN="$PATTERN|__sdk"
# What check 1 greps in the daemon bundles: the banner's DOM host id only.
DAEMON_PATTERN="__ait_status_banner"

FIXTURE_CONFIG="scripts/debug-absence-fixture/vite.config.ts"
OUT_DIR="scripts/debug-absence-fixture/dist/assets"

fail=0

# ── Check 1: MCP daemon bundles are status-banner-free ───────────────────────
DAEMON_BUNDLES=("dist/mcp/cli.js" "dist/mcp/server.js")
for bundle in "${DAEMON_BUNDLES[@]}"; do
  if [[ ! -f "$bundle" ]]; then
    echo "✗ $bundle missing — run 'pnpm build' first" >&2
    fail=1
    continue
  fi
  if grep -qE "$DAEMON_PATTERN" "$bundle"; then
    echo "✗ INSTALL-GRAPH VIOLATION: $bundle references the status banner" >&2
    echo "  The MCP daemon must never import the on-phone debug-console surface." >&2
    fail=1
  else
    echo "✓ $bundle is status-banner-free"
  fi
done

# ── Checks 2 and 3, once per entry fixture ───────────────────────────────────
# $1 label, $2 AIT_ABSENCE_ENTRY value (attach|auto), $3 sentinel pattern.
check_entry() {
  local label="$1" entry="$2" pattern="$3"

  # Check 2: RELEASE build has zero debug surface.
  echo "› [$label] Building fixture in RELEASE mode (AIT_DEBUG_BUILD unset, minified)…"
  rm -rf "$OUT_DIR"
  if ! AIT_ABSENCE_ENTRY="$entry" NODE_ENV=production pnpm exec vite build --config "$FIXTURE_CONFIG" >/dev/null 2>&1; then
    echo "✗ [$label] release fixture build failed" >&2
    fail=1
    return
  fi
  if grep -rlE "$pattern" "$OUT_DIR" >/dev/null 2>&1; then
    echo "✗ DEBUG-SURFACE LEAK [$label]: release bundle contains debug-surface code" >&2
    echo "  Files:" >&2
    grep -rlE "$pattern" "$OUT_DIR" | sed 's/^/    /' >&2
    echo "  The in-app graph (Chii injection + status banner) must DCE in release builds." >&2
    echo "  Check the consumer's if(__DEBUG_BUILD__) guard and the define." >&2
    fail=1
  else
    echo "✓ [$label] release fixture bundle is debug-surface-free (0 bytes)"
  fi

  # Check 3: POSITIVE CONTROL — debug build DOES contain the surface.
  echo "› [$label] Building fixture in DEBUG mode (AIT_DEBUG_BUILD=1) for positive control…"
  rm -rf "$OUT_DIR"
  if ! AIT_ABSENCE_ENTRY="$entry" AIT_DEBUG_BUILD=1 NODE_ENV=production pnpm exec vite build --config "$FIXTURE_CONFIG" >/dev/null 2>&1; then
    echo "✗ [$label] debug fixture build failed" >&2
    fail=1
    return
  fi
  if grep -rlE "$pattern" "$OUT_DIR" >/dev/null 2>&1; then
    echo "✓ [$label] debug fixture bundle contains the debug surface (toggle is alive)"
  else
    echo "✗ POSITIVE-CONTROL FAILURE [$label]: debug build has NO debug surface" >&2
    echo "  The __DEBUG_BUILD__ toggle appears dead — the release check above is" >&2
    echo "  meaningless if the debug build also excludes everything." >&2
    fail=1
  fi
}

check_entry "maybeAttach" "attach" "$PATTERN"
check_entry "/auto" "auto" "$AUTO_PATTERN"

# Leave the tree in the default (release) state.
rm -rf "$OUT_DIR"

# ── Check 4: drift guard — fixture and skill doc still carry the markers ──────
FIXTURE_SRC="scripts/debug-absence-fixture/main.ts"
SKILL_DOC="../agent-plugin/shared/skills/inject/references/debug-console.md"
DRIFT_MARKERS=('__DEBUG_BUILD__' 'm.startDebugConsole(' "import('@apps-in-toss/debug-console')")

for f in "$FIXTURE_SRC" "$SKILL_DOC"; do
  if [[ ! -f "$f" ]]; then
    echo "✗ DRIFT GUARD: $f is missing" >&2
    fail=1
    continue
  fi
  missing=()
  for marker in "${DRIFT_MARKERS[@]}"; do
    if ! grep -qF "$marker" "$f"; then
      missing+=("$marker")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "✗ DRIFT GUARD: $f is missing marker(s): ${missing[*]}" >&2
    echo "  This file is expected to document/exercise the __DEBUG_BUILD__" >&2
    echo "  build-gate pattern (\`if (__DEBUG_BUILD__) { import('@apps-in-toss/debug-console').then((m) => m.startDebugConsole({ relayPublicKeys })) }\`)." >&2
    fail=1
  else
    echo "✓ $f carries the __DEBUG_BUILD__ build-gate markers"
  fi
done

# ── Check 5: drift guard — the /auto fixture still guards the /auto import ────
AUTO_FIXTURE_SRC="scripts/debug-absence-fixture/auto-main.ts"
AUTO_MARKERS=('__DEBUG_BUILD__' "import('@apps-in-toss/debug-console/auto')")
if [[ ! -f "$AUTO_FIXTURE_SRC" ]]; then
  echo "✗ DRIFT GUARD: $AUTO_FIXTURE_SRC is missing" >&2
  fail=1
else
  missing=()
  for marker in "${AUTO_MARKERS[@]}"; do
    if ! grep -qF "$marker" "$AUTO_FIXTURE_SRC"; then
      missing+=("$marker")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "✗ DRIFT GUARD: $AUTO_FIXTURE_SRC is missing marker(s): ${missing[*]}" >&2
    fail=1
  else
    echo "✓ $AUTO_FIXTURE_SRC guards the /auto import with __DEBUG_BUILD__"
  fi
fi

exit "$fail"
