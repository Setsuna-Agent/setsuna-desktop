import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { automationDraftCodec, automationSnapshotCodec, automationTaskCodec, identity, record } from './codec.js';
import type { AutomationDraft } from './types.js';

const errors = { TASK_NOT_FOUND: { status: 404 }, TASK_BUSY: { status: 409 } };
const target = defineRuntimeCodec<{ taskId: string }>((value) => ({ taskId: identity(record(value).taskId) }));
const empty = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return undefined;
  throw new Error('No input expected.');
});

export const listAutomations = defineFeatureOperation({
  id: 'automation.list', method: 'GET', path: '/v1/features/automation/tasks', input: empty, output: automationSnapshotCodec, errors, idempotency: 'safe',
});
export const createAutomationConversation = defineFeatureOperation({
  id: 'automation.conversation.create', method: 'POST', path: '/v1/features/automation/conversations', input: empty,
  output: defineRuntimeCodec<{ threadId: string }>((value) => ({ threadId: identity(record(value).threadId) })), errors, idempotency: 'non-idempotent',
});
export const createAutomation = defineFeatureOperation({
  id: 'automation.task.create', method: 'POST', path: '/v1/features/automation/tasks',
  input: defineRuntimeCodec<{ threadId: string; draft: AutomationDraft }>((value) => {
    const input = record(value);
    return { threadId: identity(input.threadId), draft: automationDraftCodec.parse(input.draft) };
  }), output: automationTaskCodec, errors, idempotency: 'non-idempotent',
});
export const updateAutomation = defineFeatureOperation({
  id: 'automation.task.update', method: 'PUT', path: '/v1/features/automation/tasks/:taskId',
  input: defineRuntimeCodec<{ taskId: string; draft: AutomationDraft }>((value) => ({ ...target.parse(value), draft: automationDraftCodec.parse(record(value).draft) })),
  output: automationTaskCodec, errors, idempotency: 'idempotent',
});
export const setAutomationStatus = defineFeatureOperation({
  id: 'automation.task.status', method: 'PATCH', path: '/v1/features/automation/tasks/:taskId/status',
  input: defineRuntimeCodec<{ taskId: string; status: 'active' | 'paused' }>((value) => {
    const input = record(value);
    if (input.status !== 'active' && input.status !== 'paused') throw new Error('Invalid task status.');
    return { ...target.parse(input), status: input.status };
  }), output: automationTaskCodec, errors, idempotency: 'idempotent',
});
export const runAutomation = defineFeatureOperation({
  id: 'automation.task.run', method: 'POST', path: '/v1/features/automation/tasks/:taskId/run', input: target, output: automationTaskCodec, errors, idempotency: 'non-idempotent',
});
export const deleteAutomation = defineFeatureOperation({
  id: 'automation.task.delete', method: 'DELETE', path: '/v1/features/automation/tasks/:taskId', input: target,
  output: defineRuntimeCodec<{ deleted: boolean }>((value) => {
    const input = record(value); if (typeof input.deleted !== 'boolean') throw new Error('Invalid deletion result.');
    return { deleted: input.deleted };
  }), errors, idempotency: 'idempotent',
});
