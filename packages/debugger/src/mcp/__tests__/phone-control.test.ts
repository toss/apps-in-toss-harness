import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleApiCalledEvent } from '../cdp-connection.js';
import {
  buildRescanNoticeExpression,
  buildSessionWarnClearExpression,
  buildSessionWarnExpression,
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

  it('ignores an extend message', () => {
    expect(
      parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'extend', 'abcdef0123456789')),
    ).toBeNull();
    expect(parsePhoneControl(consoleEvent('debug', 'ait:ctl', 'extend'))).toBeNull();
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

  it('shows the notice with a countdown and no action', () => {
    run(buildSessionWarnExpression({ secondsLeft: 60 }));
    const el = document.getElementById(NOTICE_ID);
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('디버거 연결이 곧 끝나요 (60초)');
    expect(el?.querySelector('button')).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(el?.textContent).toContain('(57초)');
  });

  it('removes itself when the time is up and when asked to', () => {
    run(buildSessionWarnExpression({ secondsLeft: 2 }));
    vi.advanceTimersByTime(2500);
    expect(document.getElementById(NOTICE_ID)).toBeNull();
    run(buildSessionWarnExpression({ secondsLeft: 60 }));
    run(buildSessionWarnClearExpression());
    expect(document.getElementById(NOTICE_ID)).toBeNull();
  });

  it('showing the notice twice leaves one notice', () => {
    run(buildSessionWarnExpression({ secondsLeft: 60 }));
    run(buildSessionWarnExpression({ secondsLeft: 30 }));
    expect(document.querySelectorAll(`#${NOTICE_ID}`)).toHaveLength(1);
  });

  it('carries no relay address or code', () => {
    const expression = buildSessionWarnExpression({ secondsLeft: 60 });
    expect(expression).not.toMatch(/wss?:\/\//);
    expect(expression).not.toMatch(/relay=|at=/);
  });
});

describe('new-QR notice expression', () => {
  it('publishes the window and fires ait:rescan, with nothing else', () => {
    const expr = buildRescanNoticeExpression({ armedUntil: 1_700_000_123_456.7, windowMs: 60_000 });
    const events: string[] = [];
    const win = {
      __ait_rescan: undefined as unknown,
      dispatchEvent: (e: { type: string }) => events.push(e.type),
    };
    new Function('window', 'Event', `return ${expr}`)(
      win,
      class {
        constructor(public type: string) {}
      },
    );
    expect(win.__ait_rescan).toEqual({ armedUntil: 1_700_000_123_457, windowMs: 60_000 });
    expect(events).toEqual(['ait:rescan']);
    expect(expr).not.toMatch(/https?:|wss?:|vConsole/i);
  });
});
