#!/usr/bin/env node
// @ts-check
/**
 * npm-shrinkwrap.json 생성·검증 (발행 패키지의 런타임 의존성 폐포 고정).
 *
 * 왜 필요한가: 사용자는 GitHub Release tarball URL로 설치한다(`npx -y -p <URL> debugger`,
 * `npm install -D <URL>`). npm·npx는 우리 pnpm-lock.yaml을 읽지 않으므로 tarball의
 * `dependencies`가 사용자 머신에서 그때그때 새로 해석된다. 발행 tarball 안에
 * `npm-shrinkwrap.json`이 있으면 npm이 그 트리를 그대로 설치한다(sha512 integrity 검증 포함).
 *
 * 이 파일은 pnpm-lock.yaml의 런타임 폐포(= CI가 테스트하는 바로 그 버전들, overrides 반영분
 * 포함)에서 결정적으로 만든다. npm resolver를 거치지 않으므로 생성 시점에 따라 결과가 달라지지
 * 않는다. 네트워크는 각 패키지 manifest(의존성 범위·bin·os/cpu 등 메타데이터)를 가져오는 데만
 * 쓰고, 받은 manifest의 dist.integrity가 pnpm-lock의 integrity와 다르면 실패한다(사내 프록시가
 * 같은 버전을 다른 바이트로 내려주는 사고 방지 — CLAUDE.md integrity quirk).
 *
 * 사용법:
 *   node scripts/shrinkwrap.mjs generate packages/debugger   # 재생성(네트워크 필요)
 *   node scripts/shrinkwrap.mjs check packages/debugger      # 오프라인 검증(CI)
 * 사내망에서 generate는 `npm_config_registry=https://registry.npmmirror.com/`를 준다. 결과의
 * `resolved`는 항상 https://registry.npmjs.org/ 로 쓴다.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPnpmLock, runtimeClosure } from './lib/pnpm-lock.mjs';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
export const SHRINKWRAP_FILE = 'npm-shrinkwrap.json';
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** @param {string} name */
const nodeModulesPath = (name) => `node_modules/${name}`;

/**
 * 폐포를 npm 레이아웃(node_modules 경로)으로 배치한다. 가능하면 루트로 끌어올리고, 같은 이름의
 * 다른 버전이 이미 가까이 있으면 요구하는 쪽 아래에 중첩한다. 마지막에 Node 해석 규칙으로 모든
 * 의존성이 의도한 버전으로 풀리는지 전수 검증한다.
 * @param {ReturnType<typeof runtimeClosure>} closure
 * @returns {Map<string, import('./lib/pnpm-lock.mjs').ClosureNode>} 경로 → 노드
 */
