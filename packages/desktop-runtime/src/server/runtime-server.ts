import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL } from 'node:url';
import type {
  AnswerRuntimeApprovalInput,
  CreateRuntimeMemoryInput,
  RuntimeMcpServerInput,
  RuntimeMcpServerPatch,
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeMemoryQuery,
  RuntimeHealth,
  RuntimeFetchModelsInput,
  RuntimeUsageQuery,
  SendTurnInput,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { fetchAvailableModels } from '../adapters/model/model-discovery.js';
import { createRuntimeFactory } from '../runtime/runtime-factory.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export type RuntimeServerOptions = {
  dataDir: string;
  token: string;
  version: string;
};

export type RuntimeServer = {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  address(): string | AddressInfo | null;
};

export async function createRuntimeServer(options: RuntimeServerOptions): Promise<RuntimeServer> {
  const startedAt = new Date().toISOString();
  const runtime = createRuntimeFactory({ dataDir: options.dataDir });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'setsuna-desktop-runtime',
          startedAt,
          version: options.version,
        } satisfies RuntimeHealth);
        return;
      }

      if (!isAuthorized(request, options.token)) {
        sendJson(response, 401, { error: 'Unauthorized' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/config') {
        sendJson(response, 200, await runtime.configStore.getConfig());
        return;
      }

      if (request.method === 'PUT' && url.pathname === '/v1/config') {
        sendJson(response, 200, await runtime.configStore.saveConfig(await readBody(request)));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/config/models') {
        const input = await readBody<RuntimeFetchModelsInput>(request, {});
        const activeProvider = await runtime.configStore.getActiveProviderConfig();
        const savedProvider = !input.providerId || activeProvider?.id === input.providerId ? activeProvider : null;
        sendJson(response, 200, { models: await fetchAvailableModels(input, savedProvider) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/threads') {
        const query: ThreadQuery = {
          search: url.searchParams.get('search') ?? undefined,
          includeArchived: url.searchParams.get('includeArchived') === 'true',
          scope: threadScope(url.searchParams.get('scope')),
          projectId: url.searchParams.get('projectId') ?? undefined,
        };
        sendJson(response, 200, { threads: await runtime.threadStore.listThreads(query) });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/skills') {
        sendJson(response, 200, await runtime.skillRegistry.listSkills());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/skills') {
        sendJson(response, 201, await runtime.skillRegistry.createSkill(await readBody(request)));
        return;
      }

      const skillMatch = url.pathname.match(/^\/v1\/skills\/([^/]+)$/);
      if (skillMatch && request.method === 'GET') {
        const skill = await runtime.skillRegistry.getSkill(decodeURIComponent(skillMatch[1]));
        if (!skill) {
          sendJson(response, 404, { error: 'Skill not found' });
          return;
        }
        sendJson(response, 200, skill);
        return;
      }

      if (skillMatch && request.method === 'PATCH') {
        const skill = await runtime.skillRegistry.updateSkill(decodeURIComponent(skillMatch[1]), await readBody(request));
        sendJson(response, 200, skill);
        return;
      }

      if (skillMatch && request.method === 'DELETE') {
        await runtime.skillRegistry.deleteSkill(decodeURIComponent(skillMatch[1]));
        sendJson(response, 204, {});
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/projects') {
        sendJson(response, 200, await runtime.workspaceProjects.listProjects());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/projects') {
        sendJson(response, 201, await runtime.workspaceProjects.addProject(await readBody(request)));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/workspace/status') {
        sendJson(response, 200, await runtime.workspaceProjects.getStatus(url.searchParams.get('projectId') ?? undefined));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        const query: RuntimeUsageQuery = {
          threadId: url.searchParams.get('threadId') ?? undefined,
          limit: optionalNumber(url.searchParams.get('limit')),
        };
        sendJson(response, 200, await runtime.usageStore.getUsage(query));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/approvals') {
        sendJson(response, 200, await runtime.approvalGate.listApprovals());
        return;
      }

      const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
      if (approvalMatch && request.method === 'POST') {
        await runtime.approvalGate.answerApproval(
          decodeURIComponent(approvalMatch[1]),
          await readBody<AnswerRuntimeApprovalInput>(request),
        );
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memories') {
        const query: RuntimeMemoryQuery = {
          scope: memoryScope(url.searchParams.get('scope')),
          projectId: url.searchParams.get('projectId') ?? undefined,
          search: url.searchParams.get('search') ?? undefined,
          limit: optionalNumber(url.searchParams.get('limit')),
        };
        sendJson(response, 200, await runtime.memoryStore.listMemories(query));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/memories/preview') {
        sendJson(response, 200, await runtime.memoryStore.previewMemories());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/memories') {
        const memory = await runtime.memoryStore.rememberMemory(await readBody<CreateRuntimeMemoryInput>(request));
        sendJson(response, 201, { memories: [memory] });
        return;
      }

      if (request.method === 'DELETE' && url.pathname === '/v1/memories') {
        await runtime.memoryStore.clearMemories();
        sendJson(response, 200, { memories: [] });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/mcp/servers') {
        sendJson(response, 200, await runtime.mcpStore.listServers());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/mcp/servers') {
        sendJson(response, 201, await runtime.mcpStore.upsertServer(await readBody<RuntimeMcpServerInput>(request)));
        return;
      }

      const mcpServerMatch = url.pathname.match(/^\/v1\/mcp\/servers\/([^/]+)$/);
      if (mcpServerMatch && request.method === 'PATCH') {
        sendJson(
          response,
          200,
          await runtime.mcpStore.updateServer(
            decodeURIComponent(mcpServerMatch[1]),
            await readBody<RuntimeMcpServerPatch>(request),
          ),
        );
        return;
      }

      if (mcpServerMatch && request.method === 'DELETE') {
        await runtime.mcpStore.deleteServer(decodeURIComponent(mcpServerMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const memoryMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)$/);
      if (memoryMatch && request.method === 'DELETE') {
        await runtime.memoryStore.deleteMemory(decodeURIComponent(memoryMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
      if (projectMatch && request.method === 'DELETE') {
        await runtime.workspaceProjects.removeProject(decodeURIComponent(projectMatch[1]));
        sendJson(response, 200, { ok: true });
        return;
      }

      const projectFilesMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/files$/);
      if (projectFilesMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.listEntries(
            decodeURIComponent(projectFilesMatch[1]),
            url.searchParams.get('path') ?? '.',
          ),
        );
        return;
      }

      const projectEntriesSearchMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/entries\/search$/);
      if (projectEntriesSearchMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.searchEntries(
            decodeURIComponent(projectEntriesSearchMatch[1]),
            url.searchParams.get('q') ?? '',
            url.searchParams.has('parent') ? url.searchParams.get('parent') : undefined,
          ),
        );
        return;
      }

      const projectReadMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/read$/);
      if (projectReadMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.readFile(
            decodeURIComponent(projectReadMatch[1]),
            url.searchParams.get('path') ?? '',
          ),
        );
        return;
      }

      const projectSearchMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)\/search$/);
      if (projectSearchMatch && request.method === 'GET') {
        sendJson(
          response,
          200,
          await runtime.workspaceProjects.search(
            decodeURIComponent(projectSearchMatch[1]),
            url.searchParams.get('q') ?? '',
          ),
        );
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/threads') {
        const thread = await runtime.threadStore.createThread(await readBody<CreateThreadInput>(request, {}));
        sendJson(response, 201, thread);
        return;
      }

      const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/);
      if (threadMatch && request.method === 'GET') {
        const thread = await runtime.threadStore.getThread(decodeURIComponent(threadMatch[1]));
        if (!thread) {
          sendJson(response, 404, { error: 'Thread not found' });
          return;
        }
        sendJson(response, 200, thread);
        return;
      }

      if (threadMatch && request.method === 'PATCH') {
        const thread = await runtime.threadStore.updateThread(
          decodeURIComponent(threadMatch[1]),
          await readBody<ThreadPatch>(request),
        );
        sendJson(response, 200, thread);
        return;
      }

      const messageMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)$/);
      if (messageMatch && request.method === 'PATCH') {
        const threadId = decodeURIComponent(messageMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.updateMessage(
          threadId,
          decodeURIComponent(messageMatch[2]),
          await readBody<MessagePatch>(request),
        );
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === 'DELETE') {
        const threadId = decodeURIComponent(messagesMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.deleteMessages(threadId, await readBody<MessageDeleteInput>(request));
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const regenerateMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)\/regenerate$/);
      if (regenerateMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(regenerateMatch[1]);
        const input = await readBody<RegenerateMessageInput>(request, {});
        sendJson(
          response,
          202,
          await runtime.agentLoop.regenerateFromMessage(threadId, decodeURIComponent(regenerateMatch[2]), {
            content: typeof input.content === 'string' ? input.content : undefined,
            skillIds: Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === 'string') : [],
            thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
            thinkingEffort: stringInput((input as { thinking_effort?: unknown }).thinking_effort ?? input.thinkingEffort),
          }),
        );
        return;
      }

      const clearContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context$/);
      if (clearContextMatch && request.method === 'DELETE') {
        const threadId = decodeURIComponent(clearContextMatch[1]);
        const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
        const thread = await runtime.threadStore.clearThreadMessages(threadId);
        await publishThreadEventsSince(runtime, threadId, beforeSeq);
        sendJson(response, 200, thread);
        return;
      }

      const compactContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context\/compact$/);
      if (compactContextMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(compactContextMatch[1]);
        sendJson(response, 200, await runtime.agentLoop.compactThreadContext(threadId, true));
        return;
      }

      const turnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/);
      if (turnMatch && request.method === 'POST') {
        const threadId = decodeURIComponent(turnMatch[1]);
        const input = await readBody<{ attachments?: unknown; input?: unknown; skillIds?: unknown; thinking?: unknown; thinkingEffort?: unknown; thinking_effort?: unknown }>(request);
        const text = typeof input.input === 'string' ? input.input : '';
        const skillIds = Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === 'string') : [];
        const attachments: SendTurnInput['attachments'] = Array.isArray(input.attachments)
          ? input.attachments.filter(isRuntimeMessageAttachment)
          : [];
        sendJson(response, 202, await runtime.agentLoop.startTurn(threadId, {
          attachments,
          input: text,
          skillIds,
          thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
          thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
        } satisfies SendTurnInput));
        return;
      }

      const cancelTurnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/);
      if (cancelTurnMatch && request.method === 'POST') {
        const cancelled = await runtime.agentLoop.cancelTurn(
          decodeURIComponent(cancelTurnMatch[1]),
          decodeURIComponent(cancelTurnMatch[2]),
        );
        sendJson(response, 200, { ok: true, cancelled });
        return;
      }

      const eventsMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/);
      if (eventsMatch && request.method === 'GET') {
        const threadId = decodeURIComponent(eventsMatch[1]);
        const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0') || 0;
        await handleSse({
          response,
          threadId,
          sinceSeq,
          runtime,
        });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    listen: (port) => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    address: () => server.address(),
  };
}

