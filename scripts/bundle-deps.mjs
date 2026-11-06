#!/usr/bin/env node
// @ts-check
/**
 * 발행 tarball에 런타임 의존성을 번들한다(bundleDependencies).
 *
 * 왜 번들인가: 사용자는 GitHub Release tarball URL로 설치한다(`npx -y -p <URL> debugger`,
 * `npm install -D <URL>`). 이 경로에서 npm은 tarball 안의 npm-shrinkwrap.json을 읽지 않는다
 * (실측: npm 11.19, 파일 tarball·http URL tarball 모두 shrinkwrap 무시 — shrinkwrap은 registry
 * packument의 `_hasShrinkwrap`일 때만 적용된다). 그러면 `dependencies`가 사용자 머신에서
 * 매번 새로 해석돼, pnpm-lock.yaml이 고정한 버전과 overrides(보안 패치 상향분)가 전달되지 않는다.
 * 번들된 의존성은 해석 없이 tarball에 든 그대로 풀리므로 "릴리즈 자산 하나 = 검증된 코드 전부"가 된다
 * (자산의 sha256·build provenance attestation이 의존성 코드까지 덮는다).
 *
 * 하는 일(결정적, 네트워크는 npm ci의 tarball 다운로드뿐이고 sha512 integrity가 검증한다):
 *   1. `pnpm pack` 산출 tarball을 임시 디렉터리에 푼다(npm-shrinkwrap.json 포함).
 *   2. package.json에서 devDependencies를 지우고 bundleDependencies를 넣는다. 플랫폼별 네이티브
 *      바이너리를 optionalDependencies로 가진 패키지(esbuild)는 번들하지 않고 정확 버전 의존성으로
 *      둔다 — 번들하면 빌드한 OS의 바이너리만 들어간다.
 *   3. `npm ci --omit=dev --ignore-scripts`로 shrinkwrap 그대로 node_modules를 만든다.
 *   3b. 번들된 cloudflared 패키지의 `scripts.postinstall`을 지운다. 그 훅은 설치 시점에 `latest`
 *      바이너리를 검증 없이 받는다. 번들 의존성의 install 스크립트도 소비자의 `npm install`에서
 *      돌기 때문에, 지우지 않으면 sha256 고정 바이너리 대신 그것이 먼저 깔린다. 바이너리는
 *      데몬의 lazy 검증 설치(cloudflared-binary.ts)가 공급한다.
 *   4. `npm pack`으로 다시 묶어 입력 tarball을 교체한다.
 *
 * 사용법: node scripts/bundle-deps.mjs <tarball.tgz>
 * 사내망 로컬 실행은 `npm_config_registry=https://registry.npmmirror.com/`(shrinkwrap의
 * resolved 호스트를 npm이 설정된 registry로 치환한다).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API_?KEY|AUTH|^GITHUB_|^ACTIONS_|^RUNNER_)/i;
const safeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k)));

/**
 * 번들할 직접 의존성을 고른다: 플랫폼별 바이너리(os/cpu가 붙은 optional 의존성)를 끌고 오는
 * 패키지는 제외한다.
 * @param {any} shrinkwrap
 * @param {Record<string, string>} dependencies
 * @returns {{ bundled: string[], external: string[] }}
 */
export function partitionDependencies(shrinkwrap, dependencies) {
  const bundled = [];
  const external = [];
  for (const name of Object.keys(dependencies)) {
    const entry = shrinkwrap.packages?.[`node_modules/${name}`];
    if (!entry) throw new Error(`${name} is missing from npm-shrinkwrap.json`);
    const platformOptional = Object.keys(entry.optionalDependencies ?? {}).some((dep) => {
      const o = shrinkwrap.packages?.[`node_modules/${dep}`];
      return o && (o.os || o.cpu);
    });
    (platformOptional ? external : bundled).push(name);
  }
  return { bundled, external };
}

/**
 * 번들 대상의 폐포 안에 플랫폼 한정 패키지가 없는지 확인한다(있으면 OS별로 다른 tarball이 된다).
 * @param {any} shrinkwrap
 * @param {string[]} bundled
 * @param {string[]} external
 */
