/**
 * "Blocked" MCP mode: another live client already owns the debugger lock.
 *
 * Instead of exiting (the client then only shows `CONNECTION_CLOSED`), the
 * daemon still serves MCP over stdio. It advertises the bootstrap tools and
 * answers every call with an error result that tells the user, in Korean, which
 * session holds the debugger and how to get past it.
 *
 * SECRET-HANDLING: the message carries PID and start time only — never the relay
 * host or any lock-file secret.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { installExitTriggers } from './exit-triggers.js';
import type { ServerLockConflictError } from './server-lock.js';
import { BOOTSTRAP_TOOL_NAMES, DEBUG_TOOL_DEFINITIONS } from './tools.js';

declare const __VERSION__: string;

/** Korean explanation returned by every tool in blocked mode. */
export function buildBlockedMessage(conflict: Conflict): string {
  const { existingPid: pid, existingStartedAt: startedAt } = conflict;
  return (
    `다른 Claude Code 세션(PID ${pid}, 시작 ${startedAt})이 이미 debugger를 사용 중이라 이 세션에서는 쓸 수 없습니다.\n` +
    '다음 중 하나를 고르세요.\n' +
    `- 그 세션에서 debugger를 계속 사용합니다.\n` +
    `- 그 세션의 debugger를 끝냅니다: 터미널에서 \`kill ${pid}\`\n` +
    '- 그 세션을 닫은 뒤 이 세션에서 `/mcp`로 ait-devtools를 다시 연결합니다.'
  );
}

type Conflict = Pick<ServerLockConflictError, 'existingPid' | 'existingStartedAt'>;

/** Builds the blocked-mode server (exported so tests can drive it over an in-memory transport). */
export function createBlockedServer(conflict: Conflict): Server {
  const message = buildBlockedMessage(conflict);
  const server = new Server(
    { name: 'ait-debug', version: __VERSION__ },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: DEBUG_TOOL_DEFINITIONS.filter((t) => BOOTSTRAP_TOOL_NAMES.has(t.name)).map((t) => ({
      ...t,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: 'text', text: message }],
    isError: true,
  }));
  return server;
}

export async function runBlockedServer(conflict: Conflict): Promise<void> {
  process.stderr.write(
    `[ait-debug] 다른 세션이 debugger를 사용 중(PID=${conflict.existingPid}) — 차단 모드로 시작합니다. 도구는 안내 에러만 반환합니다.\n`,
  );
  const server = createBlockedServer(conflict);
  installExitTriggers({
    shutdown: async () => {
      await server.close().catch(() => undefined);
    },
    server,
  });
  await server.connect(new StdioServerTransport());
}
