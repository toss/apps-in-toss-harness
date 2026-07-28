import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// __VERSION__ replaced in source at build time so `VERSION` reflects the real
// package.json value without an import hack.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
};

// `package.json` uses `"type": "module"` and its exports expect `.js` for ESM.
const outExtensions: Options['outExtensions'] = ({ format }) => {
  if (format === 'cjs') return { js: '.cjs', dts: '.d.cts' };
  return { js: '.js', dts: '.d.ts' };
};

const common = {
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outExtensions,
  define,
} as const;

// Each entry is its own config so tsdown/Rolldown does not emit a shared hashed
// chunk at `dist/` root — every entry point stands alone.
//
// Caveat: because `detect` ships both as its own entry AND inlined into `index`
// (which re-exports from it), a consumer that imports from both entry points
// gets two module instances. The detection cache is module-local, so calling
// `resetDetection()` from one entry does not affect the other. This is fine in
// practice (consumers pick one entry), but documented here so it's not a
// surprise if it ever matters.
// Both `esm` and `cjs` are emitted from each entry: ESM stays the primary
// format (sources are ESM, `package.json` is `"type": "module"`) and CJS is
// added so consumers stuck on `require()` (older toolchains, Codex/CommonJS
// hosts, devtools unplugin injecting into CJS host bundles) can also load the
// package. `outExtensions` disambiguates with `.js`/`.cjs` so Node's format
// detection works without per-format `package.json` shims.
const formats = ['esm', 'cjs'] as const;

export default defineConfig([
  {
    ...common,
    entry: { index: 'src/index.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/clipboard': 'src/shims/clipboard.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/geolocation': 'src/shims/geolocation.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/share': 'src/shims/share.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/vibrate': 'src/shims/vibrate.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/vibrate-semantic': 'src/shims/vibrate-semantic.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/network': 'src/shims/network.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { 'shims/window-open': 'src/shims/window-open.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { detect: 'src/detect.ts' },
    format: formats,
  },
  {
    ...common,
    entry: { auto: 'src/auto.ts' },
    format: formats,
  },
]);
