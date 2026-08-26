import type {
  CreateRuntimeMemoryInput,
  RuntimeMemoryQuery,
} from '@setsuna-desktop/feature-memory/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import {
  memoryScope,
  optionalNumber,
  readBody,
  sendJson,
} from './http-utils.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeMemoryRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/memories') {
    const query: RuntimeMemoryQuery = {
      scope: memoryScope(url.searchParams.get('scope')),
      projectId: url.searchParams.get('projectId') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: optionalNumber(url.searchParams.get('limit')),
    };
    sendJson(response, 200, await runtime.memoryStore.listMemories(query));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/memories/preview') {
    sendJson(response, 200, await runtime.memoryStore.previewMemories());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/memories') {
    const memory = await runtime.memoryStore.rememberMemory(
      await readBody<CreateRuntimeMemoryInput>(request),
    );
    sendJson(response, 201, { memories: [memory] });
    return true;
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/memories') {
    await runtime.memoryStore.clearMemories();
    sendJson(response, 200, { memories: [] });
    return true;
  }

  const memoryMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)$/u);
  if (memoryMatch && request.method === 'DELETE') {
    await runtime.memoryStore.deleteMemory(decodeURIComponent(memoryMatch[1]));
    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}
