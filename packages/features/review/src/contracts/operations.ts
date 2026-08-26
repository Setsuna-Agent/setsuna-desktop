import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type {
  DesktopCommitMessageGenerationSource,
  DesktopReviewGeneratedCommitMessage,
} from './bridge.js';

const commitMessageSourceCodec = defineRuntimeCodec<DesktopCommitMessageGenerationSource>((value) => {
  const record = objectRecord(value, 'Review commit message source must be an object.');
  if (record.branch !== null && typeof record.branch !== 'string') {
    throw new Error('Review commit message branch must be a string or null.');
  }
  return Object.freeze({
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
  method: 'POST',
  path: '/v1/features/desktop-review/commit-message',
  input: commitMessageSourceCodec,
  output: generatedCommitMessageCodec,
  errors: Object.freeze({}),
  // Model sampling may incur provider cost, so callers must not retry a missing response.
  idempotency: 'non-idempotent',
});

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Review commit message ${label} must be a string.`);
  return value;
}
