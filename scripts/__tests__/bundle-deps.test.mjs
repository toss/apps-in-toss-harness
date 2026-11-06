// 실행: node --test scripts/__tests__/bundle-deps.test.mjs
//
// 번들된 cloudflared 패키지의 postinstall 제거(검증 없는 latest 바이너리 다운로드 차단).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { stripCloudflaredPostinstall, stripPostinstall } from '../bundle-deps.mjs';

const POSTINSTALL = 'node scripts/postinstall.mjs && node lib/cloudflared.js bin install';

describe('stripPostinstall', () => {
  test('removes only postinstall and keeps other scripts', () => {
    const m = { name: 'cloudflared', scripts: { build: 'tsup', postinstall: POSTINSTALL } };
    assert.equal(stripPostinstall(m), true);
    assert.deepEqual(m.scripts, { build: 'tsup' });
  });

  test('drops an emptied scripts object', () => {
    const m = { name: 'cloudflared', scripts: { postinstall: POSTINSTALL } };
    assert.equal(stripPostinstall(m), true);
    assert.equal('scripts' in m, false);
  });

  test('removes every install lifecycle hook', () => {
    const m = { name: 'x', scripts: { preinstall: 'a', install: 'b', postinstall: 'c', prepare: 'd', test: 'keep' } };
    assert.equal(stripPostinstall(m), true);
    assert.deepEqual(m.scripts, { test: 'keep' });
  });

  test('is a no-op without postinstall', () => {
    const m = { name: 'x', scripts: { build: 'tsup' } };
    assert.equal(stripPostinstall(m), false);
    assert.deepEqual(m, { name: 'x', scripts: { build: 'tsup' } });
    assert.equal(stripPostinstall({ name: 'y' }), false);
  });
});

describe('stripCloudflaredPostinstall', () => {
  const withTree = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-deps-test-'));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const write = (dir, name, manifest) => {
    fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify(manifest));
  };
  const read = (dir, name) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8'));

  test('rewrites node_modules/cloudflared/package.json and leaves other packages alone', () => {
    withTree((dir) => {
      write(dir, 'cloudflared', { name: 'cloudflared', version: '0.7.3', scripts: { postinstall: POSTINSTALL } });
      write(dir, 'ws', { name: 'ws', scripts: { postinstall: 'keep' } });
      assert.equal(stripCloudflaredPostinstall(dir), true);
      assert.equal(read(dir, 'cloudflared').scripts?.postinstall, undefined);
      assert.equal(read(dir, 'cloudflared').version, '0.7.3');
      assert.equal(read(dir, 'ws').scripts.postinstall, 'keep');
    });
  });

  test('does nothing when cloudflared is not installed', () => {
    withTree((dir) => {
      assert.equal(stripCloudflaredPostinstall(dir), false);
    });
  });
});
