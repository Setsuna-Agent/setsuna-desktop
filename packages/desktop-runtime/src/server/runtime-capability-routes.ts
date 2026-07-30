import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import {
  callRuntimeMcpServerTool,
  listRuntimeHooks,
  listRuntimeMcpServerStatuses,
  readRuntimeMcpServerResource,
  setRuntimeSkillExtraRoots,
} from '../runtime/use-cases/capability-operations.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

/**
 * First-party capability queries and commands. Protocol-specific parsing stays
 * here while the runtime behavior is shared with app-server adapters.
 */
export async function handleRuntimeCapabilityRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/hooks') {
    sendJson(
      response,
      200,
      await listRuntimeHooks(runtime, url.searchParams.getAll('cwd')),
    );
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/v1/skills/extra-roots') {
    const input = await readBody<{ extraRoots?: unknown }>(request);
    await setRuntimeSkillExtraRoots(runtime, input.extraRoots);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/mcp/statuses') {
    sendJson(response, 200, await listRuntimeMcpServerStatuses(runtime, 'full'));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/resources/read') {
    sendJson(
      response,
      200,
      await readRuntimeMcpServerResource(runtime, await readBody(request)),
    );
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/tools/call') {
    sendJson(
      response,
      200,
      await callRuntimeMcpServerTool(runtime, await readBody(request)),
    );
    return true;
  }

  return false;
}
