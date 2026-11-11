/**
 * The dashboard's session controls: the control section, its state in the SSE frames and
 * `POST /action` (연결 끊기 / 새 QR) with its cookie, header and origin checks.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  DashboardAction,
  DashboardActionResult,
  DashboardControl,
  DashboardState,
} from '../qr-http-server.js';
import { startQrHttpServer } from './dashboard-auth-helper.js';

process.env.AIT_DEBUG_HTTP_PORT = '0';

const control: DashboardControl = {
  armed: false,
  armedUntil: null,
  attached: 1,
  expiresAt: 1_900_000_000_000,
  warning: false,
  lastEnd: null,
  claims: [
    { kind: 'contested', at: 1_900_000_000_000, device: 'abcd1234', ua: 'android', country: 'US' },
  ],
  tunnelIdleClosed: false,
};

function stateWith(c: DashboardControl | null | undefined): DashboardState {
  return {
    tunnel: { up: true, wssUrl: null },
    pages: [],
    attachUrl: null,
    phase: 'active',
    ...(c === undefined ? {} : { control: c }),
  };
}

async function withServer<T>(
  state: DashboardState,
  onAction:
    | ((a: DashboardAction) => DashboardActionResult | Promise<DashboardActionResult>)
    | undefined,
  run: (base: string) => Promise<T>,
): Promise<T> {
  const srv = await startQrHttpServer(() => state, onAction === undefined ? {} : { onAction });
  try {
    return await run(`http://127.0.0.1:${srv.port}`);
  } finally {
    await srv.close();
  }
}

const post = (base: string, body: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ait-Dash': '1', ...headers },
    body,
  });

describe('POST /action', () => {
  it('runs kill and new-qr and returns the handler result', async () => {
    const onAction = vi.fn<(a: DashboardAction) => DashboardActionResult>(() => ({ ok: true }));
    await withServer(stateWith(control), onAction, async (base) => {
      const res = await post(base, JSON.stringify({ action: 'kill' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      await post(base, JSON.stringify({ action: 'new-qr' }));
    });
    expect(onAction.mock.calls.map(([a]) => a)).toEqual(['kill', 'new-qr']);
  });

  it('passes a refusal through (no app address known yet)', async () => {
    await withServer(
      stateWith(control),
      () => ({ ok: false, reason: 'no-scheme' }),
      async (base) => {
        const res = await post(base, JSON.stringify({ action: 'new-qr' }));
        expect(await res.json()).toEqual({ ok: false, reason: 'no-scheme' });
      },
    );
  });

  it('turns a throwing handler into a failure result', async () => {
    await withServer(
      stateWith(control),
      () => {
        throw new Error('boom');
      },
      async (base) => {
        const res = await post(base, JSON.stringify({ action: 'kill' }));
        expect(await res.json()).toEqual({ ok: false, reason: 'failed' });
      },
    );
  });

  it('refuses a request without the dashboard header', async () => {
    const onAction = vi.fn(() => ({ ok: true }) as const);
    await withServer(stateWith(control), onAction, async (base) => {
      const res = await fetch(`${base}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'kill' }),
      });
      expect(res.status).toBe(403);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('refuses a request without the dashboard cookie', async () => {
    const onAction = vi.fn(() => ({ ok: true }) as const);
    await withServer(stateWith(control), onAction, async (base) => {
      const res = await post(base, JSON.stringify({ action: 'kill' }), { 'x-test-no-auth': '1' });
      expect(res.status).toBe(403);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin request even with the cookie and header', async () => {
    const onAction = vi.fn(() => ({ ok: true }) as const);
    await withServer(stateWith(control), onAction, async (base) => {
      const res = await post(base, JSON.stringify({ action: 'kill' }), {
        Origin: 'https://evil.example',
      });
      expect(res.status).toBe(403);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('rejects unknown actions, malformed bodies and oversized bodies', async () => {
    const onAction = vi.fn(() => ({ ok: true }) as const);
    await withServer(stateWith(control), onAction, async (base) => {
      expect((await post(base, JSON.stringify({ action: 'reboot' }))).status).toBe(400);
      expect((await post(base, 'not json')).status).toBe(400);
      expect(
        (await post(base, JSON.stringify({ action: 'kill', pad: 'x'.repeat(1000) }))).status,
      ).toBe(413);
    });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('is not served without a handler or by GET', async () => {
    await withServer(stateWith(control), undefined, async (base) => {
      expect((await post(base, JSON.stringify({ action: 'kill' }))).status).toBe(404);
    });
    await withServer(
      stateWith(control),
      () => ({ ok: true }),
      async (base) => {
        expect((await fetch(`${base}/action`)).status).toBe(404);
      },
    );
  });
});

describe('control section', () => {
  it('is rendered with its buttons when the state carries control', async () => {
    await withServer(
      stateWith(control),
      () => ({ ok: true }),
      async (base) => {
        const html = await (await fetch(`${base}/?lang=ko`)).text();
        expect(html).toContain('id="ait-control"');
        expect(html).toContain('id="ait-control-kill"');
        expect(html).toContain('id="ait-control-newqr"');
        expect(html).toContain('연결 끊기');
        // The snapshot rides in the page for the first paint; it has no address or code.
        expect(html).toContain('"tunnelIdleClosed":false');
      },
    );
  });

  it('is absent for a state without control (test runner, unplugin host)', async () => {
    await withServer(stateWith(undefined), undefined, async (base) => {
      const html = await (await fetch(`${base}/?lang=ko`)).text();
      expect(html).not.toContain('id="ait-control"');
    });
  });

  it('is hidden when control is null', async () => {
    await withServer(stateWith(null), undefined, async (base) => {
      const html = await (await fetch(`${base}/?lang=ko`)).text();
      expect(html).toContain('id="ait-control"');
      expect(html).toContain('render(INIT)');
    });
  });

  it('follows the live SSE frames', async () => {
    await withServer(stateWith(control), undefined, async (base) => {
      const res = await fetch(`${base}/events?v=2`);
      const reader = res.body?.getReader();
      const chunk = await reader?.read();
      await reader?.cancel();
      const frame = new TextDecoder().decode(chunk?.value);
      const payload = JSON.parse(frame.replace(/^data: /, '').trim());
      expect(payload.control).toMatchObject({ attached: 1, warning: false });
      expect(payload.control.claims[0]).toMatchObject({ kind: 'contested', ua: 'android' });
    });
  });

  it('the page script forwards each frame to the control script', async () => {
    await withServer(stateWith(control), undefined, async (base) => {
      const html = await (await fetch(`${base}/?lang=ko`)).text();
      expect(html).toContain("'ait-dash-state'");
      expect(html).toContain("fetch('/action'");
      expect(html).toContain("'X-Ait-Dash':'1'");
    });
  });
});
