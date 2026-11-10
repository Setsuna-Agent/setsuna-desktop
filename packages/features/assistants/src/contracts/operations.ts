import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { assistantCodec, assistantDraftCodec, assistantPeerUpdateCodec, assistantsSnapshotCodec, identity, record } from './codec.js';
import type { AssistantDraft, AssistantPeerUpdate } from './types.js';
import { assistantSidebarTargetCodec, assistantSidebarUpdateCodec } from './sidebar-entries.js';

const errors = {
  ASSISTANT_NOT_FOUND: { status: 404 },
  ASSISTANT_BUSY: { status: 409 },
  ASSISTANT_CONFLICT: { status: 409 },
};
const target = defineRuntimeCodec<{ assistantId: string }>((value) => ({ assistantId: identity(record(value).assistantId) }));
const empty = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) return undefined;
  throw new Error('No input expected.');
});
const threadResult = defineRuntimeCodec<{ threadId: string }>((value) => ({ threadId: identity(record(value).threadId) }));
const sidebarResult = defineRuntimeCodec<{ ok: true }>((value) => {
  if (record(value).ok !== true) throw new Error('Invalid sidebar mutation result.');
  return { ok: true };
});

export const listAssistants = defineFeatureOperation({
  id: 'assistants.list', method: 'GET', path: '/v1/features/assistants', input: empty, output: assistantsSnapshotCodec, errors, idempotency: 'safe',
});
export const createAssistant = defineFeatureOperation({
  id: 'assistants.create', method: 'POST', path: '/v1/features/assistants',
  input: defineRuntimeCodec<{ draft: AssistantDraft }>((value) => ({ draft: assistantDraftCodec.parse(record(value).draft) })),
  output: assistantCodec, errors, idempotency: 'non-idempotent',
});
export const updateAssistant = defineFeatureOperation({
  id: 'assistants.update', method: 'PUT', path: '/v1/features/assistants/:assistantId',
  input: defineRuntimeCodec<{ assistantId: string; draft: AssistantDraft }>((value) => ({
    ...target.parse(value), draft: assistantDraftCodec.parse(record(value).draft),
  })),
  output: assistantCodec, errors, idempotency: 'idempotent',
});
export const deleteAssistant = defineFeatureOperation({
  id: 'assistants.delete', method: 'DELETE', path: '/v1/features/assistants/:assistantId', input: target,
  output: defineRuntimeCodec<{ deleted: boolean }>((value) => {
    const input = record(value); if (typeof input.deleted !== 'boolean') throw new Error('Invalid deletion result.');
    return { deleted: input.deleted };
  }), errors, idempotency: 'idempotent',
});
export const openAssistantConversation = defineFeatureOperation({
  id: 'assistants.conversation.open', method: 'POST', path: '/v1/features/assistants/:assistantId/conversation',
  input: target, output: threadResult, errors, idempotency: 'idempotent',
});
export const updateAssistantSidebarEntry = defineFeatureOperation({
  id: 'assistants.sidebar.update', method: 'PATCH', path: '/v1/features/assistants/:assistantId/sidebar/:kind/:entryId',
  input: assistantSidebarUpdateCodec, output: sidebarResult, errors, idempotency: 'idempotent',
});
export const deleteAssistantSidebarEntry = defineFeatureOperation({
  id: 'assistants.sidebar.delete', method: 'DELETE', path: '/v1/features/assistants/:assistantId/sidebar/:kind/:entryId',
  input: assistantSidebarTargetCodec, output: sidebarResult, errors, idempotency: 'idempotent',
});
/** Plaintext is fetched only for an explicit editor action, never through assistant snapshots. */
export const revealAssistantQqSecret = defineFeatureOperation({
  id: 'assistants.qq.secret.reveal', method: 'POST', path: '/v1/features/assistants/:assistantId/qq-secret/reveal',
  input: target,
  output: defineRuntimeCodec<{ secret: string | null }>((value) => {
    const { secret } = record(value);
    if (secret !== null && typeof secret !== 'string') throw new Error('Invalid QQ secret result.');
    return { secret };
  }),
  errors, idempotency: 'safe',
});
/** Credentials are stored in the OS secret store, never in feature state. */
export const setAssistantQqSecret = defineFeatureOperation({
  id: 'assistants.qq.secret', method: 'PUT', path: '/v1/features/assistants/:assistantId/qq-secret',
  input: defineRuntimeCodec<{ assistantId: string; secret: string | null }>((value) => {
    const input = record(value);
    if (input.secret !== null && (typeof input.secret !== 'string' || !input.secret.trim() || input.secret.length > 256)) throw new Error('Invalid QQ secret.');
    return { ...target.parse(input), secret: input.secret === null ? null : String(input.secret).trim() };
  }),
  output: defineRuntimeCodec<{ configured: boolean }>((value) => ({ configured: record(value).configured === true })),
  errors, idempotency: 'idempotent',
});
export const updateAssistantPeer = defineFeatureOperation({
  id: 'assistants.peer.update', method: 'PATCH', path: '/v1/features/assistants/:assistantId/peers',
  input: defineRuntimeCodec<{ assistantId: string; peer: AssistantPeerUpdate }>((value) => ({
    ...target.parse(value), peer: assistantPeerUpdateCodec.parse(record(value).peer),
  })),
  output: assistantsSnapshotCodec, errors, idempotency: 'idempotent',
});
