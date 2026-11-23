/**
 * `get_status` `keyAgent` block: which key agent serves this machine's relay keys,
 * and whether it is the same version as the daemon. Public data only.
 */

import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../agent/protocol.js';
import {
  buildKeyAgentReport,
  getDiagnostics,
  InMemoryDiagnosticsCollector,
  type TunnelStatus,
} from '../tools.js';

const tunnelDown: TunnelStatus = { up: false, wssUrl: null };

function run(readKeyAgentStatus?: () => Promise<AgentStatus | null>) {
  return getDiagnostics({
    tunnel: tunnelDown,
    env: 'mock',
    envReason: 'default-mock',
    collector: new InMemoryDiagnosticsCollector(),
    readSessions: () => null,
    ...(readKeyAgentStatus === undefined ? {} : { readKeyAgentStatus }),
  });
}

describe('getDiagnostics keyAgent', () => {
  it('is null when the daemon did not look', async () => {
    expect((await run()).keyAgent).toBeNull();
  });

  it('reports a reachable agent of the same version without a hint', async () => {
    // vitest.config defines __VERSION__ = '0.0.0-test'.
    const { keyAgent } = await run(async () => ({
      pid: 4321,
      startedAt: 1_700_000_000,
      projects: 1,
      keys: 2,
      version: '0.0.0-test',
    }));
    expect(keyAgent).toEqual({
      reachable: true,
      pid: 4321,
      startedAt: '2023-11-14T22:13:20.000Z',
      version: '0.0.0-test',
      protocol: 1,
      hint: null,
    });
  });

  it('says so when the agent is unreachable', async () => {
    const { keyAgent } = await run(async () => null);
    expect(keyAgent).toMatchObject({
      reachable: false,
      pid: null,
      startedAt: null,
      version: null,
      protocol: null,
    });
    expect(keyAgent?.hint).toContain('연결하지 못했습니다');
  });

  it('treats a rejected read as unreachable', async () => {
    const { keyAgent } = await run(async () => {
      throw new Error('boom');
    });
    expect(keyAgent?.reachable).toBe(false);
  });

  it('shows "unknown (<=0.5.0)" and an older-version hint when the agent reports no version', async () => {
    const { keyAgent } = await run(async () => ({
      pid: 7,
      startedAt: 1_700_000_000,
      projects: 0,
      keys: 0,
    }));
    expect(keyAgent).toMatchObject({ reachable: true, pid: 7, version: 'unknown (<=0.5.0)' });
    expect(keyAgent?.hint).toContain('이전 버전');
    expect(keyAgent?.hint).toContain('스스로 종료');
  });

  it('hints when the agent version differs from the daemon', async () => {
    const { keyAgent } = await run(async () => ({
      pid: 7,
      startedAt: 1_700_000_000,
      projects: 1,
      keys: 1,
      version: '0.5.0',
    }));
    expect(keyAgent?.version).toBe('0.5.0');
    expect(keyAgent?.hint).toContain('0.0.0-test');
    expect(keyAgent?.hint).toContain('0.5.0');
  });

  it('exposes only public fields', async () => {
    const { keyAgent } = await run(async () => ({
      pid: 7,
      startedAt: 1_700_000_000,
      projects: 1,
      keys: 1,
      version: '0.0.0-test',
    }));
    expect(Object.keys(keyAgent ?? {}).sort()).toEqual([
      'hint',
      'pid',
      'protocol',
      'reachable',
      'startedAt',
      'version',
    ]);
  });
});

describe('buildKeyAgentReport', () => {
  const status: AgentStatus = { pid: 1, startedAt: 0, projects: 0, keys: 0, version: '1.0.0' };

  it('does not hint when the daemon version is unknown but the agent reports one', () => {
    expect(buildKeyAgentReport(status, null).hint).toBeNull();
  });

  it('hints without a daemon version when the agent reports none', () => {
    const { version: _omit, ...old } = status;
    expect(buildKeyAgentReport(old, null).hint).toContain('이전 버전');
  });
});
