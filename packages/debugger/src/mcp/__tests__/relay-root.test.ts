// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRelaySignature } from '@apps-in-toss/internal-protocol/relay-signature';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentClient, AgentUnavailableError } from '../../agent/client.js';
import { KeyStore } from '../../agent/key-store.js';
import { resolveAgentPaths } from '../../agent/paths.js';
import { LocalKeyProvider } from '../../agent/provider.js';
import { derivePublicKey } from '../../agent/root-key.js';
import { ensureSecureDir } from '../../agent/secure-dir.js';
import { createKeyAgentServer, type KeyAgentServer } from '../../agent/server.js';
import { createAgentToken } from '../../agent/token.js';
import { runRelayKey } from '../relay-key.js';
import { RelayKeyExpiredError } from '../relay-key-age.js';
import { readRelayPublicKeys } from '../relay-keys.js';
import {
  activateRelayRoot,
  KeyAgentRequiredError,
  prepareProjectKeys,
  relayAuthSwitch,
  resetRelayRootState,
} from '../relay-root.js';
import { attachSignatures, refreshRelaySession, SESSION_KEY_ROTATE_MS } from '../relay-signing.js';

const SECRET = 'ef'.repeat(32);
const WSS = 'wss://abc-def.trycloudflare.com';
const AT = '0123456789abcdef0123456789abcdef';

let dir: string; // the project
let agentDir: string;
let logs: string[];
const servers: KeyAgentServer[] = [];
const log = (m: string) => logs.push(m);

beforeEach(() => {
  resetRelayRootState();
  dir = mkdtempSync(join(tmpdir(), 'ait-root-'));
  agentDir = mkdtempSync(join(tmpdir(), 'ait-ag-'));
  writeFileSync(join(dir, 'package.json'), '{}');
  logs = [];
});
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  resetRelayRootState();
  rmSync(dir, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
});

function paths() {
  return resolveAgentPaths({
    platform: process.platform,
    env: { AIT_DEBUGGER_KEY_AGENT_DIR: agentDir },
    homedir: agentDir,
    username: 'tester',
    uid: process.getuid?.(),
  });
}

async function startAgent(store = new KeyStore()) {
  const p = paths();
  ensureSecureDir(p.dir);
  const token = createAgentToken();
  writeFileSync(p.tokenPath, token, { mode: 0o600 });
  const server = createKeyAgentServer({ store, token, endpoint: p.endpoint });
  await server.listen();
  servers.push(server);
  return { server, client: new AgentClient(p, { timeoutMs: 2000 }), store, token };
}

