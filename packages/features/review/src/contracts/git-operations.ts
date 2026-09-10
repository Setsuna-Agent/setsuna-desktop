import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { gitSettingsCodec, type GitSettingsState, type GitSettingsUpdate } from './git-settings.js';
import { reviewModelSelectionCodec } from './model-selection.js';
import type { DeleteGitConflictTaskInput, DeleteGitConflictTaskResult, WorkspaceGitConflictTask, GitConflictOperation, GitConflictTaskRecord, ReadGitConflictHistoryInput, SetGitConflictArchivedInput, ResolveGitConflictsInput, ResolveGitConflictsResult } from './conflict-resolution.js';
import { emptyInputCodec, reviewSettingsErrors, reviewSettingsStateCodec } from './operations.js';

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a Git settings object.');
  return value as Record<string, unknown>;
};
const revision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid settings revision.');
  return value as number;
};
const operation = (value: unknown): GitConflictOperation => {
  if (value === 'pull' || value === 'rebase' || value === 'sync') return value;
  throw new Error('Invalid Git conflict operation.');
};
export const gitConflictTaskRecordCodec = defineRuntimeCodec<GitConflictTaskRecord>((value) => {
  const task = record(value);
  if (typeof task.threadId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(task.threadId)
    || typeof task.turnId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(task.turnId)
    || typeof task.createdAt !== 'string' || !Number.isFinite(Date.parse(task.createdAt))) throw new Error('Invalid conflict history record.');
  if (task.archived !== undefined && typeof task.archived !== 'boolean') throw new Error('Invalid conflict archive state.');
  return { threadId: task.threadId, turnId: task.turnId, createdAt: task.createdAt, operation: operation(task.operation),
    ...(task.archived !== undefined ? { archived: task.archived } : {}),
  };
});
export const readGitConflictHistory = defineFeatureOperation({
  id: 'desktop-review.conflict-history.read', method: 'GET', path: '/v1/features/desktop-review/git-conflicts/history',
  input: defineRuntimeCodec<ReadGitConflictHistoryInput>((value) => {
    const input = record(value);
    if (typeof input.workspaceRoot !== 'string' || !input.workspaceRoot.trim()) throw new Error('Workspace root is required.');
    return { workspaceRoot: input.workspaceRoot };
  }),
  output: defineRuntimeCodec<readonly GitConflictTaskRecord[]>((value) => {
    if (!Array.isArray(value)) throw new Error('Expected conflict history records.');
    return value.map((task) => gitConflictTaskRecordCodec.parse(task));
  }),
  errors: { CONFLICT_HISTORY_UNAVAILABLE: { status: 503 } }, idempotency: 'safe',
});
export const readArchivedGitConflicts = defineFeatureOperation({
  id: 'desktop-review.conflict-history.archived', method: 'GET', path: '/v1/features/desktop-review/git-conflicts/archives',
  input: emptyInputCodec,
  output: defineRuntimeCodec<readonly WorkspaceGitConflictTask[]>((value) => {
    if (!Array.isArray(value)) throw new Error('Expected archived conflict records.');
    return value.map((entry) => {
      const task = record(entry);
      if (task.archived !== true || typeof task.workspaceRoot !== 'string' || !task.workspaceRoot.trim()) throw new Error('Invalid archived conflict record.');
      return { ...gitConflictTaskRecordCodec.parse(task), workspaceRoot: task.workspaceRoot };
    });
  }),
  errors: { CONFLICT_HISTORY_UNAVAILABLE: { status: 503 } }, idempotency: 'safe',
});
export const setGitConflictArchived = defineFeatureOperation({
  id: 'desktop-review.conflict-history.archive', method: 'PATCH', path: '/v1/features/desktop-review/git-conflicts/history/:threadId',
  input: defineRuntimeCodec<SetGitConflictArchivedInput>((value) => {
    const input = record(value);
    const { workspaceRoot } = readGitConflictHistory.input.parse(input);
    if (typeof input.threadId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(input.threadId)) throw new Error('Invalid conflict thread ID.');
    if (typeof input.archived !== 'boolean') throw new Error('Archive state is required.');
    return { workspaceRoot, threadId: input.threadId, archived: input.archived };
  }),
  output: gitConflictTaskRecordCodec,
  errors: { CONFLICT_TASK_NOT_FOUND: { status: 404 }, CONFLICT_HISTORY_UNAVAILABLE: { status: 503 } }, idempotency: 'idempotent',
});
export const deleteGitConflictTask = defineFeatureOperation({
  id: 'desktop-review.conflict-history.delete', method: 'DELETE', path: '/v1/features/desktop-review/git-conflicts/history/:threadId',
  input: defineRuntimeCodec<DeleteGitConflictTaskInput>((value) => {
    const input = record(value);
    const { workspaceRoot } = readGitConflictHistory.input.parse(input);
    if (typeof input.threadId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(input.threadId)) throw new Error('Invalid conflict thread ID.');
    return { workspaceRoot, threadId: input.threadId };
  }),
  output: defineRuntimeCodec<DeleteGitConflictTaskResult>((value) => {
    const result = record(value);
    if (typeof result.deleted !== 'boolean') throw new Error('Invalid conflict deletion result.');
    return { deleted: result.deleted };
  }),
  errors: { CONFLICT_TASK_NOT_ARCHIVED: { status: 409 }, CONFLICT_HISTORY_UNAVAILABLE: { status: 503 } }, idempotency: 'idempotent',
});
const stateCodec = defineRuntimeCodec<GitSettingsState>((value) => {
  const state = record(value);
  const models = reviewSettingsStateCodec.parse({ selection: null, revision: state.revision, availableModels: state.availableModels });
  return { settings: gitSettingsCodec.parse(state.settings), revision: models.revision, availableModels: models.availableModels };
});
export const readGitSettings = defineFeatureOperation({
  id: 'desktop-review.git.settings.read', method: 'GET', path: '/v1/features/desktop-review/git/settings',
  input: emptyInputCodec, output: stateCodec, errors: reviewSettingsErrors, idempotency: 'safe',
});
export const updateGitSettings = defineFeatureOperation({
  id: 'desktop-review.git.settings.update', method: 'PATCH', path: '/v1/features/desktop-review/git/settings',
  input: defineRuntimeCodec<GitSettingsUpdate>((value) => {
    const state = record(value);
    return { settings: gitSettingsCodec.parse(state.settings), expectedRevision: revision(state.expectedRevision) };
  }),
  output: stateCodec, errors: reviewSettingsErrors, idempotency: 'idempotent',
});
export const resolveGitConflicts = defineFeatureOperation({
  id: 'desktop-review.conflict-resolution.start', method: 'POST', path: '/v1/features/desktop-review/threads/:threadId/git-conflicts',
  input: defineRuntimeCodec<ResolveGitConflictsInput>((value) => {
    const input = record(value);
    if (typeof input.threadId !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(input.threadId)) throw new Error('Invalid thread ID.');
    if (typeof input.workspaceRoot !== 'string' || !input.workspaceRoot.trim()) throw new Error('Workspace root is required.');
    const modelSelection = reviewModelSelectionCodec.parse(input.modelSelection);
    return { threadId: input.threadId, workspaceRoot: input.workspaceRoot, operation: operation(input.operation ?? 'pull'), language: input.language === 'zh-CN' ? 'zh-CN' : 'en-US', ...(modelSelection ? { modelSelection } : {}) };
  }),
  output: defineRuntimeCodec<ResolveGitConflictsResult>((value) => {
    const output = record(value);
    if (output.started === true && typeof output.threadId === 'string' && output.threadId && typeof output.turnId === 'string' && output.turnId) {
      return { started: true, ...gitConflictTaskRecordCodec.parse(output) };
    }
    if (output.started === false && (output.reason === 'disabled' || output.reason === 'no-conflicts')) return { started: false, reason: output.reason };
    throw new Error('Invalid conflict resolution response.');
  }),
  errors: { THREAD_NOT_FOUND: { status: 404 }, WORKSPACE_MISMATCH: { status: 409 }, CONFLICT_RESOLUTION_NOT_STARTED: { status: 409 }, SETTINGS_UNAVAILABLE: { status: 503 } },
  idempotency: 'non-idempotent',
});
