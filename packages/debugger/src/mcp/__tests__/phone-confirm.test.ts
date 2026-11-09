/**
 * The dialog the daemon puts on the phone: its page-side behaviour runs in jsdom, and
 * `requestPhoneConfirmation` is checked against a fake connection.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import {
  buildPhoneConfirmExpression,
  confirmFailureMessage,
  excerpt,
  requestPhoneConfirmation,
} from '../phone-confirm.js';

function runDialog(opts: Parameters<typeof buildPhoneConfirmExpression>[0]): {
  result: Promise<unknown>;
  host: () => HTMLElement | null;
} {
  document.body.innerHTML = '';
  // biome-ignore lint/security/noGlobalEval: deliberately evaluating the injected dialog to exercise its DOM behavior.
  const indirectEval = eval;
  const result = indirectEval(buildPhoneConfirmExpression(opts)) as Promise<unknown>;
  return { result, host: () => document.getElementById('__ait_confirm_host') };
}

/** Buttons live in a closed shadow root, so capture it while the dialog builds. */
function captureShadow(): { buttons: () => HTMLButtonElement[]; restore: () => void } {
  const original = Element.prototype.attachShadow;
  let root: ShadowRoot | null = null;
  Element.prototype.attachShadow = function (init) {
    root = original.call(this, { ...init, mode: 'open' });
    return root;
  };
  return {
    buttons: () => Array.from(root?.querySelectorAll('button') ?? []),
    restore: () => {
      Element.prototype.attachShadow = original;
    },
  };
}

describe('dialog in the page', () => {
  it('ignores a click that did not come from a person and times out', async () => {
    vi.useFakeTimers();
    const shadow = captureShadow();
    try {
      const { result, host } = runDialog({ title: 't', lines: ['a'], timeoutMs: 3000 });
      const [allow] = shadow.buttons();
      expect(allow?.textContent).toBe('허용');
      allow?.dispatchEvent(new MouseEvent('click', { bubbles: true })); // isTrusted === false
      expect(host()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(3100);
      await expect(result).resolves.toBe('timeout');
      expect(host()).toBeNull();
    } finally {
      shadow.restore();
      vi.useRealTimers();
    }
  });

  it('offers the session button only when asked', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], offerSession: true });
      expect(shadow.buttons().map((b) => b.textContent)).toEqual([
        '허용',
        '이 세션 동안 허용',
        '거부',
      ]);
      runDialog({ title: 't', lines: [] });
      expect(shadow.buttons().map((b) => b.textContent)).toEqual(['허용', '거부']);
    } finally {
      shadow.restore();
    }
  });

  it('puts the text in as text, not markup', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: '<img src=x onerror=alert(1)>', lines: ['<b>x</b>'] });
      expect(document.querySelector('img')).toBeNull();
    } finally {
      shadow.restore();
    }
  });
});

function fakeConn(send: CdpConnection['send'], targets = 1): CdpConnection {
  return {
    kind: 'relay',
    listTargets: () =>
      Array.from({ length: targets }, (_, i) => ({ id: String(i), title: '', url: 'u' })),
    send,
  } as unknown as CdpConnection;
}

describe('requestPhoneConfirmation', () => {
  it('returns what the phone answered', async () => {
    for (const value of ['allow', 'allow-session', 'deny', 'timeout']) {
      const conn = fakeConn((() =>
        Promise.resolve({ result: { type: 'string', value } })) as never);
      await expect(requestPhoneConfirmation(conn, { title: 't', lines: [] })).resolves.toBe(value);
    }
  });

  it('is unavailable without a page, after an error or on an odd answer', async () => {
    const none = fakeConn((() => Promise.resolve({})) as never, 0);
    await expect(requestPhoneConfirmation(none, { title: 't', lines: [] })).resolves.toBe(
      'unavailable',
    );
    const boom = fakeConn((() => Promise.reject(new Error('gone'))) as never);
    await expect(requestPhoneConfirmation(boom, { title: 't', lines: [] })).resolves.toBe(
      'unavailable',
    );
    const odd = fakeConn((() =>
      Promise.resolve({ result: { type: 'string', value: 'yes' } })) as never);
    await expect(requestPhoneConfirmation(odd, { title: 't', lines: [] })).resolves.toBe(
      'unavailable',
    );
  });

  it('asks one question at a time', async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    let n = 0;
    const conn = fakeConn((() => {
      const id = ++n;
      order.push(`start${id}`);
      return new Promise((resolve) => {
        const done = () => {
          order.push(`end${id}`);
          resolve({ result: { type: 'string', value: 'allow' } });
        };
        if (id === 1) release = done;
        else done();
      });
    }) as never);
    const a = requestPhoneConfirmation(conn, { title: 'a', lines: [] });
    const b = requestPhoneConfirmation(conn, { title: 'b', lines: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['start1']);
    release?.();
    await Promise.all([a, b]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });
});

describe('helpers', () => {
  it('excerpt collapses whitespace and cuts', () => {
    expect(excerpt('a\n  b', 10)).toBe('a b');
    expect(excerpt('x'.repeat(20), 10)).toHaveLength(10);
  });

  it('names the timeout in the failure text', () => {
    expect(confirmFailureMessage('evaluate', 'timeout')).toContain('confirmation-timeout');
    expect(confirmFailureMessage('evaluate', 'deny')).toContain('거부');
  });
});