export function layoutTree(closure) {
  const baseOf = (/** @type {{name:string,version:string}} */ n) => `${n.name}@${n.version}`;
  /** @type {Map<string, import('./lib/pnpm-lock.mjs').ClosureNode>} */
  const byBase = new Map();
  for (const node of closure.nodes.values()) {
    const first = byBase.get(baseOf(node));
    if (!first) {
      byBase.set(baseOf(node), node);
      continue;
    }
    // peer 접미사만 다른 snapshot은 같은 노드로 합친다. 가리키는 대상이 다르면 합칠 수 없다.
    const edgeBases = (/** @type {typeof node} */ n) =>
      JSON.stringify(Object.entries(n.edges).map(([d, k]) => [d, k.replace(/\(.*$/, '')]).sort());
    if (edgeBases(first) !== edgeBases(node)) {
      throw new Error(`peer variants of ${baseOf(node)} resolve different dependencies`);
    }
  }

  /** @type {Map<string, import('./lib/pnpm-lock.mjs').ClosureNode>} */
  const placed = new Map();
  /** @param {string} from @param {string} name */
  const lookup = (from, name) => {
    let loc = from;
    for (;;) {
      const p = loc ? `${loc}/${nodeModulesPath(name)}` : nodeModulesPath(name);
      if (placed.has(p)) return p;
      if (!loc) return null;
      const cut = loc.lastIndexOf('/node_modules/');
      loc = cut === -1 ? '' : loc.slice(0, cut);
    }
  };

  /** @type {Array<{ from: string, name: string, base: string }>} */
  const queue = Object.entries(closure.roots).map(([name, key]) => ({
    from: '',
    name,
    base: key.replace(/\(.*$/, ''),
  }));
  while (queue.length) {
    const job = /** @type {(typeof queue)[number]} */ (queue.shift());
    const node = /** @type {import('./lib/pnpm-lock.mjs').ClosureNode} */ (byBase.get(job.base));
    const found = lookup(job.from, job.name);
    if (found && baseOf(/** @type {any} */ (placed.get(found))) === job.base) continue;
    const slot = found ? `${job.from}/${nodeModulesPath(job.name)}` : nodeModulesPath(job.name);
    if (placed.has(slot)) throw new Error(`cannot place ${job.base}: ${slot} is taken`);
    placed.set(slot, node);
    for (const [dep, key] of Object.entries(node.edges)) {
      queue.push({ from: slot, name: dep, base: key.replace(/\(.*$/, '') });
    }
  }

  for (const [p, node] of placed) {
    for (const [dep, key] of Object.entries(node.edges)) {
      const at = lookup(p, dep);
      const got = at ? baseOf(/** @type {any} */ (placed.get(at))) : null;
      if (got !== key.replace(/\(.*$/, '')) {
        throw new Error(`layout error: ${p} needs ${key} for "${dep}" but resolves ${got}`);
      }
    }
  }
  return placed;
}

/** 경로의 마지막 node_modules 아래 패키지 이름. */
export const nameFromPath = (/** @type {string} */ p) => p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * @typedef {object} Manifest registry의 `<name>/<version>` 문서에서 쓰는 필드
 * @property {Record<string,string>} [dependencies]
 * @property {Record<string,string>} [optionalDependencies]
 * @property {Record<string,string>} [peerDependencies]
 * @property {Record<string,{optional?:boolean}>} [peerDependenciesMeta]
 * @property {any} [bin] @property {any} [engines] @property {string[]} [os] @property {string[]} [cpu]
 * @property {string[]} [libc] @property {any} [license] @property {any} [funding]
 * @property {any} [bundleDependencies] @property {any} [bundledDependencies]
 * @property {{ integrity?: string }} [dist]
 */

const sortObject = (/** @type {Record<string, any>} */ o) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * @param {object} args
 * @param {{ name: string, version: string, dependencies: Record<string,string>, license?: string, engines?: any, bin?: any }} args.pkg
 * @param {ReturnType<typeof runtimeClosure>} args.closure
 * @param {(name: string, version: string) => Manifest} args.manifestFor 동기 조회(미리 받아 둔 manifest)
 */
export function buildShrinkwrap({ pkg, closure, manifestFor }) {
  const placed = layoutTree(closure);

  // optional / peer 플래그: 루트에서 "일반 의존성 간선만" 따라 닿는지로 정한다.
  /** @param {(node: import('./lib/pnpm-lock.mjs').ClosureNode, dep: string, m: Manifest) => boolean} follow */
  const reach = (follow) => {
    /** @type {Set<string>} */
    const seen = new Set();
    const baseOf = (/** @type {string} */ k) => k.replace(/\(.*$/, '');
    const nodeByBase = new Map([...placed.values()].map((n) => [`${n.name}@${n.version}`, n]));
    const stack = Object.values(closure.roots).map(baseOf);
    while (stack.length) {
      const base = /** @type {string} */ (stack.pop());
      if (seen.has(base)) continue;
      seen.add(base);
      const node = /** @type {any} */ (nodeByBase.get(base));
      const m = manifestFor(node.name, node.version);
      for (const [dep, key] of Object.entries(node.edges)) {
        if (follow(node, dep, m)) stack.push(baseOf(key));
      }
    }
    return seen;
  };
  const isPeerOnly = (/** @type {Manifest} */ m, /** @type {string} */ dep) =>
    !!m.peerDependencies?.[dep] && !m.dependencies?.[dep] && !m.optionalDependencies?.[dep];
  const nonOptional = reach((node, dep, m) => !node.optionalEdges.has(dep) && !m.optionalDependencies?.[dep] && !isPeerOnly(m, dep));
  const nonPeer = reach((_n, dep, m) => !isPeerOnly(m, dep));

  /** @type {Record<string, any>} */
  const packages = {
    '': {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      dependencies: sortObject(pkg.dependencies),
      bin: pkg.bin,
      engines: pkg.engines,
    },
  };
  for (const [p, node] of placed) {
    const m = manifestFor(node.name, node.version);
    if (m.bundleDependencies || m.bundledDependencies) {
      throw new Error(`${node.name}@${node.version} bundles dependencies — not supported`);
    }
    const base = `${node.name}@${node.version}`;
    /** @param {Record<string,string>|undefined} declared */
    const pinned = (declared) => {
      if (!declared) return undefined;
      /** @type {Record<string,string>} */
      const out = {};
      for (const dep of Object.keys(declared)) {
        const key = node.edges[dep];
        // overrides·해석 결과가 선언 범위와 달라질 수 있어(npm도 lock에 적용 후 spec을 적는다)
        // 실제로 배치된 정확한 버전을 적는다. 배치되지 않은 선택 의존성은 선언 그대로 둔다.
        if (key) out[dep] = key.replace(/\(.*$/, '').slice(dep.length + 1);
        else if (node.optionalEdges.has(dep) || m.optionalDependencies?.[dep]) out[dep] = declared[dep];
        else throw new Error(`${base}: declared dependency "${dep}" is missing from pnpm-lock`);
      }
      return sortObject(out);
    };
    const optionalDeps = pinned(m.optionalDependencies);
    const deps = m.dependencies
      ? pinned(Object.fromEntries(Object.entries(m.dependencies).filter(([d]) => !m.optionalDependencies?.[d])))
      : undefined;
    const entry = {
      version: node.version,
      resolved: `${PUBLIC_REGISTRY}${node.name}/-/${node.name.split('/').pop()}-${node.version}.tgz`,
      integrity: node.integrity,
      ...(nonOptional.has(base) ? {} : { optional: true }),
      ...(nonPeer.has(base) ? {} : { peer: true }),
      license: typeof m.license === 'string' ? m.license : undefined,
      dependencies: deps && Object.keys(deps).length ? deps : undefined,
      optionalDependencies: optionalDeps && Object.keys(optionalDeps).length ? optionalDeps : undefined,
      peerDependencies: m.peerDependencies ? sortObject(m.peerDependencies) : undefined,
      peerDependenciesMeta: m.peerDependenciesMeta ? sortObject(m.peerDependenciesMeta) : undefined,
      bin: m.bin && typeof m.bin === 'object' ? sortObject(m.bin) : undefined,
      engines: m.engines && typeof m.engines === 'object' ? m.engines : undefined,
      os: m.os,
      cpu: m.cpu,
      libc: m.libc,
    };
    packages[p] = entry;
  }
  const sorted = Object.fromEntries(
    Object.entries(packages).sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a < b ? -1 : a > b ? 1 : 0)),
  );
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: sorted };
}

/**
 * 오프라인 검증. 문제 목록을 돌려준다(빈 배열이면 통과).
 * @param {object} args
 * @param {any} args.pkg 패키지 package.json
 * @param {any} args.shrinkwrap 파싱된 npm-shrinkwrap.json
 * @param {ReturnType<typeof runtimeClosure>} args.closure
 */
export function checkShrinkwrap({ pkg, shrinkwrap, closure }) {
  /** @type {string[]} */
  const problems = [];
  const deps = pkg.dependencies ?? {};
  for (const [name, range] of Object.entries(deps)) {
    if (!EXACT_VERSION.test(String(range))) {
      problems.push(`package.json dependencies.${name} is "${range}" — must be an exact version`);
    }
  }
  if (shrinkwrap.lockfileVersion !== 3) problems.push('lockfileVersion must be 3');
  const root = shrinkwrap.packages?.[''];
  if (!root) return [...problems, 'packages[""] is missing'];
  if (shrinkwrap.name !== pkg.name || root.name !== pkg.name) problems.push(`name differs from package.json (${pkg.name})`);
  if (shrinkwrap.version !== pkg.version || root.version !== pkg.version) {
    problems.push(`version differs from package.json (${pkg.version}) — regenerate`);
  }
  if (JSON.stringify(sortObject(root.dependencies ?? {})) !== JSON.stringify(sortObject(deps))) {
    problems.push('root dependencies differ from package.json dependencies — regenerate');
  }

  /** @type {Map<string, string>} name@version → integrity (shrinkwrap) */
  const have = new Map();
  for (const [p, entry] of Object.entries(shrinkwrap.packages)) {
    if (p === '') continue;
    const name = nameFromPath(p);
    if (entry.link || entry.inBundle) problems.push(`${p}: link/inBundle entries are not allowed`);
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(PUBLIC_REGISTRY)) {
      problems.push(`${p}: resolved must start with ${PUBLIC_REGISTRY} (got ${String(entry.resolved)})`);
    }
    if (typeof entry.integrity !== 'string' || !entry.integrity.startsWith('sha512-')) {
      problems.push(`${p}: integrity must be sha512`);
    }
    have.set(`${name}@${entry.version}`, entry.integrity);
  }
  /** @type {Map<string, string>} */
  const want = new Map();
  for (const node of closure.nodes.values()) want.set(`${node.name}@${node.version}`, node.integrity);
  for (const [k, integrity] of want) {
    if (!have.has(k)) problems.push(`shrinkwrap lacks ${k} (present in pnpm-lock.yaml) — regenerate`);
    else if (have.get(k) !== integrity) problems.push(`${k}: integrity differs from pnpm-lock.yaml`);
  }
  for (const k of have.keys()) {
    if (!want.has(k)) problems.push(`shrinkwrap has ${k} which is not in pnpm-lock.yaml's runtime closure — regenerate`);
  }
  return problems;
}

function loadContext(pkgDirArg) {
  const pkgDir = path.resolve(REPO_ROOT, pkgDirArg);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const importer = path.relative(REPO_ROOT, pkgDir).split(path.sep).join('/');
  const closure = runtimeClosure(readPnpmLock(path.join(REPO_ROOT, 'pnpm-lock.yaml')), importer);
  return { pkgDir, pkg, closure };
}

/** @param {string} name @param {string} version */
async function fetchManifest(registry, name, version) {
  const url = `${registry.replace(/\/?$/, '/')}${name.replace('/', '%2F')}/${version}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return /** @type {Manifest} */ (await res.json());
    } catch (err) {
      if (attempt >= 4) throw new Error(`manifest fetch failed for ${name}@${version}: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function generate(pkgDirArg) {
  const { pkgDir, pkg, closure } = loadContext(pkgDirArg);
  const registry = process.env.npm_config_registry || PUBLIC_REGISTRY;
  const wanted = [...new Map([...closure.nodes.values()].map((n) => [`${n.name}@${n.version}`, n])).values()];
  /** @type {Map<string, Manifest>} */
  const manifests = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      while (next < wanted.length) {
        const node = wanted[next++];
        const m = await fetchManifest(registry, node.name, node.version);
        if (m.dist?.integrity !== node.integrity) {
          throw new Error(
            `${node.name}@${node.version}: registry integrity (${m.dist?.integrity}) differs from pnpm-lock.yaml (${node.integrity}). ` +
              'A rewriting proxy may be serving different bytes — use the public registry or a public mirror.',
          );
        }
        manifests.set(`${node.name}@${node.version}`, m);
      }
    }),
  );
  const shrinkwrap = buildShrinkwrap({
    pkg,
    closure,
    manifestFor: (name, version) => /** @type {Manifest} */ (manifests.get(`${name}@${version}`)),
  });
  const problems = checkShrinkwrap({ pkg, shrinkwrap, closure });
  if (problems.length) throw new Error(`generated shrinkwrap is inconsistent:\n${problems.join('\n')}`);
  writeFileSync(path.join(pkgDir, SHRINKWRAP_FILE), `${JSON.stringify(shrinkwrap, null, 2)}\n`);
  console.log(`wrote ${path.relative(REPO_ROOT, path.join(pkgDir, SHRINKWRAP_FILE))} (${wanted.length} packages)`);
}

