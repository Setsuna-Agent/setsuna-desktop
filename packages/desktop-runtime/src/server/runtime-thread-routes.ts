import type {
  CreateThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadSummary,
  ThreadMemoryModePatch,
  ThreadPatch,
  ThreadQuery,
} from '@setsuna-desktop/contracts';
import { runtimeDeveloperFeaturesEnabled } from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { stringInput } from './app-server/input.js';
import {
  decodeRuntimeId,
  optionalNumber,
  readBody,
  sendJson,
  threadScope,
} from './http-utils.js';
import { publishThreadEventsSince } from './sse.js';
import type { RuntimeFactory } from './types.js';

export async function handleRuntimeThreadRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
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
    sendJson(response, 200, {
      threads: threads.map((thread) => withActiveTurn(runtime, thread)),
    });
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

  const debugTracesMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/debug-traces$/u,
  );
  if (debugTracesMatch && request.method === 'GET') {
    const config = await runtime.configStore.getConfig().catch(() => null);
    if (!runtimeDeveloperFeaturesEnabled(config)) {
      sendJson(response, 404, { error: 'Developer features are disabled.' });
      return true;
    }
    const threadId = decodeRuntimeId(debugTracesMatch[1], 'Thread id');
    if (!await runtime.threadStore.getThread(threadId)) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    const afterSeq = Math.max(
      0,
      Math.floor(optionalNumber(url.searchParams.get('afterSeq')) ?? 0),
    );
    sendJson(response, 200, runtime.debugTraceStore.list(threadId, afterSeq));
    return true;
  }

  const backgroundShellProcessesMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/background-shell-processes$/u,
  );
  if (backgroundShellProcessesMatch && request.method === 'GET') {
    const threadId = decodeRuntimeId(
      backgroundShellProcessesMatch[1],
      'Thread id',
    );
    if (!await runtime.threadStore.getThread(threadId)) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(response, 200, {
      processes: await runtime.backgroundShellProcesses
        .listBackgroundShellProcesses(threadId),
    });
    return true;
  }

  const backgroundShellProcessMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/background-shell-processes\/([^/]+)$/u,
  );
  if (backgroundShellProcessMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(backgroundShellProcessMatch[1], 'Thread id');
    const processId = decodeRuntimeId(
      backgroundShellProcessMatch[2],
      'Shell process id',
    );
    if (!await runtime.threadStore.getThread(threadId)) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(
      response,
      200,
      await runtime.backgroundShellProcesses
        .terminateBackgroundShellProcess(threadId, processId),
    );
    return true;
  }

  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/u);
  if (threadMatch && request.method === 'GET') {
    const thread = await runtime.threadStore.getThread(
      decodeRuntimeId(threadMatch[1], 'Thread id'),
    );
    if (!thread) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }
  if (threadMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(threadMatch[1], 'Thread id');
    const patch = await readBody<ThreadPatch>(request);
    const thread = await runtime.agentLoop.withThreadMutation(
      threadId,
      () => runtime.threadStore.updateThread(threadId, patch),
    );
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const threadMemoryModeMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/memory-mode$/u,
  );
  if (threadMemoryModeMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(threadMemoryModeMatch[1], 'Thread id');
    const input = await readBody<ThreadMemoryModePatch>(request);
    const thread = await runtime.agentLoop.withThreadMutation(
      threadId,
      () => runtime.threadStore.updateThreadMemoryMode(
        threadId,
        threadMemoryModeFromInput(input.mode),
        'user_request',
      ),
    );
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const messageMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/messages\/([^/]+)$/u,
  );
  if (messageMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(messageMatch[1], 'Thread id');
    const messageId = decodeURIComponent(messageMatch[2]);
    const patch = await readBody<MessagePatch>(request);
    const thread = await runtime.agentLoop.withThreadMutation(threadId, async () => {
      const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
      const updated = await runtime.threadStore.updateMessage(
        threadId,
        messageId,
        patch,
      );
      await publishThreadEventsSince(runtime, threadId, beforeSeq);
      return updated;
    });
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/u);
  if (messagesMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(messagesMatch[1], 'Thread id');
    const input = await readBody<MessageDeleteInput>(request);
    const thread = await runtime.agentLoop.withThreadMutation(threadId, async () => {
      const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
      const updated = await runtime.threadStore.deleteMessages(threadId, input);
      await publishThreadEventsSince(runtime, threadId, beforeSeq);
      return updated;
    });
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const regenerateMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/messages\/([^/]+)\/regenerate$/u,
  );
  if (regenerateMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(regenerateMatch[1], 'Thread id');
    const input = await readBody<RegenerateMessageInput>(request, {});
    sendJson(
      response,
      202,
      await runtime.agentLoop.regenerateFromMessage(
        threadId,
        decodeURIComponent(regenerateMatch[2]),
        {
          content: typeof input.content === 'string' ? input.content : undefined,
          skillIds: Array.isArray(input.skillIds)
            ? input.skillIds.filter(
              (item): item is string => typeof item === 'string',
            )
            : [],
          thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
          thinkingEffort: stringInput(
            (input as { thinking_effort?: unknown }).thinking_effort
              ?? input.thinkingEffort,
          ),
        },
      ),
    );
    return true;
  }

  const clearContextMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/context$/u,
  );
  if (clearContextMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(clearContextMatch[1], 'Thread id');
    const thread = await runtime.agentLoop.clearThreadContext(threadId);
    sendJson(response, 200, withActiveTurn(runtime, thread));
    return true;
  }

  const compactContextMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/context\/compact$/u,
  );
  if (compactContextMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(compactContextMatch[1], 'Thread id');
    sendJson(
      response,
      200,
      withActiveTurn(
        runtime,
        await runtime.agentLoop.compactThreadContext(threadId, true),
      ),
    );
    return true;
  }

  return false;
}

function newThreadMemoryMode(
  config: RuntimeConfigState | null,
): CreateThreadInput['memoryMode'] {
  if (!config) return 'enabled';
  return (config.memory?.generateMemories ?? config.memoryEnabled)
    ? 'enabled'
    : 'disabled';
}

function threadMemoryModeFromInput(
  value: unknown,
): ThreadMemoryModePatch['mode'] {
  if (value === 'enabled' || value === 'disabled' || value === 'polluted') {
    return value;
  }
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