describe('daemon activation through the agent', () => {
  it('signs session certificates through the agent; the link verifies under the agent root key', async () => {
    const { client } = await startAgent();
    const report = await activateRelayRoot({
      projectRoot: dir,
      ensureAgent: async () => client,
      log,
    });
    expect(report.holder).toBe('agent');
    expect(relayAuthSwitch()).toBeTruthy();
    const signed = attachSignatures(relayAuthSwitch(), WSS, AT, 'dev-mac');
    expect(signed?.sig).toBeDefined();
    expect(signed?.cert).toMatch(/^[A-Za-z0-9_-]{180}$/);
    expect(parseRelaySignature(signed?.sig)).not.toBeNull();
    // The cert was signed by the agent's root key (public key = report.publicKey).
    const { webcrypto } = await import('node:crypto');
    const { parseRelayCertParam, relayCertMessage } = await import(
      '@apps-in-toss/internal-protocol/relay-signature'
    );
    const cert = parseRelayCertParam(signed?.cert);
    const key = await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(Buffer.from(report.publicKey, 'base64url')),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new Uint8Array(cert!.certSignatureBytes),
        new TextEncoder().encode(
          relayCertMessage(cert!.sessionPublicKey, cert!.notBefore, cert!.notAfter),
        ),
      ),
    ).toBe(true);
    // A certificate never outlives the root key.
    expect(cert!.notAfter).toBeLessThanOrEqual(report.notAfter);
  });

  it('imports a legacy .ait_relay on the way and deletes it; the bundle key keeps working', async () => {
    const { client } = await startAgent();
    writeFileSync(join(dir, '.ait_relay'), SECRET, { mode: 0o600 });
    const report = await activateRelayRoot({
      projectRoot: dir,
      ensureAgent: async () => client,
      log,
    });
    expect(report.publicKey).toBe(derivePublicKey(SECRET));
    expect(report.legacy[0]).toMatchObject({ outcome: 'imported' });
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, '.ait_relay'))).toBe(false);
    expect(logs.join('')).not.toContain(SECRET);
  });

  it('says to rebuild the bundle when the agent restarted and lost the key', async () => {
    const first = await startAgent();
    await activateRelayRoot({ projectRoot: dir, ensureAgent: async () => first.client, log });
    await first.server.close();
    servers.splice(0);
    // A new agent on the same endpoint and token has an empty store.
    const p = paths();
    const second = createKeyAgentServer({
      store: new KeyStore(),
      token: first.token,
      endpoint: p.endpoint,
    });
    await second.listen();
    servers.push(second);
    const err = await refreshRelaySession(Date.now() + SESSION_KEY_ROTATE_MS + 1_000).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RelayKeyExpiredError);
    expect((err as Error).message).toContain('디버그 번들을 다시 빌드해 업로드하세요');
  });

  it('reports a different key after a restart, so the bundle must be rebuilt', async () => {
    const first = await startAgent();
    const a = await activateRelayRoot({
      projectRoot: dir,
      ensureAgent: async () => first.client,
      log,
    });
    await first.server.close();
    servers.splice(0);
    const second = await startAgent();
    const b = await activateRelayRoot({
      projectRoot: dir,
      ensureAgent: async () => second.client,
      log,
    });
    expect(b.publicKey).not.toBe(a.publicKey);
    expect(b.changed).toBe(true);
    expect(logs.join('')).toContain('디버그 번들을 다시 빌드해 업로드하세요');
  });
});

describe('fallback mode (no agent)', () => {
  const unavailable = async (): Promise<AgentClient> => {
    throw new AgentUnavailableError('sandbox');
  };

  it('keeps a key in daemon memory and warns that bundles must be rebuilt after a restart', async () => {
    const report = await activateRelayRoot({ projectRoot: dir, ensureAgent: unavailable, log });
    expect(report.holder).toBe('memory');
    expect(relayAuthSwitch()).toBeTruthy();
    expect(logs.join('')).toContain('디버그 번들을 다시 빌드해 업로드하세요');
    expect(attachSignatures(relayAuthSwitch(), WSS, AT)?.sig).toBeDefined();
    // Same daemon, same key.
    const again = await activateRelayRoot({ projectRoot: dir, ensureAgent: unavailable, log });
    expect(again.publicKey).toBe(report.publicKey);
  });

  it('AIT_DEBUGGER_KEY_AGENT=off never tries the agent: nothing is created in its directory', async () => {
    const { readdirSync } = await import('node:fs');
    const report = await activateRelayRoot({
      projectRoot: dir,
      env: { ...process.env, AIT_DEBUGGER_KEY_AGENT: 'off', AIT_DEBUGGER_KEY_AGENT_DIR: agentDir },
      log,
    });
    expect(report.holder).toBe('memory');
    expect(readdirSync(agentDir)).toEqual([]);
  });

  it('the build helper and the CLI do not fall back: a bundle key must outlive the process', async () => {
    await expect(
      prepareProjectKeys({ projectRoot: dir, requireAgent: true, ensureAgent: unavailable, log }),
    ).rejects.toBeInstanceOf(KeyAgentRequiredError);
  });

  it('keeps the legacy file because the key would live only in this process', async () => {
    writeFileSync(join(dir, '.ait_relay'), SECRET, { mode: 0o600 });
    const report = await activateRelayRoot({ projectRoot: dir, ensureAgent: unavailable, log });
    expect(report.publicKey).toBe(derivePublicKey(SECRET));
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, '.ait_relay'))).toBe(true);
  });
});

