import { createRequire } from 'node:module';
import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// `@modelcontextprotocol/sdk` exposes NEITHER `.` (the bare main entry) NOR
// `./package.json` in its `exports` map, so both
// `require.resolve('@modelcontextprotocol/sdk')` and
// `require.resolve('@modelcontextprotocol/sdk/package.json')` throw at BUILD
// time. Resolve a subpath that IS in the exports map (`./server/mcp.js`), walk
// back to the package root via the marker, and read its `package.json` by file
// path (bypassing the `exports` gate). Falls back to `null` if the resolution
// shape ever changes.
const mcpSdkVersion = ((): string | null => {
  try {
    const req = createRequire(import.meta.url);
    const entry = req.resolve('@modelcontextprotocol/sdk/server/mcp.js');
    const marker = '@modelcontextprotocol/sdk';
    const root = entry.slice(0, entry.indexOf(marker) + marker.length);
    const sdkPkg = req(`${root}/package.json`) as { version?: unknown };
    return typeof sdkPkg.version === 'string' ? sdkPkg.version : null;
  } catch {
    return null;
  }
})();

// Both constants are substituted as BARE IDENTIFIERS (never
// `globalThis.__VERSION__` — `define` only rewrites the bare token, and a
// property access would silently read `undefined`). `__VERSION__` is the host
// half of the attach version handshake: the daemon compares it with the version
// the device reports on `/ait-attach`. Keep it in lockstep with
// `@ait-co/debug-console`'s define — they are a Changesets `fixed` pair.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
  __MCP_SDK_VERSION__: JSON.stringify(mcpSdkVersion),
};

// This package is devDependency / npx tooling only — every consumer runs on
// Node 24, so it ships ESM-only. (Contrast @ait-co/debug-console, which can
// land inside a consumer's app bundle and therefore ships dual ESM + CJS.)
//
// `package.json` exports/bin expect a `.js` extension, but tsdown's default
// ESM output extension is `.mjs` regardless of the package's own
// `"type": "module"` — override it explicitly (same fix as debug-console's
// tsdown.config.ts).
const outExtensions: Options['outExtensions'] = () => ({ js: '.js', dts: '.d.ts' });

// `src/test-runner/pool.ts` takes its `PoolOptions` / `TestProject` / …
// shapes from `vitest/node` as a TYPE-ONLY import: the custom pool is handed to
// the consumer's own Vitest, which supplies the runtime. tsdown externalizes
// `dependencies` + `peerDependencies` automatically, and vitest is neither
// here — it is a devDependency — so without this the declaration rollup tries
// to inline Vitest's public types and, through them, all of vite's and
// postcss's, and dies on ~125 unresolved re-exports. The emitted `.d.ts` should
// simply point at `vitest/node`, which is what every consumer already has.
const external = ['vitest', 'vitest/node'];

const common = {
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  platform: 'node',
  format: ['esm'],
  outExtensions,
  define,
  external,
} as const;

// Each entry lives in its own config object, mirroring devtools'
// tsdown.config.ts (self-contained per-entry so Rolldown does not emit a
// shared hashed chunk at dist/ root for the single-file bins).
export default defineConfig([
  {
    ...common,
    entry: { 'mcp/server': 'src/mcp/server.ts' },
    // Banner is the single source of the shebang — src/mcp/server.ts must
    // not carry its own `#!/usr/bin/env node`, or the build emits a doubled
    // shebang and the file fails to parse.
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    entry: { 'mcp/cli': 'src/mcp/cli.ts' },
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    // test-runner Node-side public API + helpers, mirroring devtools'
    // tsdown.config.ts entry group. `runtime`/`bridge-stub`/`method-pace` are
    // resolved at runtime via an absolute filesystem path (getRuntimePath /
    // getBridgeStubPath / getMethodPacePath in bundle.ts) rather than a
    // package subpath specifier — they MUST be emitted as their own dist/
    // files, or check:test-runner-dist fails (devtools#676/#697/#740/#769).
    // `capture`/`report` are deliberately react-free, heavy-graph-free leaf
    // modules (devtools#696) kept in this esbuild-only entry group.
    entry: {
      'test-runner/config': 'src/test-runner/config.ts',
      'test-runner/bundle': 'src/test-runner/bundle.ts',
      'test-runner/runtime': 'src/test-runner/runtime.ts',
      'test-runner/bridge-stub': 'src/test-runner/bridge-stub.ts',
      'test-runner/method-pace': 'src/test-runner/method-pace.ts',
      'test-runner/rpc': 'src/test-runner/rpc.ts',
      'test-runner/relay-worker': 'src/test-runner/relay-worker.ts',
      'test-runner/pool': 'src/test-runner/pool.ts',
      'test-runner/task-graph': 'src/test-runner/task-graph.ts',
      'test-runner/capture': 'src/test-runner/capture.ts',
      'test-runner/report': 'src/test-runner/report.ts',
    },
  },
  {
    ...common,
    // devtools#696: relay-factory is the shared env3 attach assembly. Its
    // heavy graph (debug-server -> chii/cloudflared/ws; cell ->
    // attach-orchestrator -> tools) is reached ONLY via dynamic import inside
    // `open()` — kept as its own entry so a static react/heavy-graph leak is
    // attributable to this one bundle (check:debug-surface-absent's #696
    // check greps this exact file).
    entry: { 'test-runner/relay-factory': 'src/test-runner/relay-factory.ts' },
  },
  {
    ...common,
    // Export-free bin entry — see src/test-runner/bin.ts for why it must
    // stay export-free (devtools issue #711: Rolldown shared-chunk hoisting
    // otherwise defeats the self-invoke guard silently).
    entry: { 'test-runner/bin': 'src/test-runner/bin.ts' },
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    entry: { 'dev-bridge/index': 'src/dev-bridge/index.ts' },
  },
]);