export function assertPlatformNeutral(shrinkwrap, bundled, external) {
  /** @type {string[]} */
  const bad = [];
  const externalRoots = new Set(external);
  for (const [p, entry] of Object.entries(shrinkwrap.packages ?? {})) {
    if (p === '' || !(entry.os || entry.cpu)) continue;
    const name = p.slice(p.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const owner = Object.entries(shrinkwrap.packages).find(
      ([, e]) => /** @type {any} */ (e).optionalDependencies && name in /** @type {any} */ (e).optionalDependencies,
    );
    const ownerName = owner ? owner[0].slice(owner[0].lastIndexOf('node_modules/') + 'node_modules/'.length) : null;
    if (!ownerName || !externalRoots.has(ownerName)) bad.push(p);
  }
  if (bad.length) throw new Error(`platform-specific packages inside the bundled closure: ${bad.join(', ')}`);
  if (!bundled.length) throw new Error('nothing to bundle');
}

/** 설치 시점에 실행되는 npm lifecycle 훅. */
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * 번들 의존성 manifest에서 설치 시점 훅(`preinstall`·`install`·`postinstall`·`prepare`)을 지운다.
 * 바뀐 게 없으면 `false`.
 * @param {any} manifest
 * @returns {boolean}
 */
export function stripPostinstall(manifest) {
  if (!manifest.scripts) return false;
  let changed = false;
  for (const hook of INSTALL_HOOKS) {
    if (hook in manifest.scripts) {
      delete manifest.scripts[hook];
      changed = true;
    }
  }
  if (!changed) return false;
  if (Object.keys(manifest.scripts).length === 0) delete manifest.scripts;
  return true;
}

/**
 * `<pkgDir>/node_modules/cloudflared/package.json`의 postinstall을 지운다(없으면 아무것도 안 한다).
 * @param {string} pkgDir
 * @returns {boolean} 지웠으면 true
 */
export function stripCloudflaredPostinstall(pkgDir) {
  const file = path.join(pkgDir, 'node_modules', 'cloudflared', 'package.json');
  if (!existsSync(file)) return false;
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (!stripPostinstall(manifest)) return false;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], env: safeEnv(), ...opts });
}

/** @param {string} tarball */
export function bundleTarball(tarball) {
  const work = mkdtempSync(path.join(tmpdir(), 'bundle-deps-'));
  try {
    run('tar', ['-xzf', tarball, '-C', work]);
    const pkgDir = path.join(work, 'package');
    const manifestPath = path.join(pkgDir, 'package.json');
    const shrinkwrapPath = path.join(pkgDir, 'npm-shrinkwrap.json');
    if (!existsSync(shrinkwrapPath)) throw new Error('tarball has no npm-shrinkwrap.json (add it to "files")');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const shrinkwrap = JSON.parse(readFileSync(shrinkwrapPath, 'utf8'));
    if (manifest.bundleDependencies || manifest.bundledDependencies) throw new Error('already bundled');
    const { bundled, external } = partitionDependencies(shrinkwrap, manifest.dependencies ?? {});
    assertPlatformNeutral(shrinkwrap, bundled, external);

    manifest.bundleDependencies = bundled;
    // 발행 manifest의 devDependencies에는 `workspace:*`가 치환된 실재하지 않는 버전이 들어 있어
    // `npm ci`가 받으려다 실패한다. 소비자는 devDependencies를 설치하지 않으므로 지워도 무방하다.
    delete manifest.devDependencies;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: pkgDir });
    stripCloudflaredPostinstall(pkgDir);
    const out = path.join(work, 'out');
    mkdirSync(out);
    run('npm', ['pack', '--ignore-scripts', '--pack-destination', out], { cwd: pkgDir });
    const produced = path.join(out, `${String(manifest.name).replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`);
    if (!existsSync(produced)) throw new Error(`npm pack did not produce ${produced}`);

    // 검증: 번들 의존성이 tarball 안에 있고 external은 없다.
    const listing = execFileSync('tar', ['-tzf', produced], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n');
    for (const name of bundled) {
      if (!listing.includes(`package/node_modules/${name}/package.json`)) {
        throw new Error(`bundled dependency ${name} is missing from the tarball`);
      }
    }
    for (const name of external) {
      if (listing.some((l) => l.startsWith(`package/node_modules/${name}/`))) {
        throw new Error(`${name} must not be bundled`);
      }
    }
    // cloudflared의 postinstall은 tarball에 남아 있으면 안 된다.
    if (bundled.includes('cloudflared')) {
      const bundledManifest = JSON.parse(
        execFileSync('tar', ['-xzOf', produced, 'package/node_modules/cloudflared/package.json'], { encoding: 'utf8' }),
      );
      for (const hook of INSTALL_HOOKS) {
        if (bundledManifest.scripts?.[hook]) throw new Error(`cloudflared ${hook} must not be bundled`);
      }
    }
    copyFileSync(produced, tarball);
    console.log(`bundled ${bundled.length} dependencies into ${path.basename(tarball)} (external: ${external.join(', ') || 'none'})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tarball = process.argv[2];
  if (!tarball) {
    console.error('usage: node scripts/bundle-deps.mjs <tarball.tgz>');
    process.exit(2);
  }
  bundleTarball(path.resolve(tarball));
}
