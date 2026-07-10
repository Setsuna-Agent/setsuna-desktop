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
  RuntimeMessage,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadSummary,
  RuntimeUsageQuery,
  SendTurnInput,
  SteerTurnInput,
  ThreadMemoryModePatch,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { fetchMcpServerTools } from '../adapters/mcp/mcp-tool-discovery.js';
import { fetchAvailableModels } from '../adapters/model/model-discovery.js';
import { assertSafeRuntimeId } from '../security/runtime-id.js';
import { createModelStreamTextCollector } from '../utils/model-stream-text-collector.js';
import { stringInput } from './app-server/input.js';
import { isRuntimeMessageAttachment, memoryScope, optionalNumber, readBody, sendJson, threadScope } from './http-utils.js';
import { RuntimeHttpError } from './http-error.js';
import { cancelRuntimeTurn } from './runtime-thread-events.js';
import { handleSse, publishThreadEventsSince, runtimeEventStreamExperimentalApi, runtimeEventStreamFormat } from './sse.js';
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

  if (request.method === 'POST' && url.pathname === '/v1/git/commit-message/generate') {
    sendJson(response, 200, {
      message: await generateCommitMessage(runtime, await readBody(request, {})),
    });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/v1/threads') {
    const query: ThreadQuery = {
      search: url.searchParams.get('search') ?? undefined,
      includeArchived: url.searchParams.get('includeArchived') === 'true',
      ancestorThreadId: url.searchParams.get('ancestorThreadId') ?? undefined,
      parentThreadId: url.searchParams.get('parentThreadId') ?? undefined,
      scope: threadScope(url.searchParams.get('scope')),
      projectId: url.searchParams.get('projectId') ?? undefined,
    };
    const threads = await runtime.threadStore.listThreads(query);
    sendJson(response, 200, { threads: threads.map((thread) => withActiveTurn(runtime, thread)) });
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
    const input = await readBody<CreateThreadInput>(request, {});
    const config = await runtime.configStore.getConfig().catch(() => null);
    const thread = await runtime.threadStore.createThread({
      ...input,
      memoryMode: input.memoryMode ?? newThreadMemoryMode(config),
    });
    sendJson(response, 201, thread);
    return true;
  }

  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/);
  if (threadMatch && request.method === 'GET') {
    const thread = await runtime.threadStore.getThread(decodeRuntimeId(threadMatch[1], 'Thread id'));
    if (!thread) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  if (threadMatch && request.method === 'PATCH') {
    const thread = await runtime.threadStore.updateThread(
      decodeRuntimeId(threadMatch[1], 'Thread id'),
      await readBody<ThreadPatch>(request),
    );
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const threadMemoryModeMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/memory-mode$/);
  if (threadMemoryModeMatch && request.method === 'PATCH') {
    const input = await readBody<ThreadMemoryModePatch>(request);
    const thread = await runtime.threadStore.updateThreadMemoryMode(
      decodeRuntimeId(threadMemoryModeMatch[1], 'Thread id'),
      threadMemoryModeFromInput(input.mode),
      'user_request',
    );
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const messageMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)$/);
  if (messageMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(messageMatch[1], 'Thread id');
    const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
    const thread = await runtime.threadStore.updateMessage(
      threadId,
      decodeURIComponent(messageMatch[2]),
      await readBody<MessagePatch>(request),
    );
    await publishThreadEventsSince(runtime, threadId, beforeSeq);
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/);
  if (messagesMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(messagesMatch[1], 'Thread id');
    const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
    const thread = await runtime.threadStore.deleteMessages(threadId, await readBody<MessageDeleteInput>(request));
    await publishThreadEventsSince(runtime, threadId, beforeSeq);
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const regenerateMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages\/([^/]+)\/regenerate$/);
  if (regenerateMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(regenerateMatch[1], 'Thread id');
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
    const threadId = decodeRuntimeId(clearContextMatch[1], 'Thread id');
    const thread = await runtime.agentLoop.clearThreadContext(threadId);
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const compactContextMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/context\/compact$/);
  if (compactContextMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(compactContextMatch[1], 'Thread id');
    sendJson(response, 200, withActiveTurn(runtime, await runtime.agentLoop.compactThreadContext(threadId, true)));
    return true;
  }

  const turnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/);
  if (turnMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(turnMatch[1], 'Thread id');
    const input = await readBody<{ attachments?: unknown; clientId?: unknown; collaborationMode?: unknown; collaboration_mode?: unknown; input?: unknown; planDecision?: unknown; plan_decision?: unknown; skillIds?: unknown; thinking?: unknown; thinkingEffort?: unknown; thinking_effort?: unknown }>(request);
    const text = typeof input.input === 'string' ? input.input : '';
    const skillIds = Array.isArray(input.skillIds) ? input.skillIds.filter((item): item is string => typeof item === 'string') : [];
    const attachments: SendTurnInput['attachments'] = Array.isArray(input.attachments)
      ? input.attachments.filter(isRuntimeMessageAttachment)
      : [];
    sendJson(response, 202, await runtime.agentLoop.startTurn(threadId, {
      attachments,
      clientId: stringInput(input.clientId),
      collaborationMode: collaborationModeInput(input.collaborationMode ?? input.collaboration_mode),
      input: text,
      planDecision: planDecisionInput(input.planDecision ?? input.plan_decision),
      skillIds,
      thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
      thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
    } satisfies SendTurnInput));
    return true;
  }

  const steerTurnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/steer$/);
  if (steerTurnMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(steerTurnMatch[1], 'Thread id');
    const turnId = decodeRuntimeId(steerTurnMatch[2], 'Turn id');
    const input = await readBody<{ attachments?: unknown; clientId?: unknown; expectedTurnId?: unknown; input?: unknown }>(request);
    const expectedTurnId = stringInput(input.expectedTurnId) ?? turnId;
    const attachments: SteerTurnInput['attachments'] = Array.isArray(input.attachments)
      ? input.attachments.filter(isRuntimeMessageAttachment)
      : [];
    sendJson(response, 202, await runtime.agentLoop.steerTurn(threadId, {
      attachments,
      clientId: stringInput(input.clientId),
      expectedTurnId,
      input: typeof input.input === 'string' ? input.input : '',
    }));
    return true;
  }

  const cancelTurnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/);
  if (cancelTurnMatch && request.method === 'POST') {
    const cancelled = await cancelRuntimeTurn(
      runtime,
      decodeRuntimeId(cancelTurnMatch[1], 'Thread id'),
      decodeRuntimeId(cancelTurnMatch[2], 'Turn id'),
    );
    sendJson(response, 200, { ok: true, cancelled });
    return true;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/);
  if (eventsMatch && request.method === 'GET') {
    const threadId = decodeRuntimeId(eventsMatch[1], 'Thread id');
    const sinceSeq = Number(url.searchParams.get('sinceSeq') ?? '0') || 0;
    const format = runtimeEventStreamFormat(url.searchParams.get('format'));
    const experimentalApi = runtimeEventStreamExperimentalApi(
      url.searchParams.get('experimentalApi') ?? url.searchParams.get('experimental_api'),
    );
    await handleSse({
      experimentalApi,
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

async function generateCommitMessage(runtime: RuntimeFactory, input: unknown): Promise<string> {
  const body = recordInput(input);
  const branch = stringInput(body.branch) ?? '';
  const status = rawStringInput(body.status);
  const diff = rawStringInput(body.diff);
  if (!status.trim() && !diff.trim()) throw new Error('No git changes were provided.');
  const provider = await runtime.configStore.getActiveProviderConfig();
  if (!provider?.enabled || !provider.activeModel?.code || (!provider.apiKey && provider.activeModel.code === 'local-runtime-smoke')) {
    throw new Error('请先配置默认模型。');
  }

  const now = new Date().toISOString();
  const messages: RuntimeMessage[] = [
    {
      id: 'git_commit_system',
      role: 'system',
      content: [
        'You generate concise Git commit messages.',
        'Return only the commit message, with no markdown, quotes, explanation, or alternatives.',
        'Prefer Conventional Commit style when it is clearly appropriate.',
        'Keep the subject line under 72 characters.',
      ].join('\n'),
      createdAt: now,
      status: 'complete',
      visibility: 'model',
    },
    {
      id: 'git_commit_user',
      role: 'user',
      content: [
        branch ? `Branch: ${branch}` : '',
        status ? `Status:\n${status}` : '',
        diff ? `Diff:\n${diff}` : '',
      ].filter(Boolean).join('\n\n'),
      createdAt: now,
      status: 'complete',
      visibility: 'model',
    },
  ];

  const streamText = createModelStreamTextCollector();
  for await (const item of runtime.modelClient.stream({
    model: 'local-runtime-smoke',
    messages,
    maxOutputTokens: 120,
    temperature: 0.2,
    toolChoice: 'none',
  })) {
    streamText.consume(item);
  }

  const text = streamText.text();
  const message = normalizeGeneratedCommitMessage(text);
  return message || fallbackGeneratedCommitMessage(status, diff);
}

function collaborationModeInput(value: unknown): SendTurnInput['collaborationMode'] {
  const text = stringInput(value);
  if (text === 'default' || text === 'plan') return text;
  return undefined;
}

function planDecisionInput(value: unknown): SendTurnInput['planDecision'] {
  const text = stringInput(value);
  if (text === 'accepted' || text === 'dismissed') return text;
  return undefined;
}

function recordInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeGeneratedCommitMessage(value: string): string {
  const withoutFences = stripInvisibleCommitMessageChars(value)
    .replace(/^```(?:git|text)?/iu, '')
    .replace(/```$/u, '')
    .trim();
  const lines = withoutFences
    .split(/\r?\n/)
    .map((line) => stripInvisibleCommitMessageChars(line).trim())
    .filter(Boolean)
    .map((line) => line.replace(/^commit message:\s*/iu, '').trim())
    .filter(Boolean);
  return stripInvisibleCommitMessageChars(lines[0] ?? '').replace(/^["'`]+|["'`]+$/gu, '').trim();
}

function stripInvisibleCommitMessageChars(value: string): string {
  // eslint-disable-next-line no-control-regex -- Generated commit subjects can include hidden control characters.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, '');
}

function fallbackGeneratedCommitMessage(status: string, diff: string): string {
  const paths = changedPathsFromStatus(status);
  if (paths.length === 1) return truncateCommitSubject(`chore: update ${paths[0]}`);
  if (paths.length > 1) return `chore: update ${paths.length} files`;
  if (diff.trim()) return 'chore: update changes';
  throw new Error('Failed to generate a commit message.');
}

function changedPathsFromStatus(status: string): string[] {
  const paths = status
    .split(/\r?\n/)
    .map(statusPathFromLine)
    .map((line) => line.includes(' -> ') ? line.split(' -> ').at(-1)?.trim() ?? '' : line)
    .filter(Boolean);
  return [...new Set(paths)];
}

function rawStringInput(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : '';
}

function statusPathFromLine(line: string): string {
  const trimmed = line.trimEnd();
  const match = trimmed.match(/^(?:[ MADRCU?!]{2}|[MADRCU?!])\s+(.+)$/u);
  return (match?.[1] ?? trimmed).trim();
}

function truncateCommitSubject(value: string): string {
  return value.length <= 72 ? value : `${value.slice(0, 69).trimEnd()}...`;
}

function newThreadMemoryMode(config: RuntimeConfigState | null): CreateThreadInput['memoryMode'] {
  if (!config) return 'enabled';
  return (config.memory?.generateMemories ?? config.memoryEnabled) ? 'enabled' : 'disabled';
}

function threadMemoryModeFromInput(value: unknown): ThreadMemoryModePatch['mode'] {
  if (value === 'enabled' || value === 'disabled' || value === 'polluted') return value;
  throw new Error('Invalid thread memory mode.');
}

function withActiveTurn<TThread extends RuntimeThread | RuntimeThreadSummary>(
  runtime: RuntimeFactory,
  thread: TThread,
): TThread {
  return {
    ...thread,
    activeTurnId: runtime.agentLoop.activeTurnId(thread.id),
  };
}

function decodeRuntimeId(value: string, label: string): string {
  try {
    return assertSafeRuntimeId(decodeURIComponent(value), label);
  } catch {
    throw new RuntimeHttpError(400, `${label} is invalid.`, 'invalid_runtime_id');
  }
}
