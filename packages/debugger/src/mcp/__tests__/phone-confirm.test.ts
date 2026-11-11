/**
 * The dialog the daemon puts on the phone: its page-side behaviour runs in jsdom, and
 * `requestPhoneConfirmation` is checked against a fake connection.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CdpConnection } from '../cdp-connection.js';
import {
  buildPhoneConfirmExpression,
  CONFIRM_HOST_ATTR,
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
  return {
    result,
    host: () => document.querySelector(`[${CONFIRM_HOST_ATTR}]`) as HTMLElement | null,
  };
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

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const RLO = String.fromCharCode(0x202e);

function rowsOf(shadow: ReturnType<typeof captureShadow>): HTMLElement[] {
  return Array.from(shadow.root()?.querySelectorAll('[data-code] > div') ?? []) as HTMLElement[];
}
const rowText = (r: HTMLElement | undefined): string => r?.lastElementChild?.textContent ?? '';

describe('what is shown matches what runs', () => {
  it('shows U+2028 and U+2029 as real line breaks and ends a // comment there', () => {
    const shadow = captureShadow();
    try {
      runDialog({
        title: 't',
        lines: [],
        codes: [{ label: 'x', text: `a(); // note${LS}fetch(1)${PS}b()` }],
      });
      const rows = rowsOf(shadow);
      expect(rows.map(rowText)).toEqual(['a(); // note', 'fetch(1)', 'b()']);
      // The comment colour stops at the terminator: the second row has no comment span.
      const commentColor = 'rgb(107, 118, 132)';
      const spans = Array.from(rows[1]?.querySelectorAll('span span') ?? []) as HTMLElement[];
      expect(spans.some((sp) => sp.style.color === commentColor)).toBe(false);
      const first = Array.from(rows[0]?.querySelectorAll('span span') ?? []) as HTMLElement[];
      expect(first.find((sp) => sp.textContent === '// note')?.style.color).toBe(commentColor);
    } finally {
      shadow.restore();
    }
  });

  it('marks bidi, zero-width and control characters visibly, and says how many', () => {
    const shadow = captureShadow();
    try {
      const zw = String.fromCharCode(0x200b);
      const bom = String.fromCharCode(0xfeff);
      runDialog({
        title: 't',
        lines: [],
        codes: [{ label: 'x', text: `a${RLO}b${zw}c${bom}d\u0001e\tf` }],
      });
      const markers = Array.from(
        shadow.root()?.querySelectorAll('[data-invisible]') ?? [],
      ) as HTMLElement[];
      expect(markers.map((m) => m.textContent)).toEqual([
        '[U+202E]',
        '[U+200B]',
        '[U+FEFF]',
        '[U+0001]',
      ]);
      expect(markers[0]?.style.color).toBe('rgb(217, 45, 32)');
      expect(shadow.root()?.querySelector('[data-invisible-caption]')?.textContent).toBe(
        '보이지 않는 문자 4개를 표시했어요',
      );
      // The tab stays a tab; the marker replaces the character in the display only.
      expect(rowText(rowsOf(shadow)[0])).toContain('\tf');
    } finally {
      shadow.restore();
    }
  });

  it('shows no caption when nothing is hidden', () => {
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: SNIPPET }] });
      expect(shadow.root()?.querySelector('[data-invisible-caption]')).toBeNull();
    } finally {
      shadow.restore();
    }
  });

  it('folds more than two blank lines into one marker row and keeps line numbers', () => {
    const shadow = captureShadow();
    try {
      runDialog({
        title: 't',
        lines: [],
        codes: [{ label: 'x', text: 'a\n\n\nb\n\n\n\n\n\nc' }],
      });
      const rows = rowsOf(shadow);
      expect(rows.map(rowText)).toEqual(['a', '', '', 'b', '빈 줄 5개', 'c']);
      expect(rows[4]?.getAttribute('data-gap')).toBe('5');
      expect(rows[5]?.firstElementChild?.textContent).toBe('10');
    } finally {
      shadow.restore();
    }
  });

  it('says how many lines are below the fold when the box overflows', () => {
    const shadow = captureShadow();
    const elProto = Element.prototype as unknown as Record<string, unknown>;
    const htmlProto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const saved = {
      ch: Object.getOwnPropertyDescriptor(elProto, 'clientHeight'),
      sh: Object.getOwnPropertyDescriptor(elProto, 'scrollHeight'),
      ot: Object.getOwnPropertyDescriptor(htmlProto, 'offsetTop'),
    };
    const isBox = (el: Element) => el.hasAttribute('data-code');
    Object.defineProperty(elProto, 'clientHeight', {
      configurable: true,
      get(this: Element) {
        return isBox(this) ? 100 : 0;
      },
    });
    Object.defineProperty(elProto, 'scrollHeight', {
      configurable: true,
      get(this: Element) {
        return isBox(this) ? 1000 : 0;
      },
    });
    Object.defineProperty(htmlProto, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const parent = this.parentElement;
        return parent && isBox(parent) ? Array.from(parent.children).indexOf(this) * 10 : 0;
      },
    });
    try {
      runDialog({
        title: 't',
        lines: [],
        codes: [{ label: 'x', text: Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n') }],
      });
      const more = shadow.root()?.querySelector('[data-more]') as HTMLElement | null;
      expect(more?.style.display).toBe('block');
      expect(more?.textContent).toContain('아래에 20줄 더 있어요');
      // Scrolled to the end: nothing is below any more.
      const box = shadow.root()?.querySelector('[data-code]') as HTMLElement;
      box.scrollTop = 900;
      box.dispatchEvent(new Event('scroll'));
      expect(more?.style.display).toBe('none');
    } finally {
      shadow.restore();
      for (const [proto, key, d] of [
        [elProto, 'clientHeight', saved.ch],
        [elProto, 'scrollHeight', saved.sh],
        [htmlProto, 'offsetTop', saved.ot],
      ] as const) {
        if (d) Object.defineProperty(proto, key, d);
        else delete proto[key];
      }
    }
  });

  it('stays linear on long and hostile input', () => {
    const shadow = captureShadow();
    try {
      const hostile = `${'/'.repeat(5000)}${LS}${'"'.repeat(5000)}${'`'.repeat(3)}${'[/'.repeat(3000)}${RLO.repeat(2000)}`;
      const t0 = Date.now();
      runDialog({ title: 't', lines: [], codes: [{ label: 'x', text: hostile }] });
      expect(Date.now() - t0).toBeLessThan(5000);
    } finally {
      shadow.restore();
    }
  });
});

describe('the host element', () => {
  it('gets a fresh random id each time, a stable data attribute, and forced inline style', () => {
    const a = runDialog({ title: 't', lines: [] }).host();
    const b = runDialog({ title: 't', lines: [] }).host();
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
    expect(a?.hasAttribute(CONFIRM_HOST_ATTR)).toBe(true);
    // Only one dialog host is left behind.
    expect(document.querySelectorAll(`[${CONFIRM_HOST_ATTR}]`)).toHaveLength(1);
    expect(a?.style.getPropertyPriority('z-index')).toBe('important');
    expect(a?.style.getPropertyPriority('pointer-events')).toBe('important');
    expect(a?.style.getPropertyPriority('display')).toBe('important');
  });

  it('opens a modal <dialog> in the top layer when the page supports it', () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
    const had = Object.getOwnPropertyDescriptor(proto, 'showModal');
    const opened = vi.fn();
    proto.showModal = opened;
    const shadow = captureShadow();
    try {
      runDialog({ title: 't', lines: [] });
      expect(opened).toHaveBeenCalledTimes(1);
      expect(shadow.root()?.querySelector('dialog button')).not.toBeNull();
    } finally {
      shadow.restore();
      if (had) Object.defineProperty(proto, 'showModal', had);
      else delete proto.showModal;
    }
  });

  it('falls back to a fixed layer when showModal is missing or throws', () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
    const had = Object.getOwnPropertyDescriptor(proto, 'showModal');
    proto.showModal = () => {
      throw new Error('nope');
    };
    const shadow = captureShadow();
    try {
      const { host } = runDialog({ title: 't', lines: [] });
      expect(host()).not.toBeNull();
      expect(shadow.buttons().length).toBe(2);
      delete proto.showModal;
      runDialog({ title: 't', lines: [] });
      expect(shadow.root()?.querySelector('dialog')).toBeNull();
      expect(shadow.buttons().length).toBe(2);
    } finally {
      shadow.restore();
      if (had) Object.defineProperty(proto, 'showModal', had);
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

  it('counts U+2028 as a line break and measures the cap on the evaluated string', () => {
    expect(prepareCode(`a${LS}b`).block.label).toBe('총 3자 · 2줄');
    // Trailing blanks are trimmed for display but still count against the cap.
    expect(prepareCode(`a${' '.repeat(CONFIRM_REFUSE_OVER)}`).tooLong).toBe(true);
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