function check(pkgDirArg) {
  const { pkgDir, pkg, closure } = loadContext(pkgDirArg);
  const file = path.join(pkgDir, SHRINKWRAP_FILE);
  if (!existsSync(file)) {
    console.error(`::error::${path.relative(REPO_ROOT, file)} is missing — run: pnpm shrinkwrap:debugger`);
    process.exit(1);
  }
  const problems = checkShrinkwrap({ pkg, shrinkwrap: JSON.parse(readFileSync(file, 'utf8')), closure });
  // 구조 검증: 저장된 파일에서도 배치가 올바른지(손수정 방지) 폐포로 다시 만든 배치와 경로 집합을 대조한다.
  const expected = [...layoutTree(closure).keys()].sort();
  const actual = Object.keys(JSON.parse(readFileSync(file, 'utf8')).packages)
    .filter((p) => p !== '')
    .sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) problems.push('node_modules layout differs from the one derived from pnpm-lock.yaml — regenerate');
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    console.error('fix: pnpm shrinkwrap:debugger (public registry or public mirror; see CLAUDE.md)');
    process.exit(1);
  }
  console.log(`${path.relative(REPO_ROOT, file)}: ok (${closure.nodes.size} snapshots)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, dir] = process.argv.slice(2);
  if (!dir || (cmd !== 'generate' && cmd !== 'check')) {
    console.error('usage: node scripts/shrinkwrap.mjs <generate|check> <packages/name>');
    process.exit(2);
  }
  if (cmd === 'check') check(dir);
  else await generate(dir);
}
