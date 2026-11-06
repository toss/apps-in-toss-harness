// @ts-check
/**
 * pnpm-lock.yaml(lockfileVersion 9)에서 한 workspace 패키지의 "런타임(dependencies) 폐포"를
 * 읽어내는 최소 파서.
 *
 * 루트에 yaml 의존성을 추가하면 pnpm-lock.yaml이 바뀌고(사내망 프록시가 tarball URL을
 * 박는 사고 위험), 이 스크립트가 필요한 건 lockfile의 일부 섹션(importers·packages·snapshots)
 * 뿐이라 들여쓰기 기반의 작은 파서로 대신한다. 모르는 모양이 나오면 조용히 넘어가지 않고 던진다.
 */
import { readFileSync } from 'node:fs';

/** @typedef {{ [key: string]: string | Tree }} Tree */

function unquote(s) {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

/** `key: value` 한 줄에서 key와 나머지를 나눈다(키가 따옴표로 감싸진 경우 포함). */
function splitKey(text) {
  const quoted = text.match(/^('(?:[^']|'')*'|"[^"]*"):(?:\s+(.*))?$/);
  if (quoted) return [unquote(quoted[1]), quoted[2] ?? ''];
  const plain = text.match(/^([^\s:][^:]*?):(?:\s+(.*))?$/);
  if (plain) return [plain[1], plain[2] ?? ''];
  throw new Error(`pnpm-lock parser: cannot read line "${text}"`);
}

/**
 * 들여쓰기 mapping을 중첩 객체로 만든다. `- item` 리스트 줄은 무시한다(필요한 값이 아님).
 * flow 값(`{...}`, `[...]`)은 원문 문자열 그대로 둔다.
 * @param {string[]} lines 한 섹션의 줄(공백 줄 제외)
 * @returns {Tree}
 */
function parseBlock(lines) {
  /** @type {Tree} */
  const root = {};
  /** @type {Array<{ indent: number, node: Tree }>} */
  const stack = [{ indent: -1, node: root }];
  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.startsWith('- ') || text === '-') continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const [key, rest] = splitKey(text);
    if (rest === '') {
      /** @type {Tree} */
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = unquote(rest);
    }
  }
  return root;
}

/**
 * lockfile 마지막 문서(앞 문서는 pnpm 환경 lockfile)에서 최상위 섹션을 파싱한다.
 * @param {string} text
 * @returns {{ importers: Tree, packages: Tree, snapshots: Tree }}
 */
export function parsePnpmLock(text) {
  const docs = text.split(/^---$/m);
  const body = docs[docs.length - 1].split('\n');
  /** @type {Record<string, string[]>} */
  const sections = {};
  let current = null;
  for (const line of body) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      const m = line.match(/^([A-Za-z]+):\s*$/);
      current = m ? m[1] : null;
      if (current) sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  for (const name of ['importers', 'packages', 'snapshots']) {
    if (!sections[name]) throw new Error(`pnpm-lock parser: section "${name}" not found`);
  }
  return {
    importers: parseBlock(sections.importers),
    packages: parseBlock(sections.packages),
    snapshots: parseBlock(sections.snapshots),
  };
}

/** `name@version(peer...)` 키를 [name, version(peer 제거)]로 나눈다. */
export function splitKeyVersion(key) {
  const base = key.replace(/\(.*$/, '');
  const at = base.lastIndexOf('@');
  if (at <= 0) throw new Error(`bad package key: ${key}`);
  return [base.slice(0, at), base.slice(at + 1)];
}

const asTree = (v) => (v && typeof v === 'object' ? v : {});

/**
 * @typedef {object} ClosureNode
 * @property {string} key snapshots 키(peer 접미사 포함)
 * @property {string} name
 * @property {string} version
 * @property {string} integrity
 * @property {Record<string, string>} edges 이 snapshot이 가리키는 의존성 이름 → snapshots 키
 * @property {Set<string>} optionalEdges edges 중 optionalDependencies에서 온 이름
 */

/**
 * importer의 `dependencies`에서 출발하는 런타임 폐포를 모은다(dependencies·optionalDependencies만
 * 따라간다 — devDependencies와 peer 후보는 제외).
 * @param {ReturnType<typeof parsePnpmLock>} lock
 * @param {string} importerPath 예: packages/debugger
 * @returns {{ roots: Record<string, string>, nodes: Map<string, ClosureNode> }}
 */
export function runtimeClosure(lock, importerPath) {
  const importer = asTree(lock.importers[importerPath]);
  if (!Object.keys(importer).length) throw new Error(`importer not found: ${importerPath}`);
  /** @type {Record<string, string>} */
  const roots = {};
  for (const [name, entry] of Object.entries(asTree(importer.dependencies))) {
    const version = asTree(entry).version;
    if (typeof version !== 'string') throw new Error(`importer dependency without version: ${name}`);
    roots[name] = `${name}@${version}`;
  }
  /** @type {Map<string, ClosureNode>} */
  const nodes = new Map();
  const queue = Object.values(roots);
  while (queue.length) {
    const key = /** @type {string} */ (queue.pop());
    if (nodes.has(key)) continue;
    const snap = lock.snapshots[key];
    if (!snap) throw new Error(`snapshot not found for ${key}`);
    const [name, version] = splitKeyVersion(key);
    const pkg = asTree(lock.packages[`${name}@${version}`]);
    const resolution = pkg.resolution;
    const integrity = typeof resolution === 'string' ? resolution.match(/integrity:\s*([^,}\s]+)/)?.[1] : undefined;
    if (!integrity) throw new Error(`no integrity for ${name}@${version}`);
    if (typeof resolution === 'string' && /tarball:/.test(resolution)) {
      throw new Error(`${name}@${version} has a tarball URL in the lockfile`);
    }
    /** @type {Record<string, string>} */
    const edges = {};
    /** @type {Set<string>} */
    const optionalEdges = new Set();
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dep, ver] of Object.entries(asTree(asTree(snap)[field]))) {
        // `npm:other@1.0.0` 별칭 형태는 이 폐포에 없어야 한다(있으면 파서를 확장해야 한다).
        if (typeof ver !== 'string' || ver.startsWith('npm:') || ver.startsWith('link:')) {
          throw new Error(`unsupported dependency spec ${dep}: ${String(ver)} in ${key}`);
        }
        edges[dep] = `${dep}@${ver}`;
        if (field === 'optionalDependencies') optionalEdges.add(dep);
        queue.push(`${dep}@${ver}`);
      }
    }
    nodes.set(key, { key, name, version, integrity, edges, optionalEdges });
  }
  return { roots, nodes };
}

export function readPnpmLock(file) {
  return parsePnpmLock(readFileSync(file, 'utf8'));
}