describe('build helper', () => {
  it('returns only { publicKey, notAfter } for every live key', async () => {
    const provider = new LocalKeyProvider(new KeyStore());
    writeFileSync(join(dir, '.ait_relay'), SECRET, { mode: 0o600 });
    const keys = await readRelayPublicKeys(dir, { provider, log });
    expect(keys.length).toBeGreaterThanOrEqual(1);
    for (const k of keys) {
      expect(Object.keys(k).sort()).toEqual(['notAfter', 'publicKey']);
      expect(k.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
      expect(Number.isInteger(k.notAfter)).toBe(true);
      expect(k.notAfter).toBeGreaterThan(Date.now() / 1000);
    }
    expect(keys[0]?.publicKey).toBe(derivePublicKey(SECRET));
    expect(JSON.stringify(keys)).not.toContain(SECRET);
    expect(logs.join('')).not.toContain(SECRET);
  });

  it('is stable for one project while the key lives', async () => {
    const provider = new LocalKeyProvider(new KeyStore());
    const a = await readRelayPublicKeys(dir, { provider, log });
    const b = await readRelayPublicKeys(dir, { provider, log });
    expect(b).toEqual(a);
  });
});

describe('relay-key command', () => {
  it('prints the public key on stdout and the expiry on stderr; --rotate prints a new key', async () => {
    const provider = new LocalKeyProvider(new KeyStore());
    const prepare = (o: Parameters<typeof prepareProjectKeys>[0]) =>
      prepareProjectKeys({ ...o, provider });
    const run = async (args: string[]) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runRelayKey(args, {
        cwd: () => dir,
        write: (t) => out.push(t),
        writeError: (t) => err.push(t),
        prepare,
      });
      return { code, out: out.join(''), err: err.join('') };
    };
    const first = await run([]);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/^[A-Za-z0-9_-]{87}\n$/);
    expect(first.err).toContain('expires');
    expect((await run([])).out).toBe(first.out);
    const rotated = await run(['--rotate']);
    expect(rotated.code).toBe(0);
    expect(rotated.out).not.toBe(first.out);
    expect(rotated.err).toContain('rebuild');
    const json = await run(['--json']);
    const parsed = JSON.parse(json.out) as Array<{ publicKey: string; notAfter: number }>;
    expect(parsed[0]?.publicKey).toBe(rotated.out.trim());
  });

  it('exits 1 with a pointer when the agent cannot be reached', async () => {
    const err: string[] = [];
    const code = await runRelayKey([], {
      cwd: () => dir,
      write: () => {},
      writeError: (t) => err.push(t),
      prepare: async () => {
        throw new KeyAgentRequiredError();
      },
    });
    expect(code).toBe(1);
    expect(err.join('')).toContain('key agent');
  });

  it('has no file-writing path: the project directory stays as it was', async () => {
    const { readdirSync } = await import('node:fs');
    const provider = new LocalKeyProvider(new KeyStore());
    await runRelayKey(['--rotate'], {
      cwd: () => dir,
      write: () => {},
      writeError: () => {},
      prepare: (o) => prepareProjectKeys({ ...o, provider }),
    });
    expect(readdirSync(dir)).toEqual(['package.json']);
  });
});

describe('every attach-link builder carries the session certificate', () => {
  it('start_attach, the dashboard QR and buildAttachUrl all put sig and arc in the link', async () => {
    const { client } = await startAgent();
    await activateRelayRoot({ projectRoot: dir, ensureAgent: async () => client, log });
    const secret = relayAuthSwitch();
    expect(secret).toBeTruthy();
    const scheme = 'intoss-private://sample?_deploymentId=dep-1';
    const tunnel = { up: true, wssUrl: WSS };
    const { rebuildAttachUrl } = await import('../debug-server.js');
    const { buildAttachUrl } = await import('../tools.js');
    const { mintAttachUrl } = await import('../attach-orchestrator.js');
    const links = {
      dashboard: rebuildAttachUrl({ kind: 'scheme', schemeUrl: scheme, wssUrl: WSS }, tunnel),
      buildAttachUrl: buildAttachUrl(scheme, tunnel, secret as string).attachUrl,
      startAttach: mintAttachUrl(
        { getTotpSecret: () => secret, getTunnelStatus: () => tunnel } as never,
        { kind: 'scheme', schemeUrl: scheme, wssUrl: WSS },
      ),
    };
    for (const [name, link] of Object.entries(links)) {
      expect(link, name).toMatch(/[?&]sig=/);
      expect(link, name).toMatch(/[?&]arc=[A-Za-z0-9_-]{180}(?:&|$)/);
    }
  });
});
