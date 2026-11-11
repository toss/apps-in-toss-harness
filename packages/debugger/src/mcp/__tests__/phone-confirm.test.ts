/**
 * The dialog the daemon puts on the phone: its page-side behaviour runs in jsdom, and
 * `requestPhoneConfirmation` is checked against a fake connection.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import {
  buildPhoneConfirmExpression,
  CONFIRM_REFUSE_OVER,
  confirmFailureMessage,
  excerpt,
  prepareCode,
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
function captureShadow(): {
  buttons: () => HTMLButtonElement[];
  root: () => ShadowRoot | null;
  restore: () => void;
} {
  const original = Element.prototype.attachShadow;
  let root: ShadowRoot | null = null;
  Element.prototype.attachShadow = function (init) {
    root = original.call(this, { ...init, mode: 'open' });
    return root;
  };
  return {
    buttons: () => Array.from(root?.querySelectorAll('button') ?? []),
    root: () => root,
    restore: () => {
      Element.prototype.attachShadow = original;
    },
  };
}

const SNIPPET = [
  '// load the list',
  'async function load(id) {',
  '  const url = `/api/items/` + id; /* block',
  '  comment */',
  "  const re = /ab+c/gi, s = 'it\\'s', n = 0x1F + 3.5e2;",
  '  if (!id) { return null; }',
  '  return await fetch(url).then((r) => r.json());',
  '}',
  '',
  '    // indented',
].join('\n');

describe('code box', () => {
  it('shows the whole code with its line breaks, indentation and numbers', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: SNIPPET }] });
      const rows = Array.from(shadow.root()?.querySelectorAll('[data-code] > div') ?? []);
      expect(rows).toHaveLength(SNIPPET.split('\n').length);
      const text = rows.map((r) => r.lastElementChild?.textContent ?? '').join('\n');
      expect(text).toBe(SNIPPET);
      expect(rows[0]?.firstElementChild?.textContent).toBe('1');
      expect(rows[9]?.firstElementChild?.textContent).toBe('10');
    } finally {
      shadow.restore();
    }
  });

  it('colours comments, strings, numbers, keywords and regexes, and nothing else', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: SNIPPET }] });
      const spans = Array.from(shadow.root()?.querySelectorAll('[data-code] span span') ?? []);
      const colored = (needle: string) =>
        (spans.find((sp) => sp.textContent === needle) as HTMLElement | undefined)?.style.color ??
        '';
      expect(colored('// load the list')).toBe('rgb(107, 118, 132)');
      expect(colored('async')).toBe('rgb(111, 66, 193)');
      expect(colored('function')).toBe('rgb(111, 66, 193)');
      expect(colored('0x1F')).toBe('rgb(179, 89, 0)');
      expect(colored('3.5e2')).toBe('rgb(179, 89, 0)');
      expect(colored('/ab+c/gi')).toBe('rgb(180, 35, 60)');
      expect(colored("'it\\'s'")).toBe('rgb(26, 127, 55)');
      expect(colored('load')).toBe('');
      expect(colored('url')).toBe('');
    } finally {
      shadow.restore();
    }
  });

  it('treats division as an operator, not a regex', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: 'a / b / c' }] });
      const spans = Array.from(shadow.root()?.querySelectorAll('[data-code] span span') ?? []);
      expect(spans).toHaveLength(0);
    } finally {
      shadow.restore();
    }
  });

  it('never turns code text into markup', () => {
    const shadow = captureShadow();
    try {
      runDialog({
        title: 't',
        lines: [],
        codes: [{ label: '<b>l</b>', text: '"<img src=x onerror=alert(1)>"; <script>1</script>' }],
      });
      expect(shadow.root()?.querySelector('img, script, b')).toBeNull();
      expect(shadow.root()?.querySelector('[data-code]')?.textContent).toContain('<img src=x');
    } finally {
      shadow.restore();
    }
  });

  it('scrolls inside the card so the buttons stay on screen', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: 'a\n'.repeat(500) }] });
      const box = shadow.root()?.querySelector('[data-code]') as HTMLElement | null;
      expect(box?.style.maxHeight).toBe('40vh');
      expect(box?.style.overflow).toBe('auto');
      expect(shadow.buttons().length).toBe(2);
    } finally {
      shadow.restore();
    }
  });
});

describe('prepareCode', () => {
  it('keeps formatting, drops only trailing blank space, and counts', () => {
    const p = prepareCode('a\r\n  b\n\n  \n');
    expect(p.block.text).toBe('a\n  b');
    expect(p.block.label).toBe('총 5자 · 2줄');
    expect(p.tooLong).toBe(false);
  });

  it('flags text over the cap', () => {
    expect(prepareCode('x'.repeat(CONFIRM_REFUSE_OVER)).tooLong).toBe(false);
    expect(prepareCode('x'.repeat(CONFIRM_REFUSE_OVER + 1)).tooLong).toBe(true);
  });
});

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

  it('offers the one-hour button only when asked, with its note under the buttons', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], offerGrant: true, grantNote: '결제는 계속 물어요' });
      expect(shadow.buttons().map((b) => b.textContent)).toEqual([
        '허용',
        '1시간 동안 묻지 않기',
        '거부',
      ]);
      expect(shadow.root()?.textContent).toContain('결제는 계속 물어요');
      runDialog({ title: 't', lines: [], grantNote: '쓰이지 않음' });
      expect(shadow.buttons().map((b) => b.textContent)).toEqual(['허용', '거부']);
      expect(shadow.root()?.textContent).not.toContain('쓰이지 않음');
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
    for (const value of ['allow', 'allow-hour', 'deny', 'timeout']) {
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
    expect(confirmFailureMessage('run_script', 'timeout')).toContain('confirmation-timeout');
    expect(confirmFailureMessage('run_script', 'deny')).toContain('거부');
  });
});
