import type {
  QueueTurnInput,
  QueuedTurnInputEditRelease,
  QueuedTurnInputPatch,
  SendTurnInput,
  SteerTurnInput,
} from '@setsuna-desktop/contracts';
import { normalizeRuntimeQueuedTurnInputKind } from '@setsuna-desktop/contracts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import { stringInput } from './app-server/input.js';
import { RuntimeHttpError } from './http-error.js';
import {
  decodeRuntimeId,
  isRuntimeMessageAttachment,
  readBody,
  sendJson,
} from './http-utils.js';
import { cancelRuntimeTurn } from './runtime-thread-events.js';
import {
  handleSse,
  runtimeEventStreamExperimentalApi,
  runtimeEventStreamFormat,
} from './sse.js';
import type { RuntimeFactory } from './types.js';
import { runtimeSkillReferenceList } from './runtime-skill-reference-input.js';

type RuntimeTurnInputBody = {
  attachments?: unknown;
  clientId?: unknown;
  collaborationMode?: unknown;
  collaboration_mode?: unknown;
  expectedTurnId?: unknown;
  input?: unknown;
  planDecision?: unknown;
  plan_decision?: unknown;
  skillIds?: unknown;
  skillReferences?: unknown;
  thinking?: unknown;
  thinkingEffort?: unknown;
  thinking_effort?: unknown;
};

