import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';

export type CreateSideConversationInput = Readonly<{
  parentThreadId: string;
}>;

export type CreateSideConversationResult = Readonly<{
  threadId: string;
}>;

const createSideConversationInputCodec = defineRuntimeCodec<CreateSideConversationInput>((value) => {
  const input = objectRecord(value, 'Side conversation input must be an object.');
  return Object.freeze({
    parentThreadId: runtimeId(input.parentThreadId, 'parentThreadId'),
  });
});

const createSideConversationResultCodec = defineRuntimeCodec<CreateSideConversationResult>((value) => {
  const result = objectRecord(value, 'Side conversation result must be an object.');
  return Object.freeze({ threadId: runtimeId(result.threadId, 'threadId') });
});

const createSideConversationErrors = Object.freeze({
  THREAD_NOT_FOUND: Object.freeze({ status: 404 }),
  INVALID_PARENT_THREAD: Object.freeze({ status: 409 }),
});

export const createSideConversation = defineFeatureOperation<
  CreateSideConversationInput,
  CreateSideConversationResult,
  typeof createSideConversationErrors
>({
  id: 'side-conversation.thread.create',
  method: 'POST',
  path: '/v1/features/side-conversation/threads/:parentThreadId',
  input: createSideConversationInputCodec,
  output: createSideConversationResultCodec,
  errors: createSideConversationErrors,
  idempotency: 'non-idempotent',
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function runtimeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`Side conversation ${label} is invalid.`);
  }
  return value;
}
