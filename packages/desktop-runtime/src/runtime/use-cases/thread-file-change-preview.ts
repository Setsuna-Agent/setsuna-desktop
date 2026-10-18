import { projectFileChangePreview, type RuntimeFileChangePreviewInput } from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { RuntimeUseCaseError } from './errors.js';

export async function readThreadFileChangePreview(
  store: Pick<ThreadStore, 'getFileChangePreview' | 'getThread'>,
  threadId: string,
  input: RuntimeFileChangePreviewInput,
) {
  if (!input || typeof input.path !== 'string' || !input.path.trim()
    || !Array.isArray(input.toolCallIds) || !input.toolCallIds.length
    || input.toolCallIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new RuntimeUseCaseError('invalid_input', 'A recorded file path and tool call ids are required.');
  }
  const operations = store.getFileChangePreview
    ? await store.getFileChangePreview(threadId, input)
    : await store.getThread(threadId).then((thread) => thread ? projectFileChangePreview(thread.messages, input) : null);
  if (!operations) throw new RuntimeUseCaseError('thread_not_found', 'Thread not found.');
  if (operations.length !== new Set(input.toolCallIds).size) {
    throw new RuntimeUseCaseError('invalid_request', 'The requested file operations are no longer available in this conversation.');
  }
  return operations;
}