async function handleSse({
  response,
  threadId,
  sinceSeq,
  runtime,
}: {
  response: ServerResponse;
  threadId: string;
  sinceSeq: number;
  runtime: ReturnType<typeof createRuntimeFactory>;
}): Promise<void> {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const existing = await runtime.threadStore.listEvents(threadId, sinceSeq);
  for (const event of existing) writeSse(response, event);

  const unsubscribe = runtime.eventBus.subscribe(threadId, (event) => writeSse(response, event));
  response.on('close', unsubscribe);
}

async function publishThreadEventsSince(
  runtime: ReturnType<typeof createRuntimeFactory>,
  threadId: string,
  sinceSeq: number,
): Promise<void> {
  const events = await runtime.threadStore.listEvents(threadId, sinceSeq);
  for (const event of events) runtime.eventBus.publish(event);
}

function writeSse(response: ServerResponse, value: unknown): void {
  response.write('event: runtime-event\n');
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readBody<T = unknown>(request: IncomingMessage, fallback?: T): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  if (!chunks.length) {
    if (fallback !== undefined) return fallback;
    return {} as T;
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function optionalNumber(value: string | null): number | undefined {
  if (value === null || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function memoryScope(value: string | null): 'global' | 'project' | undefined {
  if (value === 'global' || value === 'project') return value;
  return undefined;
}

function threadScope(value: string | null): ThreadQuery['scope'] {
  if (value === 'all' || value === 'global' || value === 'project') return value;
  return undefined;
}

function isRuntimeMessageAttachment(value: unknown): value is NonNullable<SendTurnInput['attachments']>[number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.size === 'number' &&
    Number.isFinite(record.size) &&
    typeof record.url === 'string'
  );
}

function stringInput(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
