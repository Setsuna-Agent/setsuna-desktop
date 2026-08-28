import type {
  AnswerRuntimeApprovalInput,
  RuntimeMcpServerInput,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeExtensionRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/approvals') {
    sendJson(response, 200, await runtime.approvalGate.listApprovals());
    return true;
  }

  const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/u);
  if (approvalMatch && request.method === 'POST') {
    await runtime.approvalGate.answerApproval(
      decodeURIComponent(approvalMatch[1]),
      await readBody<AnswerRuntimeApprovalInput>(request),
    );
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/mcp/servers') {
    sendJson(
      response,
      200,
      await runtime.mcpControl.listServers({ includeAuthStatus: true }),
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/tools') {
    const input = await readBody<RuntimeMcpServerInput>(request);
    const serverKey = normalizeMcpServerKey(input.key);
    sendJson(
      response,
      200,
      await runtime.mcpControl.discoverTools({ ...input, key: serverKey }),
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/servers') {
    const input = await readBody<RuntimeMcpServerInput>(request);
    const key = normalizeMcpServerKey(input.key);
    await runtime.mcpControl.upsertServer({ ...input, key });
    sendJson(response, 201, await runtime.mcpControl.listServers({ includeAuthStatus: true }));
    return true;
  }

  const mcpServerMatch = url.pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/u);
  if (mcpServerMatch && request.method === 'PATCH') {
    const serverKey = normalizeMcpServerKey(
      decodeURIComponent(mcpServerMatch[1]),
    );
    await runtime.mcpControl.updateServer(
      serverKey,
      await readBody<RuntimeMcpServerPatch>(request),
    );
    sendJson(response, 200, await runtime.mcpControl.listServers({ includeAuthStatus: true }));
    return true;
  }
  if (mcpServerMatch && request.method === 'DELETE') {
    const serverKey = normalizeMcpServerKey(
      decodeURIComponent(mcpServerMatch[1]),
    );
    await runtime.mcpControl.deleteServer(serverKey);
    sendJson(response, 200, { ok: true });
    return true;
  }

  const mcpOAuthMatch = url.pathname.match(
    /^\/v1\/mcp\/servers\/([^/]+)\/oauth\/(login|logout)$/u,
  );
  if (mcpOAuthMatch && request.method === 'POST') {
    const serverKey = normalizeMcpServerKey(
      decodeURIComponent(mcpOAuthMatch[1]),
    );
    const server = (await runtime.mcpStore.listServerInputs())
      .find((item) => item.key === serverKey);
    if (!server) {
      throw new RuntimeHttpError(
        404,
        `MCP server not found: ${serverKey}`,
        'mcp_server_not_found',
      );
    }
    if (mcpOAuthMatch[2] === 'logout') {
      await runtime.mcpControl.logout(serverKey);
    } else {
      const abort = new AbortController();
      request.once(
        'aborted',
        () => abort.abort(new Error('MCP OAuth login request disconnected.')),
      );
      await runtime.mcpControl.login(serverKey, { signal: abort.signal });
    }
    sendJson(
      response,
      200,
      await runtime.mcpControl.listServers({ includeAuthStatus: true }),
    );
    return true;
  }

  return false;
}

function normalizeMcpServerKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!key) {
    throw new RuntimeHttpError(
      400,
      'MCP server key is required.',
      'invalid_mcp_server_key',
    );
  }
  return key;
}
