import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySdkCall, parseSdkAllowlist, READ_ONLY_SDK_GETTERS } from '../sdk-policy.js';

describe('classifySdkCall', () => {
  it('lets read-only getters through', () => {
    expect(classifySdkCall('getLocale')).toEqual({ decision: 'allow', via: 'read-only' });
  });

  it('asks for everything else, including unknown names', () => {
    for (const name of [
      'setSecureScreen',
      'closeView',
      'requestReview',
      'checkoutPayment',
      'brandNewThing',
    ]) {
      expect(classifySdkCall(name)).toEqual({ decision: 'confirm' });
    }
  });

  it('does not treat identifier-returning getters as free', () => {
    for (const name of ['getDeviceId', 'getAnonymousKey', 'getSchemeUri', 'getClipboardText']) {
      expect(classifySdkCall(name).decision).toBe('confirm');
    }
  });

  it('denies names that are not plain identifiers or that every object has', () => {
    for (const name of [
      '',
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'a.b',
      'a b',
      '1x',
      'x()',
    ]) {
      expect(classifySdkCall(name).decision, name).toBe('deny');
    }
  });

  it('takes the developer allow list', () => {
    const allow = parseSdkAllowlist(' setScreenAwakeMode , constructor, a.b, ,openURL');
    expect([...allow].sort()).toEqual(['openURL', 'setScreenAwakeMode']);
    expect(classifySdkCall('openURL', allow)).toEqual({ decision: 'allow', via: 'allowlist' });
    expect(classifySdkCall('closeView', allow).decision).toBe('confirm');
  });
});

describe('READ_ONLY_SDK_GETTERS', () => {
  it('only lists names that web-framework 3.8.0 exports (checked when it is installed)', () => {
    const pnpm = join(__dirname, '../../../../../node_modules/.pnpm');
    if (!existsSync(pnpm)) return;
    const dir = readdirSync(pnpm).find((d) => d.startsWith('@apps-in-toss+web-framework@3.8.0'));
    if (dir === undefined) return;
    const dts = join(pnpm, dir, 'node_modules/@apps-in-toss/web-framework/dist/index.d.ts');
    if (!existsSync(dts)) return;
    const source = readFileSync(dts, 'utf8');
    for (const name of READ_ONLY_SDK_GETTERS) {
      expect(source, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it('is only getters and version checks', () => {
    for (const name of READ_ONLY_SDK_GETTERS) expect(name).toMatch(/^(get|is)[A-Z]/);
  });
});
