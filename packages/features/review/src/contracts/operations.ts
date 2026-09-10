import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  DesktopCommitMessageGenerationSource,
  DesktopReviewGeneratedCommitMessage,
} from './bridge.js';
import type {
  ReviewModelOption,
  ReviewSettingsState,
  ReviewSettingsUpdate,
} from './runtime.js';
import type {
  ReviewTarget,
  StartReviewInput,
  StartReviewResult,
} from './agent-review.js';
import { reviewModelSelectionCodec } from './settings.js';
import {
  commitMessagePromptCodec,
  COMMIT_MESSAGE_HISTORY_LIMIT,
  MAX_COMMIT_MESSAGE_EXAMPLE_CHARS,
  type CommitMessagePromptSettings,
  type CommitMessagePromptSettingsUpdate,
} from './commit-message-prompt.js';

const commitMessageSourceCodec = defineRuntimeCodec<DesktopCommitMessageGenerationSource>((value) => {
  const record = objectRecord(value, 'Review commit message source must be an object.');
  const modelSelection = reviewModelSelectionCodec.parse(record.modelSelection);
  if (record.recentMessages !== undefined && (!Array.isArray(record.recentMessages)
    || record.recentMessages.length > COMMIT_MESSAGE_HISTORY_LIMIT
    || record.recentMessages.some((message) => typeof message !== 'string' || message.length > MAX_COMMIT_MESSAGE_EXAMPLE_CHARS))) {
    throw new Error('Review recent commit messages are invalid.');
  }
  if (record.branch !== null && typeof record.branch !== 'string') {
    throw new Error('Review commit message branch must be a string or null.');
  }
  return Object.freeze({
    ...(modelSelection ? { modelSelection } : {}),
    ...(record.recentMessages ? { recentMessages: Object.freeze([...(record.recentMessages as string[])]) } : {}),
    branch: record.branch,
    status: text(record.status, 'status'),
    diff: text(record.diff, 'diff'),
  });
});

const generatedCommitMessageCodec = defineRuntimeCodec<DesktopReviewGeneratedCommitMessage>((value) => {
  const record = objectRecord(value, 'Generated review commit message must be an object.');
  const message = text(record.message, 'message').trim();
  if (!message) throw new Error('Generated review commit message must not be empty.');
  return Object.freeze({ message });
});

export const generateReviewCommitMessage = defineFeatureOperation({
  id: 'desktop-review.commit-message.generate',
  supportsProgress: true,
  method: 'POST',
  path: '/v1/features/desktop-review/commit-message',
  input: commitMessageSourceCodec,
  output: generatedCommitMessageCodec,
  errors: Object.freeze({}),
  // Model sampling may incur provider cost, so callers must not retry a missing response.
  idempotency: 'non-idempotent',
});

export const startReviewInputCodec = defineRuntimeCodec<StartReviewInput>((value) => {
  const input = objectRecord(value, 'Review start input must be an object.');
  const selection = input.modelSelection === undefined
    ? null
    : reviewModelSelectionCodec.parse(input.modelSelection);
  return Object.freeze({
    threadId: runtimeId(input.threadId, 'threadId'),
    language: input.language === 'zh-CN' ? 'zh-CN' : 'en-US',
    ...(selection ? { modelSelection: selection } : {}),
    target: reviewTarget(input.target),
  });
});

const startReviewResultCodec = defineRuntimeCodec<StartReviewResult>((value) => {
  const result = objectRecord(value, 'Review start result must be an object.');
  if (result.accepted !== true) throw new Error('Review start result must be accepted.');
  return Object.freeze({
    accepted: true,
    turnId: runtimeId(result.turnId, 'turnId'),
  });
});

const startReviewErrors = Object.freeze({
  THREAD_NOT_FOUND: Object.freeze({ status: 404 }),
  REVIEW_NOT_STARTED: Object.freeze({ status: 409 }),
});

export const startAgentReview = defineFeatureOperation<
  StartReviewInput,
  StartReviewResult,
  typeof startReviewErrors
>({
  id: 'desktop-review.agent.start',
  method: 'POST',
  path: '/v1/features/desktop-review/threads/:threadId/reviews',
  input: startReviewInputCodec,
  output: startReviewResultCodec,
  errors: startReviewErrors,
  idempotency: 'non-idempotent',
});

export const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const reviewSettingsStateCodec = defineRuntimeCodec<ReviewSettingsState>((value) => {
  const record = objectRecord(value, 'Review settings state must be an object.');
  if (!Array.isArray(record.availableModels)) {
    throw new Error('Review availableModels must be an array.');
  }
  return Object.freeze({
    selection: reviewModelSelectionCodec.parse(record.selection),
    revision: nonNegativeInteger(record.revision, 'revision'),
    availableModels: Object.freeze(record.availableModels.map(reviewModelOption)),
  });
});

export const reviewSettingsUpdateCodec = defineRuntimeCodec<ReviewSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Review settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expectedRevision'),
    selection: reviewModelSelectionCodec.parse(record.selection),
  });
});

