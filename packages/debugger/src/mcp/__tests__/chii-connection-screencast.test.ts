/** `Page.screencastFrame` is delivered to live subscribers and never buffered. */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ChiiCdpConnection } from '../chii-connection.js';
import { TEST_RELAY_SECRET } from './relay-test-auth.js';

// ---- Fake relay helpers (same pattern as chii-connection.test.ts) -----------

interface FakeRelay {
  baseUrl: string;
  sendToClient(msg: object): void;
  close(): Promise<void>;
}

async function createFakeRelay(): Promise<FakeRelay> {
  let clientSocket: import('ws').WebSocket | null = null;
  const pendingOutbound: string[] = [];

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/targets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          targets: [{ id: 'target-1', title: 'Test Mini-App', url: 'http://localhost/' }],
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    clientSocket = ws;
    for (const msg of pendingOutbound) ws.send(msg);
    pendingOutbound.length = 0;
    ws.on('close', () => {
      clientSocket = null;
    });
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    sendToClient(msg: object) {
      const raw = JSON.stringify(msg);
      if (clientSocket) {
        clientSocket.send(raw);
      } else {
        pendingOutbound.push(raw);
      }
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

/** Waits until `predicate()` returns true (polling 20 ms) or times out. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise<void>((r) => setTimeout(r, 20));
  }
}

describe('ChiiCdpConnection — Page.screencastFrame', () => {
  it('emits the frame to live subscribers', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      totpSecret: TEST_RELAY_SECRET,
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 500,
    });
    try {
      await conn.enableDomains();
      const frames: Array<{ data: string; sessionId: number }> = [];
      const off = conn.onTransient('Page.screencastFrame', (f) => frames.push(f));
      relay.sendToClient({
        method: 'Page.screencastFrame',
        params: { data: 'AAAA', sessionId: 3, metadata: {} },
      });
      await waitFor(() => frames.length === 1);
      expect(frames[0]).toMatchObject({ data: 'AAAA', sessionId: 3 });
      off();
    } finally {
      conn.close();
      await relay.close();
    }
  });
});
