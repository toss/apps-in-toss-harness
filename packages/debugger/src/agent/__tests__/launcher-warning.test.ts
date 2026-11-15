// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentPaths, resetOverrideWarningForTest } from '../launcher.js';

describe('defaultAgentPaths override warning', () => {
  let write: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetOverrideWarningForTest();
    write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => write.mockRestore());

  it('warns once on stderr when the override is too long, without the path', () => {
    const long = `/${'b'.repeat(130)}`;
    const env = { AIT_DEBUGGER_KEY_AGENT_DIR: long };
    defaultAgentPaths('darwin', env);
    defaultAgentPaths('darwin', env);
    expect(write).toHaveBeenCalledTimes(1);
    const text = String(write.mock.calls[0]?.[0]);
    expect(text).toContain('AIT_DEBUGGER_KEY_AGENT_DIR');
    expect(text).toContain('너무 길어');
    expect(text).not.toContain(long);
  });

  it('stays quiet for a short override', () => {
    defaultAgentPaths('darwin', { AIT_DEBUGGER_KEY_AGENT_DIR: '/tmp/x' });
    expect(write).not.toHaveBeenCalled();
  });
});
