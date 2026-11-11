import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifySdkCall,
  HARMLESS_SDK_EFFECTS,
  isPaymentSdkName,
  PAYMENT_SDK_NAMES,
  parseSdkAllowlist,
  READ_ONLY_SDK_GETTERS,
} from '../sdk-policy.js';

describe('classifySdkCall', () => {
  it('lets read-only getters through', () => {
    expect(classifySdkCall('getLocale')).toEqual({ decision: 'allow', via: 'read-only' });
  });

  it('lets harmless effects through (haptics)', () => {
    expect(classifySdkCall('generateHapticFeedback')).toEqual({
      decision: 'allow',
      via: 'harmless',
    });
  });

  it('asks (session-allowable) for everything else, including unknown names', () => {
    for (const name of [
      'setSecureScreen',
      'closeView',
      'requestReview',
      'share',
      'openURL',
      'requestPermission',
      'setClipboardText',
      'getCurrentLocation',
      'fetchContacts',
      'openCamera',
      'appLogin',
      'getTossShareLink',
      'brandNewThing',
    ]) {
      expect(classifySdkCall(name), name).toEqual({ decision: 'confirm', tier: 'confirm' });
    }
  });

  it('asks on every call for payments and rewards', () => {
    for (const name of [
      'checkoutPayment',
      'requestTossPayPaysBilling',
      'createOneTimePurchaseOrder',
      'createSubscriptionPurchaseOrder',
      'completeProductGrant',
      'grantPromotionReward',
      'grantPromotionRewardForGame',
      'contactsViral',
      'IAP',
      'TossPay',
      'Promotion',
      'someFuturePaymentThing',
    ]) {
      expect(classifySdkCall(name), name).toEqual({ decision: 'confirm', tier: 'confirm-always' });
    }
  });

  it('classifies one-level namespaced names on the full dotted name', () => {
    expect(classifySdkCall('SafeAreaInsets.get')).toEqual({ decision: 'allow', via: 'read-only' });
    expect(classifySdkCall('Storage.setItem')).toEqual({ decision: 'confirm', tier: 'confirm' });
    for (const name of [
      'IAP.getPendingOrders',
      'IAP.createOneTimePurchaseOrder',
      'TossPay.authorize',
      'Promotion.grantReward',
      'Viral.contactsViral',
      'SomeNamespace.checkoutPayment',
      'Other.subscriptionThing',
    ]) {
      expect(classifySdkCall(name), name).toEqual({ decision: 'confirm', tier: 'confirm-always' });
    }
  });

  it('ignores a payment name on the developer allow list, dotted or not', () => {
    const allow = parseSdkAllowlist('IAP.getPendingOrders,TossPay.authorize,Device.vibrate');
    expect([...allow]).toEqual(['Device.vibrate']);
    expect(classifySdkCall('Device.vibrate', allow)).toEqual({
      decision: 'allow',
      via: 'allowlist',
    });
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
      'a.b.c',
      '.a',
      'a.',
      'a..b',
      'IAP.constructor',
      'constructor.get',
      'SafeAreaInsets.__proto__',
      'a b',
      '1x',
      'x()',
    ]) {
      expect(classifySdkCall(name).decision, name).toBe('deny');
    }
  });

  it('takes the developer allow list', () => {
    const allow = parseSdkAllowlist(' setScreenAwakeMode , constructor, a.b.c, ,openURL');
    expect([...allow].sort()).toEqual(['openURL', 'setScreenAwakeMode']);
    expect(classifySdkCall('openURL', allow)).toEqual({ decision: 'allow', via: 'allowlist' });
    expect(classifySdkCall('closeView', allow).decision).toBe('confirm');
  });

  it('cannot move a payment name into free', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const allow = parseSdkAllowlist('checkoutPayment, grantPromotionReward, openURL, IAP');
      expect([...allow]).toEqual(['openURL']);
      expect(classifySdkCall('checkoutPayment', allow)).toEqual({
        decision: 'confirm',
        tier: 'confirm-always',
      });
      // Even a hand-built set cannot do it.
      expect(classifySdkCall('checkoutPayment', new Set(['checkoutPayment'])).decision).toBe(
        'confirm',
      );
      const warned = write.mock.calls.map((c) => String(c[0])).join('');
      expect(warned).toContain('checkoutPayment');
    } finally {
      write.mockRestore();
    }
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
    for (const name of READ_ONLY_SDK_GETTERS)
      expect(name).toMatch(/^((get|is)[A-Z]|[A-Z][A-Za-z]*\.get$)/);
  });
});

describe('tier lists', () => {
  it('keeps free, harmless and payment names apart', () => {
    for (const name of [...READ_ONLY_SDK_GETTERS, ...HARMLESS_SDK_EFFECTS]) {
      expect(isPaymentSdkName(name), name).toBe(false);
    }
    for (const name of PAYMENT_SDK_NAMES) expect(isPaymentSdkName(name), name).toBe(true);
  });
});
