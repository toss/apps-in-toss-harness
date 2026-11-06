#!/usr/bin/env node
// Dist-level gate check: runs `evaluateDebugGate` from the BUILT ESM and CJS
// entries over a short table and exits non-zero on any mismatch or when dist is
// missing. The unit tables test the source; this proves the shipped artifact
// decides the same way (a bundler or define change cannot silently loosen it).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esmPath = join(root, 'dist', 'index.js');
const cjsPath = join(root, 'dist', 'index.cjs');

for (const p of [esmPath, cjsPath]) {
  if (!existsSync(p)) {
    console.error(`check-gate-dist: missing ${p} (run the build first)`);
    process.exit(1);
  }
}

/** Well-formed v2 `sig` shape (session key, window, cert and link signatures); never verifies. */
const SIG = `${'A'.repeat(8)}.${'A'.repeat(86)}`;
const AT = '0123456789abcdef0123456789abcdef';
const RELAY = 'wss://abc.trycloudflare.com';
const query = ({ relay = RELAY, at = AT, sig = SIG } = {}) => {
  const q = new URLSearchParams({ debug: '1' });
  if (relay !== null) q.set('relay', relay);
  if (at !== null) q.set('at', at);
  if (sig !== null) q.set('sig', sig);
  return q;
};

const TABLE = [
  {
    name: 'control: QR test host, signed',
    host: 'demo.private-apps.tossmini.com',
    q: query(),
    want: 'attach',
  },
  {
    name: 'control: QR test web host, signed',
    host: 'demo.private-web.tossmini.com',
    q: query(),
    want: 'attach',
  },
  {
    name: 'control: loopback page, loopback relay',
    host: 'localhost',
    q: query({ relay: 'wss://127.0.0.1:8443', sig: null }),
    want: 'attach',
  },
  {
    name: 'production apps host refused',
    host: 'demo.apps.tossmini.com',
    q: query(),
    want: 'host',
  },
  { name: 'production web host refused', host: 'demo.web.tossmini.com', q: query(), want: 'host' },
  {
    name: 'multi-label QR prefix refused',
    host: 'a.b.private-apps.tossmini.com',
    q: query(),
    want: 'host',
  },
  {
    name: 'look-alike host refused',
    host: 'demo.private-apps.tossmini.com.example.org',
    q: query(),
    want: 'host',
  },
  {
    name: 'unsigned QR test host refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({ sig: null }),
    want: 'relay-signature',
  },
  {
    name: 'retired single-signature sig refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({ sig: 'S'.repeat(86) }),
    want: 'relay-signature',
  },
  {
    name: 'retired self-contained certificate sig refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({
      sig: `BA${'A'.repeat(85)}.1800000000.1800001200.${'A'.repeat(86)}.${'A'.repeat(86)}`,
    }),
    want: 'relay-signature',
  },
  {
    name: 'QR test host without code refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({ at: null }),
    want: 'auth',
  },
  {
    name: 'loopback relay on a QR test host refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({ relay: 'wss://127.0.0.1:8443' }),
    want: 'invalid-relay',
  },
  {
    name: 'tunnel relay with a port refused',
    host: 'demo.private-apps.tossmini.com',
    q: query({ relay: 'wss://abc.trycloudflare.com:8443' }),
    want: 'invalid-relay',
  },
];

// The relay secret never enters a bundle (the relay signing key derives from it). The page
// holds public keys only, so dist must carry neither the baked-secret define nor a
// device-side code verifier. Every file under dist is scanned, source maps included.
const FORBIDDEN_NAMES = ['__DEBUG_TOTP_SECRET__', 'verifyTotpCode', 'verifyTotp'];
let forbiddenHits = 0;
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(full);
      continue;
    }
    const text = readFileSync(full, 'utf8');
    for (const name of FORBIDDEN_NAMES) {
      if (text.includes(name)) {
        console.error(`FAIL dist: ${full.slice(root.length + 1)} contains ${name}`);
        forbiddenHits++;
      }
    }
  }
};
scan(join(root, 'dist'));

const require = createRequire(import.meta.url);
const entries = [
  ['esm', await import(pathToFileURL(esmPath).href)],
  ['cjs', require(cjsPath)],
];

let failures = forbiddenHits;
for (const [label, mod] of entries) {
  if (typeof mod.evaluateDebugGate !== 'function') {
    console.error(`FAIL ${label}: evaluateDebugGate is not exported`);
    failures++;
    continue;
  }
  for (const row of TABLE) {
    const r = mod.evaluateDebugGate({ hostname: row.host, searchParams: row.q });
    const got = r.attach ? 'attach' : r.reason;
    if (got !== row.want) {
      console.error(`FAIL ${label}: ${row.name}: want ${row.want}, got ${got}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`check-gate-dist: ${failures} mismatch(es)`);
  process.exit(1);
}
console.log(
  `check-gate-dist: ok (${TABLE.length} rows x ${entries.length} entries, no baked-secret names in dist)`,
);
