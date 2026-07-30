import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// `__VERSION__` is substituted as a BARE IDENTIFIER (never `globalThis.
// __VERSION__` — `define` only rewrites the bare token, and a property access
// would silently read `undefined`). It is the device half of the attach version
// handshake: `attach.ts` reports it to the relay so the daemon can name a
// device↔host skew. Keep this define and `@ait-co/debugger`'s in lockstep —
// they are released as a Changesets `fixed` pair.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
};

// `@apps-in-toss/web-framework` is a type-only devDependency here, reached
// exclusively through a runtime `import()` probe (src/sdk-probe.ts). Marking it
// external stops Rolldown from inlining the SDK into this bundle: the package
// must keep shipping with `eruda` as its only dependency and no peers at all,
// which is precisely what makes "what can end up in a production bundle?"
// answerable from one package.json.
const external = ['@apps-in-toss/web-framework'];

// This package is the only one in the split that can enter a consumer's
// production bundle (see CLAUDE.md invariants), so — like @ait-co/polyfill —
// it ships dual ESM + CJS so `require('@ait-co/debug-console/auto')` works
// under CommonJS bundlers/hosts too.
// `package.json` exports expect `.js` (ESM) and `.cjs` (CJS) extensions, so
// override tsdown's default `.mjs` / `.cjs` mapping under `"type": "module"`.
const outExtensions: Options['outExtensions'] = ({ format }) => {
  if (format === 'cjs') return { js: '.cjs', dts: '.d.cts' };
  return { js: '.js', dts: '.d.ts' };
};

const common = {
  // `eager` runs declaration emit through tsc instead of the isolated-
  // declarations fast path. `gate.ts` and `bridge-observer.ts` re-export
  // symbols that originate in `@ait-co/internal-protocol`, whose entries are
  // raw `.ts` files; the fast path cannot emit across that boundary (it warns
  // "Failed to emit declaration file") and silently drops the re-export lines,
  // after which the rollup fails on every symbol `index.ts` forwards through
  // them. With `eager` the declarations are inlined into `dist/*.d.ts`, which
  // is the required outcome anyway: the protocol package is private and never
  // published, so nothing we ship may name it.
  dts: { eager: true },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outExtensions,
  define,
  external,
} as const;

export default defineConfig([
  {
    ...common,
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
  },
  {
    ...common,
    // Side-effect entry: `import '@ait-co/debug-console/auto'` attaches the
    // on-device console without the consumer wiring `attach()` themselves.
    entry: { auto: 'src/auto.ts' },
    format: ['esm', 'cjs'],
  },
]);
