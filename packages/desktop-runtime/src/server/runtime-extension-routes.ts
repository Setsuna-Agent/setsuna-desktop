import type {
  AnswerRuntimeApprovalInput,
  RuntimeMcpServerInput,
  RuntimeMcpServerList,
  RuntimeMcpServerPatch,
} from '@setsuna-desktop/contracts';
import {
  mergeRuntimeMcpServerInput,
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
  if (request.method === 'GET' && url.pathname === '/v1/skills') {
    sendJson(response, 200, await runtime.skillRegistry.listSkills());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/skills') {
    sendJson(
      response,
      201,
      await runtime.skillRegistry.createSkill(await readBody(request)),
    );
    return true;
  }

  const skillDependencyInstallMatch = url.pathname.match(
    /^\/v1\/skills\/([^/]+)\/mcp-dependencies\/install$/u,
  );
  if (skillDependencyInstallMatch && request.method === 'POST') {
    sendJson(response, 200, await runtime.skillRegistry.installMcpDependencies(
      decodeURIComponent(skillDependencyInstallMatch[1]),
    ));
    return true;
  }

  const skillDependencyLoginMatch = url.pathname.match(
    /^\/v1\/skills\/([^/]+)\/mcp-dependencies\/([^/]+)\/login$/u,
  );
  if (skillDependencyLoginMatch && request.method === 'POST') {
    sendJson(
      response,
      200,
      await runtime.skillRegistry.authenticateMcpDependency(
        decodeURIComponent(skillDependencyLoginMatch[1]),
        decodeURIComponent(skillDependencyLoginMatch[2]),
      ),
    );
    return true;
  }

  const skillMatch = url.pathname.match(/^\/v1\/skills\/([^/]+)$/u);
  if (skillMatch && request.method === 'GET') {
    const skill = await runtime.skillRegistry.getSkill(
      decodeURIComponent(skillMatch[1]),
    );
    if (!skill) {
      sendJson(response, 404, { error: 'Skill not found' });
      return true;
    }
    sendJson(response, 200, skill);
    return true;
  }
  if (skillMatch && request.method === 'PATCH') {
    sendJson(
      response,
      200,
      await runtime.skillRegistry.updateSkill(
        decodeURIComponent(skillMatch[1]),
        await readBody(request),
      ),
    );
    return true;
  }
  if (skillMatch && request.method === 'DELETE') {
    await runtime.skillRegistry.deleteSkill(decodeURIComponent(skillMatch[1]));
    sendJson(response, 204, {});
    return true;
  }

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
      await withMcpAuthStatuses(runtime, await runtime.mcpStore.listServers()),
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/tools') {
    const input = await readBody<RuntimeMcpServerInput>(request);
    const serverKey = normalizeMcpServerKey(input.key);
    const existing = (await runtime.mcpStore.listServerInputs())
      .find((server) => server.key === serverKey);
    sendJson(
      response,
      200,
      await runtime.mcpConnections.discoverTools(
        mergeRuntimeMcpServerInput(existing, input),
        { scopeId: `discovery:${serverKey}` },
      ),
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/servers') {
    const input = await readBody<RuntimeMcpServerInput>(request);
    const key = normalizeMcpServerKey(input.key);
    const result = await runtime.mcpStore.upsertServer(input);
    await runtime.mcpConnections.invalidateServer(key);
    sendJson(response, 201, await withMcpAuthStatuses(runtime, result));
    return true;
  }

  const mcpServerMatch = url.pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/u);
  if (mcpServerMatch && request.method === 'PATCH') {
    const serverKey = normalizeMcpServerKey(
      decodeURIComponent(mcpServerMatch[1]),
    );
    const result = await runtime.mcpStore.updateServer(
      serverKey,
      await readBody<RuntimeMcpServerPatch>(request),
    );
    await runtime.mcpConnections.invalidateServer(serverKey);
    sendJson(response, 200, await withMcpAuthStatuses(runtime, result));
    return true;
  }
  if (mcpServerMatch && request.method === 'DELETE') {
    const serverKey = normalizeMcpServerKey(
      decodeURIComponent(mcpServerMatch[1]),
    );
    await runtime.mcpStore.deleteServer(serverKey);
    await runtime.mcpConnections.invalidateServer(serverKey);
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
      await runtime.mcpConnections.logout(server);
    } else {
      const abort = new AbortController();
      request.once(
        'aborted',
        () => abort.abort(new Error('MCP OAuth login request disconnected.')),
      );
      await runtime.mcpConnections.login(server, { signal: abort.signal });
    }
    sendJson(
      response,
      200,
      await withMcpAuthStatuses(runtime, await runtime.mcpStore.listServers()),
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

async function withMcpAuthStatuses(
  runtime: RuntimeFactory,
  list: RuntimeMcpServerList,
): Promise<RuntimeMcpServerList> {
  return {
    ...list,
    servers: await Promise.all(list.servers.map(async (server) => {
      const auth = await runtime.mcpConnections.authStatus(server);
      return {
        ...server,
        authStatus: auth.status,
        ...(auth.error ? { authError: auth.error } : {}),
      };
    })),
  };
}
