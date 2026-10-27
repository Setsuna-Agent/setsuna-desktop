import { readRuntimeThreadMetadata } from '../runtime/thread-metadata.js';
import type {
  CreateThreadInput,
  ForkThreadInput,
  MessageDeleteInput,
  MessagePatch,
  RegenerateMessageInput,
  RuntimeThread,
  RuntimeThreadSummary,
  ThreadMemoryModePatch,
  ThreadPatch,
  ThreadQuery,
  ThreadFileChangesInput,
  RuntimeFileChangePreviewInput,
  WorkspaceFileChangeAction,
} from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { ThreadStorePatch } from '../ports/thread-store.js';
import { applyThreadFileChanges } from '../runtime/use-cases/thread-file-changes.js';
import { readThreadFileChangePreview } from '../runtime/use-cases/thread-file-change-preview.js';
import { forkRuntimeThread } from '../runtime/use-cases/thread-fork.js';
import { createRuntimeThread } from '../runtime/use-cases/thread-create.js';
import { listRuntimeThreadSummaries } from '../runtime/use-cases/thread-list.js';
import { validateRuntimeThreadWorkspaceReset } from '../runtime/use-cases/thread-operations.js';
import { restoredThreadProjectPatch } from '../runtime/use-cases/workspace-operations.js';
import { RuntimeUseCaseError } from '../runtime/use-cases/errors.js';
import { stringInput } from './app-server/input.js';
import { runtimeSkillReferenceList } from './runtime-skill-reference-input.js';
import {
  decodeRuntimeId,
  isRuntimeMessageAttachment,
  optionalNumber,
  readBody,
  sendJson,
  threadScope,
} from './http-utils.js';
import { publishThreadEventsSince } from './sse.js';
import { resolveRuntimeModelSelectionInput } from './runtime-model-selection-input.js';
import { runtimeThreadResponse } from './runtime-thread-response.js';
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
    sendJson(response, 200, { threads: await listRuntimeThreadSummaries(runtime, query) });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/v1/threads') {
    const input = await readBody<CreateThreadInput>(request, {});
    const thread = await createRuntimeThread(runtime, input);
    sendJson(response, 201, await runtimeThreadResponse(runtime, thread));
    return true;
  }

  const threadMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)$/u);
  const forkMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/fork$/u);
  if (forkMatch && request.method === 'POST') {
    const thread = await forkRuntimeThread(
      runtime, decodeRuntimeId(forkMatch[1], 'Thread id'), await readBody<ForkThreadInput>(request),
    );
    sendJson(response, 201, await runtimeThreadResponse(runtime, thread));
    return true;
  }
  const fileChangesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/file-changes\/(undo|redo)$/u);
  const filePreviewMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/file-changes\/preview$/u);
  if (filePreviewMatch && request.method === 'POST') {
    sendJson(response, 200, await readThreadFileChangePreview(
      runtime.threadStore, decodeRuntimeId(filePreviewMatch[1], 'Thread id'), await readBody<RuntimeFileChangePreviewInput>(request),
    ));
    return true;
  }
  if (fileChangesMatch && request.method === 'POST') {
    sendJson(response, 200, await applyThreadFileChanges(
      runtime, decodeRuntimeId(fileChangesMatch[1], 'Thread id'), await readBody<ThreadFileChangesInput>(request),
      fileChangesMatch[2] as WorkspaceFileChangeAction,
    ));
    return true;
  }
  if (threadMatch && request.method === 'GET') {
    const threadId = decodeRuntimeId(threadMatch[1], 'Thread id');
    const knownSeq = optionalNumber(url.searchParams.get('knownSeq'));
    if (knownSeq !== undefined && url.searchParams.has('knownActiveTurnId')) {
      const metadata = await readRuntimeThreadMetadata(runtime.threadStore, threadId);
      const activeTurnId = runtime.agentLoop.activeTurnId(threadId) ?? '';
      if (metadata?.lastSeq === knownSeq && activeTurnId === url.searchParams.get('knownActiveTurnId')) {
        sendJson(response, 200, null);
        return true;
      }
    }
    const messageLimit = optionalNumber(url.searchParams.get('messageLimit'));
    const thread = messageLimit === undefined
      ? await runtime.threadStore.getThread(threadId)
      : await runtime.threadStore.getThreadPage(threadId, { limit: messageLimit });
    if (!thread) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    const projectedThread = await runtimeThreadResponse(runtime, thread);
    sendJson(response, 200, withActiveTurn(runtime, projectedThread));
    return true;
  }
  if (threadMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(threadMatch[1], 'Thread id');
    const input = await readBody<ThreadPatch>(request);
    if (input.workspaceId !== undefined && input.workspaceId !== null) {
      throw new RuntimeUseCaseError('invalid_input', 'workspaceId can only be cleared.');
    }
    const modelSelection = await resolveRuntimeModelSelectionInput(
      runtime.configStore,
      input.modelSelection,
    );
    const patch: ThreadStorePatch = {
      title: input.title,
      archived: input.archived,
      workspaceId: input.workspaceId,
      ...(modelSelection ? { modelBinding: modelSelection.binding } : {}),
    };
    const thread = await runtime.agentLoop.withThreadMutation(
      threadId,
      async () => {
        if (input.workspaceId === null) await validateRuntimeThreadWorkspaceReset(runtime, threadId);
        const before = await readRuntimeThreadMetadata(runtime.threadStore, threadId);
        const projectPatch = before && patch.archived === false
          ? await restoredThreadProjectPatch(runtime.workspaceProjects, before.projectId) : {};
        const updated = await runtime.threadStore.updateThread(threadId, { ...patch, ...projectPatch });
        await publishThreadEventsSince(runtime, threadId, before?.lastSeq ?? 0);
        return updated;
      },
    );
    sendJson(
      response,
      200,
      withActiveTurn(runtime, await runtimeThreadResponse(runtime, thread)),
    );
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
      () => runtime.agentLoop.memoryControl().updateThreadMode(
        threadId,
        threadMemoryModeFromInput(input.mode),
        'user_request',
      ),
    );
    sendJson(
      response,
      200,
      withActiveTurn(runtime, await runtimeThreadResponse(runtime, thread)),
    );
    return true;
  }

  const messageMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/messages\/([^/]+)$/u,
  );
  if (messageMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(messageMatch[1], 'Thread id');
    const messageId = decodeURIComponent(messageMatch[2]);
    const input = await readBody<MessagePatch>(request);
    const patch: MessagePatch = {
      content: typeof input.content === 'string' ? input.content : '',
      attachments: Array.isArray(input.attachments) ? input.attachments.filter(isRuntimeMessageAttachment) : undefined,
      skillIds: Array.isArray(input.skillIds)
        ? input.skillIds.filter((item): item is string => typeof item === 'string')
        : undefined,
      skillReferences: runtimeSkillReferenceList(input.skillReferences),
    };
    const thread = await runtime.agentLoop.withThreadMutation(threadId, async () => {
      const before = await runtime.threadStore.getThread(threadId);
      if (!before) throw new Error(`Thread not found: ${threadId}`);
      const message = before.messages.find((item) => item.id === messageId);
      if (!message) throw new Error(`Message not found: ${messageId}`);
      if (message.role !== 'user' || message.contextCompaction) throw new Error('Only user messages can be edited.');
      if (patch.attachments !== undefined) {
        await runtime.attachmentStore.claimForThread(threadId, patch.attachments);
      }
      const updated = await runtime.threadStore.updateMessage(
        threadId,
        messageId,
        patch,
      );
      await publishThreadEventsSince(runtime, threadId, before.lastSeq);
      return updated;
    });
    sendJson(
      response,
      200,
      withActiveTurn(runtime, await runtimeThreadResponse(runtime, thread)),
    );
    return true;
  }

  const messagesMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/messages$/u);
  if (messagesMatch && request.method === 'GET') {
    const threadId = decodeRuntimeId(messagesMatch[1], 'Thread id');
    const thread = await runtime.threadStore.getThreadPage(threadId, {
      before: optionalNumber(url.searchParams.get('before')),
      limit: optionalNumber(url.searchParams.get('limit')),
    });
    if (!thread) {
      sendJson(response, 404, { error: 'Thread not found' });
      return true;
    }
    sendJson(response, 200, {
      messages: thread.messages,
      fileChangeGroups: thread.fileChangeGroups,
      nextBefore: thread.messagePage?.nextBefore ?? null,
      total: thread.messagePage?.total ?? thread.messages.length,
    });
    return true;
  }
  if (messagesMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(messagesMatch[1], 'Thread id');
    const input = await readBody<MessageDeleteInput>(request);
    const thread = await runtime.agentLoop.withThreadMutation(threadId, async () => {
      const beforeSeq = (await runtime.threadStore.getThread(threadId))?.lastSeq ?? 0;
      const updated = await runtime.threadStore.deleteMessages(threadId, input);
      await publishThreadEventsSince(runtime, threadId, beforeSeq);
      return updated;
    });
    // Chat selections may remove an entire long turn. Refill a bounded tail instead
    // of shipping every surviving historical message in the mutation response.
    const responseThread = input.scope === 'turns'
      ? await runtime.threadStore.getThreadPage(threadId, { limit: 160 }) ?? thread : thread;
    sendJson(
      response,
      200,
      withActiveTurn(runtime, await runtimeThreadResponse(runtime, responseThread, thread)),
    );
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
          attachments: Array.isArray(input.attachments) ? input.attachments.filter(isRuntimeMessageAttachment) : undefined,
          skillIds: Array.isArray(input.skillIds)
            ? input.skillIds.filter(
              (item): item is string => typeof item === 'string',
            )
            : undefined,
          skillReferences: runtimeSkillReferenceList(input.skillReferences),
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
    sendJson(
      response,
      200,
      withActiveTurn(runtime, await runtimeThreadResponse(runtime, thread)),
    );
    return true;
  }

  const compactContextMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/context\/compact$/u,
  );
  if (compactContextMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(compactContextMatch[1], 'Thread id');
    const thread = await runtime.agentLoop.compactThreadContext(threadId, true);
    sendJson(
      response,
      200,
      withActiveTurn(
        runtime,
        await runtimeThreadResponse(runtime, thread),
      ),
    );
    return true;
  }

  return false;
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
