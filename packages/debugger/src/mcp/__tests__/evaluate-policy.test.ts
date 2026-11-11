import { describe, expect, it } from 'vitest';
import {
  decideEvaluate,
  isSensitiveExpression,
  resolveEvaluatePolicy,
} from '../evaluate-policy.js';

describe('resolveEvaluatePolicy', () => {
  it('defaults to confirm on a real phone and free on the local browser', () => {
    expect(resolveEvaluatePolicy(undefined, 'relay')).toBe('confirm');
    expect(resolveEvaluatePolicy(undefined, 'local')).toBe('free');
  });

  it('takes the four known values and ignores the rest', () => {
    for (const v of ['free', 'confirm-on-sensitive', 'confirm', 'off'] as const) {
      expect(resolveEvaluatePolicy(v, 'relay')).toBe(v);
    }
    expect(resolveEvaluatePolicy(' OFF ', 'local')).toBe('off');
    expect(resolveEvaluatePolicy('yes', 'relay')).toBe('confirm');
    expect(resolveEvaluatePolicy('confirm-on-sensitive', 'relay')).toBe('confirm-on-sensitive');
  });
});

describe('isSensitiveExpression', () => {
  it('flags the SDK, network and storage surfaces', () => {
    for (const e of [
      "window.__sdkCall('x')",
      'window.__sdk.closeView()',
      'window.__appsInTossNativeBridge',
      'window.ReactNativeWebView.postMessage(1)',
      "fetch('/x')",
      'new XMLHttpRequest()',
      'navigator.sendBeacon(u)',
      'new WebSocket(u)',
      'localStorage.getItem("a")',
      'document . cookie',
      "import('x')",
      "eval('1')",
      'new Function("1")',
    ]) {
      expect(isSensitiveExpression(e), e).toBe(true);
    }
  });

  it('leaves ordinary reads alone', () => {
    for (const e of [
      'document.title',
      'document.querySelectorAll("a").length',
      '1 + 1',
      'window.innerWidth',
    ]) {
      expect(isSensitiveExpression(e), e).toBe(false);
    }
  });
});

describe('decideEvaluate', () => {
  it('maps policy and expression to a decision', () => {
    expect(decideEvaluate('free', 'fetch(1)')).toBe('allow');
    expect(decideEvaluate('off', '1')).toBe('deny');
    expect(decideEvaluate('confirm', '1')).toBe('confirm');
    expect(decideEvaluate('confirm-on-sensitive', '1')).toBe('allow');
    expect(decideEvaluate('confirm-on-sensitive', 'fetch(1)')).toBe('confirm');
  });
});
