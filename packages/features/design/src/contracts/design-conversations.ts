import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import { readDesignDocument, type DesignDocumentRef } from './operations.js';

export type DesignConversationOwner = { ref: DesignDocumentRef; documentId: string };
export type DesignConversation = { id: string; title: string; legacy?: boolean };
function record(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('Invalid design conversation.');
  return input as Record<string, unknown>;
}
const owner = defineRuntimeCodec<DesignConversationOwner>((input) => {
  const { ref, documentId } = record(input);
  if (typeof documentId !== 'string' || !documentId || documentId.length > 256) throw new Error('Invalid document identity.');
  return { ref: readDesignDocument.input.parse(ref), documentId };
});
const conversation = defineRuntimeCodec<DesignConversation>((input) => {
  const { id, title, legacy } = record(input);
  if (typeof id !== 'string' || !id || typeof title !== 'string') throw new Error('Invalid design conversation.');
  return { id, title, ...(legacy === true ? { legacy } : {}) };
});
export const listDesignConversations = defineFeatureOperation({
  id: 'design.conversations.list', method: 'POST', path: '/v1/features/design/conversations/list', errors: {},
  idempotency: 'idempotent', input: owner, output: defineRuntimeCodec((value) => {
    if (!Array.isArray(value)) throw new Error('Invalid design conversations.');
    return value.map((item) => conversation.parse(item));
  }),
});
export const createDesignConversation = defineFeatureOperation({
  id: 'design.conversations.create', method: 'POST', path: '/v1/features/design/conversations', errors: {},
  idempotency: 'non-idempotent', input: owner, output: conversation,
});
