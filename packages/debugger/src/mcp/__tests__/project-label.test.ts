import { describe, expect, it } from 'vitest';
import {
  extractGraniteAppName,
  findProjectRoot,
  type ProjectIdentityFs,
  resolveProjectIdentity,
} from '../project-label.js';

function fakeFs(files: Record<string, string>): ProjectIdentityFs {
  return {
    exists: (p) => p in files,
    readText: (p) => files[p] ?? null,
  };
}

describe('extractGraniteAppName', () => {
  it('reads appName from single, double and backtick quotes', () => {
    expect(extractGraniteAppName("export default defineConfig({ appName: 'shop-app' });")).toBe(
      'shop-app',
    );
    expect(extractGraniteAppName('module.exports = { appName: "shop-app" }')).toBe('shop-app');
    expect(extractGraniteAppName('export default { appName: `shop-app`, brand: {} }')).toBe(
      'shop-app',
    );
  });

  it('ignores commented-out names and picks the live one', () => {
    const src = "// appName: 'old'\n/* appName: 'older' */\nexport default { appName: 'live' };";
    expect(extractGraniteAppName(src)).toBe('live');
  });

  it('does not take a template expression or a missing name', () => {
    expect(extractGraniteAppName('export default { appName: `a-$' + '{suffix}` }')).toBeNull();
    expect(extractGraniteAppName('export default { appName: computeName() }')).toBeNull();
    expect(extractGraniteAppName('export default {}')).toBeNull();
  });

  it('never executes the file', () => {
    const src = "globalThis.__ran = true; export default { appName: 'x' };";
    expect(extractGraniteAppName(src)).toBe('x');
    expect((globalThis as Record<string, unknown>).__ran).toBeUndefined();
  });
});

describe('resolveProjectIdentity', () => {
  const root = '/work/shop-web';

  it('prefers the granite appName and keeps the folder basename beside it', () => {
    const fs = fakeFs({
      [`${root}/package.json`]: '{"name":"@scope/pkg"}',
      [`${root}/granite.config.ts`]: "export default { appName: 'shop-app' }",
    });
    expect(resolveProjectIdentity(root, fs)).toEqual({
      label: 'shop-app',
      folder: 'shop-web',
      source: 'granite',
    });
  });

  it('tries .js and .mts configs', () => {
    const js = fakeFs({
      [`${root}/package.json`]: '{}',
      [`${root}/granite.config.js`]: "module.exports = { appName: 'from-js' }",
    });
    expect(resolveProjectIdentity(root, js).label).toBe('from-js');
    const mts = fakeFs({
      [`${root}/package.json`]: '{}',
      [`${root}/granite.config.mts`]: "export default { appName: 'from-mts' }",
    });
    expect(resolveProjectIdentity(root, mts).label).toBe('from-mts');
  });

  it('falls back to the package.json name', () => {
    const fs = fakeFs({ [`${root}/package.json`]: '{"name":"@scope/pkg"}' });
    expect(resolveProjectIdentity(root, fs)).toEqual({
      label: '@scope/pkg',
      folder: 'shop-web',
      source: 'package',
    });
  });

  it('falls back to the folder basename when nothing else names the project', () => {
    expect(resolveProjectIdentity(root, fakeFs({ [`${root}/package.json`]: '{bad json' }))).toEqual(
      { label: 'shop-web', folder: 'shop-web', source: 'folder' },
    );
    expect(resolveProjectIdentity(root, fakeFs({}))).toEqual({
      label: 'shop-web',
      folder: 'shop-web',
      source: 'folder',
    });
  });

  it('finds the project root from a subdirectory', () => {
    const fs = fakeFs({ [`${root}/package.json`]: '{"name":"p"}' });
    expect(findProjectRoot(`${root}/src/deep`, fs.exists)).toBe(root);
    expect(resolveProjectIdentity(`${root}/src/deep`, fs).folder).toBe('shop-web');
  });

  it('never returns a path and strips control characters and long names', () => {
    const fs = fakeFs({
      [`${root}/package.json`]: '{}',
      [`${root}/granite.config.ts`]: `export default { appName: 'a\tb${'x'.repeat(100)}' }`,
    });
    const id = resolveProjectIdentity(root, fs);
    expect(id.label.length).toBeLessThanOrEqual(64);
    expect(id.label).not.toMatch(/[\t\n/]/);
    expect(id.folder).not.toContain('/');
  });
});