export const reviewSettingsErrors = Object.freeze({
  SETTINGS_UNAVAILABLE: Object.freeze({ status: 503 }),
  REVISION_CONFLICT: Object.freeze({ status: 409 }),
});

export const readReviewSettings = defineFeatureOperation({
  id: 'desktop-review.settings.read',
  method: 'GET',
  path: '/v1/features/desktop-review/settings',
  input: emptyInputCodec,
  output: reviewSettingsStateCodec,
  errors: reviewSettingsErrors,
  idempotency: 'safe',
});

export const updateReviewSettings = defineFeatureOperation({
  id: 'desktop-review.settings.update',
  method: 'PATCH',
  path: '/v1/features/desktop-review/settings',
  input: reviewSettingsUpdateCodec,
  output: reviewSettingsStateCodec,
  errors: reviewSettingsErrors,
  idempotency: 'idempotent',
});

export const readCommitMessageSettings = defineFeatureOperation({
  id: 'desktop-review.commit-message.settings.read',
  method: 'GET',
  path: '/v1/features/desktop-review/commit-message/settings',
  input: emptyInputCodec,
  output: reviewSettingsStateCodec,
  errors: reviewSettingsErrors,
  idempotency: 'safe',
});

export const updateCommitMessageSettings = defineFeatureOperation({
  id: 'desktop-review.commit-message.settings.update',
  method: 'PATCH',
  path: '/v1/features/desktop-review/commit-message/settings',
  input: reviewSettingsUpdateCodec,
  output: reviewSettingsStateCodec,
  errors: reviewSettingsErrors,
  idempotency: 'idempotent',
});

const commitMessagePromptSettingsCodec = defineRuntimeCodec<CommitMessagePromptSettings>((value) => {
  const record = objectRecord(value, 'Commit message prompt settings must be an object.');
  return Object.freeze({ prompt: commitMessagePromptCodec.parse(record.prompt), revision: nonNegativeInteger(record.revision, 'revision') });
});

export const readCommitMessagePromptSettings = defineFeatureOperation({
  id: 'desktop-review.commit-message.prompt.read',
  method: 'GET',
  path: '/v1/features/desktop-review/commit-message/prompt',
  input: emptyInputCodec,
  output: commitMessagePromptSettingsCodec,
  errors: reviewSettingsErrors,
  idempotency: 'safe',
});

export const updateCommitMessagePromptSettings = defineFeatureOperation({
  id: 'desktop-review.commit-message.prompt.update',
  method: 'PATCH',
  path: '/v1/features/desktop-review/commit-message/prompt',
  input: defineRuntimeCodec<CommitMessagePromptSettingsUpdate>((value) => {
    const record = objectRecord(value, 'Commit message prompt update must be an object.');
    return Object.freeze({ prompt: commitMessagePromptCodec.parse(record.prompt), expectedRevision: nonNegativeInteger(record.expectedRevision, 'expectedRevision') });
  }),
  output: commitMessagePromptSettingsCodec,
  errors: reviewSettingsErrors,
  idempotency: 'idempotent',
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Review commit message ${label} must be a string.`);
  return value;
}

function reviewTarget(value: unknown): ReviewTarget {
  const target = objectRecord(value, 'Review target must be an object.');
  if (target.type === 'uncommittedChanges') return Object.freeze({ type: target.type });
  if (target.type === 'baseBranch') {
    return Object.freeze({
      type: target.type,
      branch: requiredReviewText(target.branch, 'branch'),
    });
  }
  if (target.type === 'commit') {
    const title = optionalReviewText(target.title);
    return Object.freeze({
      type: target.type,
      sha: requiredReviewText(target.sha, 'sha'),
      ...(title ? { title } : {}),
    });
  }
  if (target.type === 'custom') {
    return Object.freeze({
      type: target.type,
      instructions: requiredReviewText(target.instructions, 'instructions'),
    });
  }
  throw new Error(`Unsupported review target: ${String(target.type)}`);
}

function reviewModelOption(value: unknown): ReviewModelOption {
  const record = objectRecord(value, 'Review model option must be an object.');
  for (const key of ['providerId', 'providerName', 'modelId', 'modelName', 'modelCode'] as const) {
    if (typeof record[key] !== 'string' || !record[key]) {
      throw new Error(`Review ${key} is invalid.`);
    }
  }
  return Object.freeze({
    providerId: record.providerId as string,
    providerName: record.providerName as string,
    modelId: record.modelId as string,
    modelName: record.modelName as string,
    modelCode: record.modelCode as string,
  });
}

function requiredReviewText(value: unknown, label: string): string {
  const normalized = optionalReviewText(value);
  if (!normalized) throw new Error(`Review ${label} must not be empty.`);
  return normalized;
}

function optionalReviewText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function runtimeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`Review ${label} is invalid.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Review ${label} is invalid.`);
  }
  return value as number;
}
