import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * `start_attach` scans the built output under the daemon's working directory for an attach
 * client and its keys. Under test that directory is this package, whose own `dist/` holds the
 * packaged browser client, so suites that call `start_attach` without a `projectRoot` run in a
 * working directory with no project in it. Call at the top level of the test file.
 */
export function isolateProjectCwd(): void {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(join(tmpdir(), 'ait-no-project-cwd'));
  });
  afterEach(() => {
    vi.mocked(process.cwd).mockRestore();
  });
}
