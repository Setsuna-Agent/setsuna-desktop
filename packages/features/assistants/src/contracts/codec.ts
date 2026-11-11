import { normalizeBrandIconConfig, normalizeWorkspaceProjectIcon } from '@setsuna-desktop/contracts';
import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { automationScheduleCodec } from '@setsuna-desktop/feature-automation/contracts';
import type {
  Assistant, AssistantConnectorStatus, AssistantConversation, AssistantConversationView, AssistantDelivery, AssistantDraft, AssistantExecutionConfig, AssistantInboxEntry,
  AssistantModel, AssistantPeerRef, AssistantPeerUpdate, AssistantProject, AssistantQqPeer, AssistantsSnapshot,
  AssistantsState, AssistantTask, AssistantTaskRequest, AssistantReminder, AssistantReminderDraft,
} from './types.js';

export const ASSISTANT_PERSONALITY_LIMIT = 4_000;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, label: string, limit = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`${label} is required (maximum ${limit} characters).`);
  return value.trim();
}

export function identity(value: unknown, label = 'id'): string {
  const id = text(value, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error(`Invalid ${label}.`);
  return id;
}

function timestamp(value: unknown): string {
  const at = text(value, 'timestamp', 64);
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid timestamp.');
  return at;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid ${label}.`);
  return value as T;
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Expected a non-negative integer.');
  return Number(value);
}

function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Expected a list.');
  return value.map(parse);
}

function strings(value: unknown, label: string, limit = 2_000): string[] {
  return value === undefined ? [] : list(value, (item) => text(item, label, limit));
}

/** Spreads `{ [key]: parse(value) }` only when the stored field is present. */
function optional<K extends string, T>(key: K, value: unknown, parse: (value: unknown) => T): { [P in K]?: T } {
  return (value === undefined || value === null ? {} : { [key]: parse(value) }) as { [P in K]?: T };
}

/** QQ openids are opaque bot-scoped identifiers; keep them as printable tokens only. */
export function openid(value: unknown): string {
  const id = text(value, 'openid', 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error('Invalid openid.');
  return id;
}

export function peerRef(value: unknown): AssistantPeerRef {
  const input = record(value);
  return { kind: oneOf(input.kind, ['c2c', 'group'] as const, 'peer kind'), openid: openid(input.openid) };
}

/** QQ message IDs are opaque platform values and can exceed local identifier limits. */
function qqMessageId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('QQ message ID must be a non-empty string.');
  return value.trim();
}

function executionConfig(value: unknown): AssistantExecutionConfig {
  const input = record(value);
  return {
    ...optional('modelSelection', input.modelSelection, (value) => {
      const model = record(value);
      return { providerId: text(model.providerId, 'providerId'), modelId: text(model.modelId, 'modelId') };
    }),
    ...optional('thinkingEffort', input.thinkingEffort, (effort) => text(effort, 'thinkingEffort', 32)),
  };
}

export const assistantDraftCodec = defineRuntimeCodec<AssistantDraft>((value) => {
  const input = record(value);
  const qq = input.qq === undefined || input.qq === null ? undefined : record(input.qq);
  const avatar = input.avatar === undefined ? undefined : normalizeBrandIconConfig(input.avatar);
  if (input.avatar !== undefined && !avatar) throw new Error('Invalid avatar.');
  if (qq && typeof qq.enabled !== 'boolean') throw new Error('qq.enabled must be boolean.');
  if (qq?.markdownEnabled !== undefined && typeof qq.markdownEnabled !== 'boolean') throw new Error('qq.markdownEnabled must be boolean.');
  const appId = qq ? text(qq.appId, 'QQ AppID', 64) : undefined;
  if (appId && !/^\d+$/u.test(appId)) throw new Error('QQ AppID must be numeric.');
  return {
    name: text(input.name, 'name', 40),
    personality: typeof input.personality === 'string' ? input.personality.trim().slice(0, ASSISTANT_PERSONALITY_LIMIT) : '',
    projectIds: [...new Set(strings(input.projectIds, 'projectId').map((id) => identity(id, 'projectId')))],
    ...(avatar ? { avatar } : {}),
    ...optional('avatarColor', input.avatarColor, (color) => text(color, 'avatarColor', 32)),
    ...executionConfig(input),
    ...(qq && appId ? { qq: { appId, enabled: qq.enabled === true, markdownEnabled: qq.markdownEnabled !== false } } : {}),
  };
});

export const assistantCodec = defineRuntimeCodec<Assistant>((value) => {
  const input = record(value);
  return {
    ...assistantDraftCodec.parse(input), id: identity(input.id),
    createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt),
  };
});

function conversation(value: unknown): AssistantConversation {
  const input = record(value);
  return {
    threadId: identity(input.threadId), assistantId: identity(input.assistantId), createdAt: timestamp(input.createdAt),
    source: oneOf(input.source, ['shared', 'local', 'qq-c2c', 'qq-group'] as const, 'conversation source'),
    ...optional('peerOpenid', input.peerOpenid, openid),
    ...(input.pinned === true ? { pinned: true } : {}),
    ...optional('mergedInto', input.mergedInto, identity),
  };
}

function peer(value: unknown): AssistantQqPeer {
  const input = record(value);
  return {
    ...peerRef(input), assistantId: identity(input.assistantId),
    ...optional('displayName', input.displayName, (name) => text(name, 'displayName', 120)),
    status: oneOf(input.status, ['pending', 'allowed'] as const, 'peer status'),
    firstSeenAt: timestamp(input.firstSeenAt), lastSeenAt: timestamp(input.lastSeenAt),
  };
}

function request(value: unknown): AssistantTaskRequest {
  const input = record(value);
  return {
    id: identity(input.id), kind: oneOf(input.kind, ['approval', 'input', 'desktop'] as const, 'request kind'),
    toolName: text(input.toolName, 'toolName'), summary: text(input.summary, 'summary', 4_000),
    ...optional('fields', input.fields, (fields) => list(fields, (field) => {
      const item = record(field);
      return { id: text(item.id, 'field id'), label: text(item.label, 'field label', 200), required: item.required === true };
    })),
  };
}

const TASK_STATUSES = ['pending', 'queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted'] as const;

function task(value: unknown): AssistantTask {
  const input = record(value);
  const origin = record(input.origin);
  const reported = input.reported === undefined ? undefined : record(input.reported);
  return {
    id: identity(input.id), assistantId: identity(input.assistantId), title: text(input.title, 'title', 120),
    ...(input.pinned === true ? { pinned: true } : {}),
    origin: {
      threadId: identity(origin.threadId),
      ...optional('turnId', origin.turnId, identity),
      ...optional('peer', origin.peer, peerRef),
      ...optional('messageId', origin.messageId, qqMessageId),
      ...optional('initiator', origin.initiator, openid),
    },
    projectId: identity(input.projectId), workThreadId: identity(input.workThreadId),
    workspaceKey: text(input.workspaceKey, 'workspaceKey'), instructions: text(input.instructions, 'instructions', 32_000),
    ...optional('execution', input.execution, executionConfig),
    status: oneOf(input.status, TASK_STATUSES, 'task status'),
    requests: list(input.requests, request),
    ...optional('clientId', input.clientId, identity),
    ...optional('turnId', input.turnId, identity),
    ...optional('queuedInputId', input.queuedInputId, identity),
    ...optional('result', input.result, (result) => text(result, 'result', 8_000)),
    ...optional('error', input.error, (error) => text(error, 'error', 4_000)),
    ...(reported ? { reported: {
      status: oneOf(reported.status, TASK_STATUSES, 'reported status'),
      requestIds: strings(reported.requestIds, 'requestId'),
    } } : {}),
    createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt),
    ...optional('finishedAt', input.finishedAt, timestamp),
  };
}

function delivery(value: unknown): AssistantDelivery {
  const input = record(value);
  return {
    id: identity(input.id), assistantId: identity(input.assistantId), peer: peerRef(input.peer),
    ...optional('threadId', input.threadId, identity),
    status: oneOf(input.status, ['waiting', 'ready', 'sent', 'failed'] as const, 'delivery status'),
    sentChunks: count(input.sentChunks), attempts: count(input.attempts),
    createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt),
    ...optional('clientId', input.clientId, identity),
    ...optional('turnId', input.turnId, identity),
    ...optional('reminderId', input.reminderId, identity),
    ...optional('replyToMessageId', input.replyToMessageId, qqMessageId),
    ...optional('initiator', input.initiator, openid),
    ...optional('projectIds', input.projectIds, (ids) => strings(ids, 'projectId').map((id) => identity(id, 'projectId'))),
    ...(input.activeOnly === true ? { activeOnly: true } : {}),
    ...optional('content', input.content, (content) => text(content, 'content', 64_000)),
    ...optional('nextAttemptAt', input.nextAttemptAt, timestamp),
    ...optional('error', input.error, (error) => text(error, 'error', 4_000)),
  };
}

function inboxEntry(value: unknown): AssistantInboxEntry {
  const input = record(value);
  return {
    assistantId: identity(input.assistantId), messageId: qqMessageId(input.messageId), peer: peerRef(input.peer),
    receivedAt: timestamp(input.receivedAt), repliesUsed: count(input.repliesUsed),
  };
}

export const assistantsStateCodec = defineRuntimeCodec<AssistantsState>((value) => {
  const input = record(value);
  return {
    assistants: list(input.assistants, (item) => assistantCodec.parse(item)),
    conversations: list(input.conversations, conversation),
    peers: list(input.peers, peer),
    tasks: list(input.tasks, task),
    reminders: input.reminders === undefined ? [] : list(input.reminders, (item) => assistantReminderCodec.parse(item)),
    deliveries: list(input.deliveries, delivery),
    inbox: list(input.inbox, inboxEntry),
  };
});

function model(value: unknown): AssistantModel {
  const input = record(value);
  return {
    providerId: text(input.providerId, 'providerId'), modelId: text(input.modelId, 'modelId'),
    name: text(input.name, 'name', 512), thinkingEfforts: strings(input.thinkingEfforts, 'thinkingEffort', 32),
  };
}

function project(value: unknown): AssistantProject {
  const input = record(value);
  return {
    id: identity(input.id), name: text(input.name, 'name', 512), path: text(input.path, 'path', 4_096), git: input.git === true,
    ...optional('icon', input.icon, normalizeWorkspaceProjectIcon),
  };
}

function connector(value: unknown): AssistantConnectorStatus {
  const input = record(value);
  return {
    assistantId: identity(input.assistantId), secretConfigured: input.secretConfigured === true,
    state: oneOf(input.state, ['disabled', 'connecting', 'connected', 'error'] as const, 'connector state'),
    ...optional('error', input.error, (error) => text(error, 'error', 4_000)),
  };
}

function conversationView(value: unknown): AssistantConversationView {
  const input = record(value);
  return { ...conversation(input), title: text(input.title, 'title', 512), updatedAt: timestamp(input.updatedAt),
    ...optional('activeTurnId', input.activeTurnId, identity),
    ...optional('previousThreadIds', input.previousThreadIds, (value) => strings(value, 'threadId').map((id) => identity(id))) };
}

export const assistantsSnapshotCodec = defineRuntimeCodec<AssistantsSnapshot>((value) => {
  const input = record(value);
  const state = assistantsStateCodec.parse({ ...input, conversations: [], deliveries: [], inbox: [] });
  return {
    assistants: state.assistants, peers: state.peers, tasks: state.tasks, reminders: state.reminders,
    conversations: list(input.conversations, conversationView),
    connectors: list(input.connectors, connector), models: list(input.models, model), projects: list(input.projects, project),
  };
});

export const assistantReminderDraftCodec = defineRuntimeCodec<AssistantReminderDraft>((value) => {
  const input = record(value);
  return { title: text(input.title, 'title', 120), instructions: text(input.instructions, 'instructions', 32_000),
    schedule: automationScheduleCodec.parse(input.schedule) };
});

export const assistantReminderCodec = defineRuntimeCodec<AssistantReminder>((value) => {
  const input = record(value);
  const lastRun = input.lastRun === undefined ? undefined : record(input.lastRun);
  return {
    ...assistantReminderDraftCodec.parse(input), id: identity(input.id), assistantId: identity(input.assistantId),
    ...optional('qqAppId', input.qqAppId, (value) => text(value, 'QQ AppID', 64)),
    ...optional('peer', input.peer, peerRef), ...optional('initiator', input.initiator, openid),
    ...(input.pinned === true ? { pinned: true } : {}),
    status: oneOf(input.status, ['active', 'paused', 'completed'] as const, 'reminder status'),
    nextRunAt: input.nextRunAt === null ? null : timestamp(input.nextRunAt),
    createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt),
    ...(lastRun ? { lastRun: {
      id: identity(lastRun.id), threadId: identity(lastRun.threadId), scheduledFor: timestamp(lastRun.scheduledFor),
      instructions: text(lastRun.instructions, 'instructions', 32_000), ...optional('turnId', lastRun.turnId, identity),
    } } : {}),
  };
});

export const assistantPeerUpdateCodec = defineRuntimeCodec<AssistantPeerUpdate>((value) => {
  const input = record(value);
  return {
    ...peerRef(input), status: oneOf(input.status, ['allowed', 'removed'] as const, 'peer status'),
  };
});
