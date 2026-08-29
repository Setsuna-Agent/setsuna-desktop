import type { SideConversationRuntimeHost } from '@setsuna-desktop/feature-side-conversation/contracts';
import type { RuntimeContainer } from '../runtime/runtime-factory.js';
import { copyRuntimeMessagesToThread } from '../runtime/use-cases/thread-copy.js';
import { deleteRuntimeThread } from '../runtime/use-cases/thread-operations.js';

/** Adapts Core stores and teardown to the narrow Side Conversation host contract. */
export function createSideConversationRuntimeHost(
  runtime: RuntimeContainer,
): SideConversationRuntimeHost {
  const host: SideConversationRuntimeHost = {
    now: () => runtime.clock.now(),
    id: (prefix) => runtime.ids.id(prefix),
    flushThread: (threadId) => runtime.eventWriter.flushThread(threadId),
    listThreads: () => runtime.threadStore.listThreads({
      includeArchived: true,
      includeSide: true,
    }),
    getThread: (threadId) => runtime.threadStore.getThread(threadId),
    createThread: (input) => runtime.threadStore.createThread(input),
    retainAttachments: (threadId, attachments) => (
      runtime.attachmentStore.retainForThread(threadId, [...attachments])
    ),
    appendEvent: async (threadId, event) => {
      await runtime.threadStore.appendEvent(threadId, event);
    },
    copyMessages: (sourceThreadId, destinationThreadId, messages) => (
      copyRuntimeMessagesToThread(
        runtime,
        sourceThreadId,
        destinationThreadId,
        [...messages],
      )
    ),
    rollbackCreatedThread: async (threadId) => {
      await Promise.allSettled([
        runtime.attachmentStore.releaseThread(threadId),
        runtime.toolResultStore.releaseThread(threadId),
      ]);
      await runtime.threadStore.deleteThread(threadId).catch(() => undefined);
    },
    deleteThread: (threadId) => deleteRuntimeThread(runtime, threadId),
  };
  return Object.freeze(host);
}
