import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type {
  AnswerRuntimeApprovalInput,
  CreateRuntimeMemoryInput,
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeFetchModelsInput,
  RuntimeMcpServerInput,
  RuntimeMcpServerPatch,
  RuntimeMemoryQuery,
  RuntimeUsageQuery,
  SendTurnInput,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { fetchMcpServerTools } from '../adapters/mcp/mcp-tool-discovery.js';
import { fetchAvailableModels } from '../adapters/model/model-discovery.js';
import { stringInput } from './app-server/input.js';
import { isRuntimeMessageAttachment, memoryScope, optionalNumber, readBody, sendJson, threadScope } from './http-utils.js';
import { cancelRuntimeTurn } from './runtime-thread-events.js';
import { handleSse, publishThreadEventsSince, runtimeEventStreamFormat } from './sse.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeRestRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/config') {
    sendJson(response, 200, await runtime.configStore.getConfig());
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/v1/config') {
    sendJson(response, 200, await runtime.configStore.saveConfig(await readBody(request)));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/config/models') {
    const input = await readBody<RuntimeFetchModelsInput>(request, {});
    const activeProvider = await runtime.configStore.getActiveProviderConfig();
    const savedProvider = !input.providerId || activeProvider?.id === input.providerId ? activeProvider : null;
    sendJson(response, 200, { models: await fetchAvailableModels(input, savedProvider) });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/threads') {
    const query: ThreadQuery = {
      search: url.searchParams.get('search') ?? undefined,
      includeArchived: url.searchParams.get('includeArchived') === 'true',
      scope: threadScope(url.searchParams.get('scope')),
      projectId: url.searchParams.get('projectId') ?? undefined,
    };
    sendJson(response, 200, { threads: await runtime.threadStore.listThreads(query) });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/skills') {
    sendJson(response, 200, await runtime.skillRegistry.listSkills());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/skills') {
    sendJson(response, 201, await runtime.skillRegistry.createSkill(await readBody(request)));
    return true;
  }

  const skillMatch = url.pathname.match(/^\/v1\/skills\/([^/]+)$/);
  if (skillMatch && request.method === 'GET') {
    const skill = await runtime.skillRegistry.getSkill(decodeURIComponent(skillMatch[1]));
    if (!skill) {
      sendJson(response, 404, { error: 'Skill not found' });
      return true;
    }
    sendJson(response, 200, skill);
    return true;
  }

  if (skillMatch && request.method === 'PATCH') {
    const skill = await runtime.skillRegistry.updateSkill(decodeURIComponent(skillMatch[1]), await readBody(request));
    sendJson(response, 200, skill);
    return true;
  }

  if (skillMatch && request.method === 'DELETE') {
    await runtime.skillRegistry.deleteSkill(decodeURIComponent(skillMatch[1]));
    sendJson(response, 204, {});
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/projects') {
    sendJson(response, 200, await runtime.workspaceProjects.listProjects());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/projects') {
    sendJson(response, 201, await runtime.workspaceProjects.addProject(await readBody(request)));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/workspace/status') {
    sendJson(response, 200, await runtime.workspaceProjects.getStatus(url.searchParams.get('projectId') ?? undefined));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/usage') {
    const query: RuntimeUsageQuery = {
      threadId: url.searchParams.get('threadId') ?? undefined,
      limit: optionalNumber(url.searchParams.get('limit')),
    };
    sendJson(response, 200, await runtime.usageStore.getUsage(query));
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/approvals') {
    sendJson(response, 200, await runtime.approvalGate.listApprovals());
    return true;
  }

  const approvalMatch = url.pathname.match(/^\/v1\/approvals\/([^/]+)$/);
  if (approvalMatch && request.method === 'POST') {
    await runtime.approvalGate.answerApproval(
      decodeURIComponent(approvalMatch[1]),
      await readBody<AnswerRuntimeApprovalInput>(request),
    );
    sendJson(response, 200, { ok: true });
    return true;
  }

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
    const memory = await runtime.memoryStore.rememberMemory(await readBody<CreateRuntimeMemoryInput>(request));
    sendJson(response, 201, { memories: [memory] });
    return true;
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/memories') {
    await runtime.memoryStore.clearMemories();
    sendJson(response, 200, { memories: [] });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/mcp/servers') {
    sendJson(response, 200, await runtime.mcpStore.listServers());
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/tools') {
    sendJson(response, 200, await fetchMcpServerTools(await readBody<RuntimeMcpServerInput>(request)));
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/mcp/servers') {
    sendJson(response, 201, await runtime.mcpStore.upsertServer(await readBody<RuntimeMcpServerInput>(request)));
    return true;
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
    return true;
  }

  if (mcpServerMatch && request.method === 'DELETE') {
    await runtime.mcpStore.deleteServer(decodeURIComponent(mcpServerMatch[1]));
    sendJson(response, 200, { ok: true });
    return true;
  }

  const memoryMatch = url.pathname.match(/^\/v1\/memories\/([^/]+)$/);
  if (memoryMatch && request.method === 'DELETE') {
    await runtime.memoryStore.deleteMemory(decodeURIComponent(memoryMatch[1]));
    sendJson(response, 200, { ok: true });
    return true;
  }

  const projectMatch = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
  if (projectMatch && request.method === 'DELETE') {
    await runtime.workspaceProjects.removeProject(decodeURIComponent(projectMatch[1]));
    sendJson(response, 200, { ok: true });
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/threads') {
    const thread = await runtime.threadStore.createThread(await readBody<CreateThreadInput>(request, {}));
    sendJson(response, 201, thread);
    return true;
  }

  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/);
  if (threadMatch && request.method === 'GET') {
    const thread = await runtime.threadStore.getThread(decodeURIComponent(threadMatch[1]));
    if (!thread) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(response, 200, thread);
    return true;
  }

  if (threadMatch && request.method === 'PATCH') {
    const thread = await runtime.threadStore.updateThread(
      decodeURIComponent(threadMatch[1]),
      await readBody<ThreadPatch>(request),
    );
    sendJson(response, 200, thread);
    return true;
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
    return true;
  }

  const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/);
  if (messagesMatch && request.method === 'DELETE') {
    const threadId = decodeURIComponent(messagesMatch[1]);
    const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
    const thread = await runtime.threadStore.deleteMessages(threadId, await readBody<MessageDeleteInput>(request));
    await publishThreadEventsSince(runtime, threadId, beforeSeq);
    sendJson(response, 200, thread);
    return true;
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
    return true;
  }

  const clearContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context$/);
  if (clearContextMatch && request.method === 'DELETE') {
    const threadId = decodeURIComponent(clearContextMatch[1]);
    const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
    const thread = await runtime.threadStore.clearThreadMessages(threadId);
    await publishThreadEventsSince(runtime, threadId, beforeSeq);
    sendJson(response, 200, thread);
    return true;
  }

  const compactContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context\/compact$/);
  if (compactContextMatch && request.method === 'POST') {
    const threadId = decodeURIComponent(compactContextMatch[1]);
    sendJson(response, 200, await runtime.agentLoop.compactThreadContext(threadId, true));
    return true;
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
    return true;
  }

  const cancelTurnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/);
  if (cancelTurnMatch && request.method === 'POST') {
    const cancelled = await cancelRuntimeTurn(
      runtime,
      decodeURIComponent(cancelTurnMatch[1]),
      decodeURIComponent(cancelTurnMatch[2]),
    );
    sendJson(response, 200, { ok: true, cancelled });
    return true;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/);
  if (eventsMatch && request.method === 'GET') {
    const threadId = decodeURIComponent(eventsMatch[1]);
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0') || 0;
    const format = runtimeEventStreamFormat(url.searchParams.get('format'));
    await handleSse({
      format,
      response,
      threadId,
      sinceSeq,
      runtime,
    });
    return true;
  }
  return false;
}