export async function handleRuntimeTurnRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const turnMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/turns$/u);
  if (turnMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(turnMatch[1], 'Thread id');
    const input = await readBody<RuntimeTurnInputBody>(request);
    const attachments: SendTurnInput['attachments'] = Array.isArray(input.attachments)
      ? input.attachments.filter(isRuntimeMessageAttachment)
      : [];
    assertSupportedCollaborationMode(input.collaborationMode ?? input.collaboration_mode);
    assertPlanDecisionRemoved(input.planDecision ?? input.plan_decision);
    sendJson(response, 202, await runtime.agentLoop.startTurn(threadId, {
      attachments,
      clientId: stringInput(input.clientId),
      input: typeof input.input === 'string' ? input.input : '',
      skillIds: runtimeStringList(input.skillIds),
      skillReferences: runtimeSkillReferenceList(input.skillReferences),
      thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
      thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
    } satisfies SendTurnInput));
    return true;
  }

  const steerTurnMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/steer$/u,
  );
  if (steerTurnMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(steerTurnMatch[1], 'Thread id');
    const turnId = decodeRuntimeId(steerTurnMatch[2], 'Turn id');
    const input = await readBody<RuntimeTurnInputBody>(request);
    const attachments: SteerTurnInput['attachments'] = Array.isArray(input.attachments)
      ? input.attachments.filter(isRuntimeMessageAttachment)
      : [];
    sendJson(response, 202, await runtime.agentLoop.steerTurn(threadId, {
      attachments,
      clientId: stringInput(input.clientId),
      expectedTurnId: stringInput(input.expectedTurnId) ?? turnId,
      input: typeof input.input === 'string' ? input.input : '',
      skillIds: runtimeStringList(input.skillIds),
      skillReferences: runtimeSkillReferenceList(input.skillReferences),
      thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
      thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
    }));
    return true;
  }

  const queuedTurnInputCollectionMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/queued-turn-inputs$/u,
  );
  if (queuedTurnInputCollectionMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(
      queuedTurnInputCollectionMatch[1],
      'Thread id',
    );
    const input = await readBody<RuntimeTurnInputBody & { kind?: unknown }>(request);
    const attachments: QueueTurnInput['attachments'] = Array.isArray(input.attachments)
      ? input.attachments.filter(isRuntimeMessageAttachment)
      : [];
    sendJson(response, 202, await runtime.agentLoop.queueTurnInput(threadId, {
      attachments,
      clientId: stringInput(input.clientId),
      input: typeof input.input === 'string' ? input.input : '',
      kind: queuedTurnInputKind(input.kind),
      skillIds: runtimeStringList(input.skillIds),
      skillReferences: runtimeSkillReferenceList(input.skillReferences),
      thinking: typeof input.thinking === 'boolean' ? input.thinking : undefined,
      thinkingEffort: stringInput(input.thinking_effort ?? input.thinkingEffort),
    }));
    return true;
  }

  const queuedTurnInputSendNowMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/queued-turn-inputs\/([^/]+)\/send-now$/u,
  );
  if (queuedTurnInputSendNowMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(queuedTurnInputSendNowMatch[1], 'Thread id');
    const inputId = decodeRuntimeId(
      queuedTurnInputSendNowMatch[2],
      'Queued input id',
    );
    sendJson(
      response,
      202,
      await runtime.agentLoop.sendQueuedTurnInputNow(threadId, inputId),
    );
    return true;
  }

  const queuedTurnInputRetrieveMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/queued-turn-inputs\/([^/]+)\/retrieve$/u,
  );
  if (queuedTurnInputRetrieveMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(queuedTurnInputRetrieveMatch[1], 'Thread id');
    const inputId = decodeRuntimeId(
      queuedTurnInputRetrieveMatch[2],
      'Queued input id',
    );
    sendJson(
      response,
      200,
      await runtime.agentLoop.retrieveQueuedTurnInput(threadId, inputId),
    );
    return true;
  }

  const queuedTurnInputReleaseMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/queued-turn-inputs\/([^/]+)\/release$/u,
  );
  if (queuedTurnInputReleaseMatch && request.method === 'POST') {
    const threadId = decodeRuntimeId(queuedTurnInputReleaseMatch[1], 'Thread id');
    const inputId = decodeRuntimeId(
      queuedTurnInputReleaseMatch[2],
      'Queued input id',
    );
    const input = await readBody<QueuedTurnInputEditRelease>(request);
    sendJson(
      response,
      200,
      await runtime.agentLoop.releaseQueuedTurnInputEdit(threadId, inputId, {
        editToken: stringInput(input.editToken) ?? '',
      }),
    );
    return true;
  }

  const queuedTurnInputMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/queued-turn-inputs\/([^/]+)$/u,
  );
  if (queuedTurnInputMatch && request.method === 'PATCH') {
    const threadId = decodeRuntimeId(queuedTurnInputMatch[1], 'Thread id');
    const inputId = decodeRuntimeId(queuedTurnInputMatch[2], 'Queued input id');
    const patch = await readBody<QueuedTurnInputPatch>(request);
    sendJson(response, 202, await runtime.agentLoop.updateQueuedTurnInput(
      threadId,
      inputId,
      {
        editToken: stringInput(patch.editToken) ?? '',
        input: typeof patch.input === 'string' ? patch.input : '',
        attachments: Array.isArray(patch.attachments)
          ? patch.attachments.filter(isRuntimeMessageAttachment)
          : undefined,
      },
    ));
    return true;
  }
  if (queuedTurnInputMatch && request.method === 'DELETE') {
    const threadId = decodeRuntimeId(queuedTurnInputMatch[1], 'Thread id');
    const inputId = decodeRuntimeId(queuedTurnInputMatch[2], 'Queued input id');
    sendJson(
      response,
      200,
      await runtime.agentLoop.deleteQueuedTurnInput(threadId, inputId),
    );
    return true;
  }

  const cancelTurnMatch = url.pathname.match(
    /^\/v1\/threads\/([^/]+)\/turns\/([^/]+)\/cancel$/u,
  );
  if (cancelTurnMatch && request.method === 'POST') {
    const cancelled = await cancelRuntimeTurn(
      runtime,
      decodeRuntimeId(cancelTurnMatch[1], 'Thread id'),
      decodeRuntimeId(cancelTurnMatch[2], 'Turn id'),
    );
    sendJson(response, 200, { ok: true, cancelled });
    return true;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/threads\/([^/]+)\/events$/u);
  if (eventsMatch && request.method === 'GET') {
    await handleSse({
      experimentalApi: runtimeEventStreamExperimentalApi(
        url.searchParams.get('experimentalApi')
          ?? url.searchParams.get('experimental_api'),
      ),
      format: runtimeEventStreamFormat(url.searchParams.get('format')),
      response,
      threadId: decodeRuntimeId(eventsMatch[1], 'Thread id'),
      sinceSeq: Number(url.searchParams.get('sinceSeq') ?? '0') || 0,
      runtime,
    });
    return true;
  }

  return false;
}

function assertSupportedCollaborationMode(value: unknown): void {
  const text = stringInput(value);
  if (!text || text === 'default') return;
  if (text === 'plan') {
    throw new RuntimeHttpError(400, 'Plan mode is no longer supported.', 'plan_mode_removed');
  }
  throw new RuntimeHttpError(400, 'collaborationMode must be default.', 'invalid_collaboration_mode');
}

function assertPlanDecisionRemoved(value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  throw new RuntimeHttpError(400, 'Plan decisions are no longer supported.', 'plan_mode_removed');
}

function queuedTurnInputKind(value: unknown): QueueTurnInput['kind'] {
  const kind = stringInput(value);
  // 旧数据的 plan -> message 转换只能发生在持久化投影中；新 API 输入必须明确失败。
  if (kind === 'plan') {
    throw new RuntimeHttpError(400, 'Plan mode is no longer supported.', 'plan_mode_removed');
  }
  return normalizeRuntimeQueuedTurnInputKind(kind);
}

function runtimeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
