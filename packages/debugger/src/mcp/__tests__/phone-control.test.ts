import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleApiCalledEvent } from '../cdp-connection.js';
import {
  buildSessionWarnClearExpression,
  buildSessionWarnExpression,
  createNonceBox,
  createPhoneControlNonce,
  isPhoneControlEvent,
  parsePhoneControl,
} from '../phone-control.js';
import { listConsoleMessages } from '../tools.js';

function consoleEvent(type: string, ...values: unknown[]): ConsoleApiCalledEvent {
  return {
    type,
    args: values.map((value) => ({ type: typeof value, value })),
    timestamp: 1,
  };
}

describe('parsePhoneControl', () => {
  it('reads a kill tap', () => {
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'kill'))).toEqual({ action: 'kill' });
  });

  it('reads an extend tap only with a well-formed nonce', () => {
    const nonce = createPhoneControlNonce();
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'extend', nonce))).toEqual({
      action: 'extend',
      nonce,
    });
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'extend'))).toBeNull();
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'extend', 'zz'))).toBeNull();
  });

  it('ignores other console output and other levels', () => {
    expect(parsePhoneControl(consoleEvent('log', 'ait:ctl', 'kill'))).toBeNull();
    expect(parsePhoneControl(consoleEvent('debug', 'hello'))).toBeNull();
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'reboot'))).toBeNull();
  });
});

describe('control lines stay out of list_console_messages', () => {
  it('filters them and keeps real page output', () => {
    const events = [
      consoleEvent('log', 'page says hi'),
      consoleEvent('debug', 'ait:ctl', 'kill'),
      consoleEvent('debug', 'ait:ctl', 'extend', 'aaaaaaaaaaaaaaaa'),
      consoleEvent('debug', 'plain debug line'),
    ];
    const connection = {
      getBufferedEvents: () => events,
    } as unknown as Parameters<typeof listConsoleMessages>[0];
    expect(events.filter(isPhoneControlEvent)).toHaveLength(2);
    expect(listConsoleMessages(connection).map((m) => m.text)).toEqual([
      'page says hi',
      'plain debug line',
    ]);
  });
});

describe('createNonceBox', () => {
  it('accepts the outstanding nonce once', () => {
    const box = createNonceBox();
    const nonce = box.issue();
    expect(box.consume('0000000000000000')).toBe(false);
    expect(box.consume(nonce)).toBe(true);
    expect(box.consume(nonce)).toBe(false);
  });

  it('a new notice invalidates the previous nonce', () => {
    const box = createNonceBox();
    const first = box.issue();
    const second = box.issue();
    expect(box.consume(first)).toBe(false);
    expect(box.consume(second)).toBe(true);
  });

  it('clear drops the nonce', () => {
    const box = createNonceBox();
    const nonce = box.issue();
    box.clear();
    expect(box.consume(nonce)).toBe(false);
  });
});

describe('session warning notice (page side)', () => {
  const NOTICE_ID = '__ait_session_warn';

  function run(expression: string): unknown {
    // biome-ignore lint/security/noGlobalEval: evaluating the injected IIFE to exercise its DOM behavior.
    const indirectEval = eval;
    return indirectEval(expression);
  }

  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    debugSpy.mockRestore();
  });

  it('shows the notice with a 계속 button and a countdown', () => {
    run(buildSessionWarnExpression({ nonce: 'aaaaaaaaaaaaaaaa', secondsLeft: 60 }));
    const el = document.getElementById(NOTICE_ID);
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('디버거 연결이 곧 끝나요 (60초)');
    expect(el?.querySelector('button')?.textContent).toBe('계속');
    vi.advanceTimersByTime(3000);
    expect(el?.textContent).toContain('(57초)');
  });

  it('a script-made click is not reported', () => {
    run(buildSessionWarnExpression({ nonce: 'abcdef0123456789', secondsLeft: 60 }));
    document.getElementById(NOTICE_ID)?.querySelector('button')?.click();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(document.getElementById(NOTICE_ID)).not.toBeNull();
  });

  it('reports extend for a trusted tap', () => {
    // jsdom cannot mint a trusted event, so the page's click listener is called directly.
    const listeners: Array<(e: { isTrusted: boolean }) => void> = [];
    const add = vi.spyOn(HTMLButtonElement.prototype, 'addEventListener').mockImplementation(((
      type: string,
      listener: (e: { isTrusted: boolean }) => void,
    ) => {
      if (type === 'click') listeners.push(listener);
    }) as never);
    run(buildSessionWarnExpression({ nonce: 'abcdef0123456789', secondsLeft: 60 }));
    add.mockRestore();
    expect(listeners).toHaveLength(1);
    listeners[0]?.({ isTrusted: false });
    expect(debugSpy).not.toHaveBeenCalled();
    listeners[0]?.({ isTrusted: true });
    expect(debugSpy).toHaveBeenCalledWith('ait:ctl', 'extend', 'abcdef0123456789');
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('removes itself when the time is up and when asked to', () => {
    run(buildSessionWarnExpression({ nonce: 'aaaaaaaaaaaaaaaa', secondsLeft: 2 }));
    vi.advanceTimersByTime(2500);
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    run(buildSessionWarnExpression({ nonce: 'aaaaaaaaaaaaaaaa', secondsLeft: 60 }));
    run(buildSessionWarnClearExpression());
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('showing the notice twice leaves one notice', () => {
    run(buildSessionWarnExpression({ nonce: 'aaaaaaaaaaaaaaaa', secondsLeft: 60 }));
    run(buildSessionWarnExpression({ nonce: 'bbbbbbbbbbbbbbbb', secondsLeft: 30 }));
    expect(document.querySelectorAll(`#${NOTICE_ID}`)).toHaveLength(1);
  });

  it('carries no relay address or code', () => {
    const expression = buildSessionWarnExpression({ nonce: 'aaaaaaaaaaaaaaaa', secondsLeft: 60 });
    expect(expression).not.toMatch(/wss?:\/\//);
    expect(expression).not.toMatch(/relay=|at=/);
  });
});
