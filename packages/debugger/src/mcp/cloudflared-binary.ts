/**
 * cloudflared binary provisioning with a pinned version and a sha256 check.
 *
 * The `cloudflared` npm package (a wrapper, not the Cloudflare binary) downloads the
 * executable from GitHub Releases at install time (postinstall) or on first use. Its
 * default is `latest/download/...` with no checksum verification, so whatever that URL
 * serves on the user's machine at that moment would be spawned. This module pins one
 * Cloudflare release and refuses any executable whose sha256 differs.
 *
 * - Version: {@link CLOUDFLARED_VERSION}. Bump it together with the hashes below.
 * - Hashes: sha256 of the *executable*. For linux/windows that is the release asset itself;
 *   for macOS it is the `cloudflared` file extracted from the `.tgz` asset. Both were
 *   checked against the digest GitHub reports for the release assets.
 * - An executable already at `bin` (for example from the npm postinstall, which installs
 *   `latest`) is hashed before use; a mismatch installs the pinned version over it.
 * - Several debugger sessions can start at once and share this one `bin`. The pinned build is
 *   therefore downloaded into a private staging directory next to `bin`, verified there, and
 *   renamed over `bin` in one step: a session never sees a half-written executable, never
 *   finds `bin` deleted, and a tunnel another session already runs is unaffected.
 * - A user-provided binary (`CLOUDFLARED_BIN`) is the user's own choice and is not touched.
 *
 * Updating the pin: download each asset of the new release, `shasum -a 256` it (extract the
 * macOS tgz first), compare with `gh api repos/cloudflare/cloudflared/releases/tags/<v>`
 * `assets[].digest`, then edit the table.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { install as libInstall } from 'cloudflared';

export const CLOUDFLARED_VERSION = '2026.10.7';

/** `${process.platform}-${process.arch}` -> sha256 (hex) of the executable for CLOUDFLARED_VERSION. */
export const CLOUDFLARED_SHA256: Readonly<Record<string, string>> = {
  'linux-x64': '1f99fb518b83dec2ba8d870a7cc991d82a77e6196295a3d2754ba17ab9f91872',
  'linux-arm64': '3df43aedc9ff291d1735b5cb576cb97e0b157488796db2e32b28aecabb445775',
  'linux-arm': '74f690f6707182839b63e0465726c7776dd63f0a174390b911d5d71f35cab94e',
  'linux-ia32': '4823d2f038395617e04e4070601ab45c0c43f31f15ee7586be299e19ef49d46e',
  'darwin-x64': '5c55e77da7012cebca19170357e196176c48c9647cc2ead404702fa125ddbd86',
  'darwin-arm64': '2136431d5eb467bf447d2ee514b713e192719b143aec1d9e09bf7dc290d5bb12',
  'win32-x64': '2493dbc168923bb3e59e5e7716f71deced92992eea9acd6e9d74f84ac7751343',
  'win32-ia32': '88c6b972b410db0e26745f593510d772c825a13c5a2374819e3f13a05b333082',
};

const STAGE_PREFIX = '.cloudflared-stage-';
/** A download that takes longer than this is dead; its staging directory is swept. */
const STAGE_MAX_AGE_MS = 60 * 60_000;

/**
 * Removes staging directories a killed download left behind. Only old ones: a
 * session that is downloading right now keeps its directory.
 */
async function sweepStaleStageDirs(parent: string, now: number = Date.now()): Promise<void> {
  try {
    for (const name of await readdir(parent)) {
      if (!name.startsWith(STAGE_PREFIX)) continue;
      const full = join(parent, name);
      try {
        const st = await stat(full);
        if (st.isDirectory() && now - st.mtimeMs > STAGE_MAX_AGE_MS) {
          await rm(full, { recursive: true, force: true });
        }
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  } catch {
    // Unreadable directory — nothing to sweep.
  }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

export interface EnsureOptions {
  /** Override the expected sha256 (tests). Defaults to the table entry for this platform. */
  expectedSha256?: string;
  /** Override the downloader (tests). Defaults to the `cloudflared` package's installer. */
  install?: (to: string, version: string) => Promise<unknown>;
}

/**
 * Makes sure `bin` is the pinned cloudflared executable. Resolves only when the file at `bin`
 * has the expected sha256; otherwise throws and leaves no unverified file behind.
 */
export async function ensureVerifiedCloudflaredBin(
  bin: string,
  options: EnsureOptions = {},
): Promise<void> {
  if (process.env.CLOUDFLARED_BIN) return; // user-chosen executable
  const expected =
    options.expectedSha256 ?? CLOUDFLARED_SHA256[`${process.platform}-${process.arch}`];
  if (!expected) {
    throw new Error(
      `no pinned cloudflared build for ${process.platform}-${process.arch}; set CLOUDFLARED_BIN to a cloudflared you installed yourself`,
    );
  }
  const download = options.install ?? ((to: string, version: string) => libInstall(to, version));

  if (await exists(bin)) {
    if ((await sha256File(bin)) === expected) return;
    process.stderr.write(
      `[@apps-in-toss/debugger] cloudflared at ${bin} is not the pinned ${CLOUDFLARED_VERSION} build — replacing it\n`,
    );
  }

  await mkdir(dirname(bin), { recursive: true });
  await sweepStaleStageDirs(dirname(bin));
  const stageDir = await mkdtemp(join(dirname(bin), STAGE_PREFIX));
  const staged = join(stageDir, basename(bin));
  try {
    await download(staged, CLOUDFLARED_VERSION);
    const actual = (await exists(staged)) ? await sha256File(staged) : 'missing';
    if (actual !== expected) {
      throw new Error(
        `downloaded cloudflared ${CLOUDFLARED_VERSION} failed sha256 verification (expected ${expected}, got ${actual}); refusing to run it`,
      );
    }
    if (process.platform !== 'win32') await chmod(staged, 0o755);
    try {
      await rename(staged, bin);
    } catch (err) {
      // Windows cannot replace an executable another session is running. If a
      // verified build is already in place, that is as good as ours.
      if (!((await exists(bin)) && (await sha256File(bin)) === expected)) throw err;
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}
