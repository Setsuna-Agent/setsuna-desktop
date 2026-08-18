import type { RuntimeEvent, RuntimeMessage, RuntimeThread } from '@setsuna-desktop/contracts';
import type { RuntimeContainer } from '../runtime-factory.js';
import { randomRuntimeId } from '../runtime-id.js';
import { RuntimeUseCaseError } from './errors.js';
import { copyRuntimeMessagesToThread } from './thread-copy.js';
import { deleteRuntimeThread } from './thread-operations.js';

const SIDE_CONVERSATION_POLICY = [
  'You are in a temporary side conversation forked from a primary conversation.',
  'Treat all earlier messages as reference context only; do not continue or redirect the primary task.',
  'Answer the user’s side question directly. Prefer explanation and read-only inspection unless the user explicitly asks for a scoped change here.',
  'Do not create sub-agents or persistent goals from this side conversation.',
  'Work in this side conversation does not change the primary conversation.',
].join(' ');

/**
 * Creates a point-in-time, model-visible fork of a primary thread. The copied
 * history is hidden from the side transcript and the primary thread remains
 * entirely independent, including when its current turn is still streaming.
 */
export async function createRuntimeSideConversation(
  runtime: RuntimeContainer,
  parentThreadId: string,
): Promise<RuntimeThread> {
  await runtime.eventWriter.flushThread(parentThreadId);
  const parent = await runtime.threadStore.getThread(parentThreadId);
  if (!parent) {
    throw new RuntimeUseCaseError('thread_not_found', 'Thread not found', { threadId: parentThreadId });
  }
  if (parent.kind === 'side') {
    throw new RuntimeUseCaseError('invalid_input', 'A side conversation must be created from a primary thread.');
  }

  const inheritedMessages = parent.messages
    .filter((message) => message.visibility !== 'transcript')
    .map((message): RuntimeMessage => ({ ...message, visibility: 'model' }));
  const child = await runtime.threadStore.createThread({
    kind: 'side',
    title: 'Side conversation',
    projectId: parent.projectId,
    forkedFromId: parent.id,
    memoryMode: 'disabled',
  });
  const attachments = inheritedMessages.flatMap((message) => message.attachments ?? []);

  try {
    await runtime.attachmentStore.retainForThread(child.id, attachments);
    await copyRuntimeMessagesToThread(runtime, child.id, inheritedMessages);
    if (parent.activeTurnId) {
      await appendSideEvent(runtime, child.id, {
        id: randomRuntimeId('event_side_cancel'),
        threadId: child.id,
        turnId: parent.activeTurnId,
        type: 'turn.cancelled',
        createdAt: new Date().toISOString(),
        payload: {
          reason: 'The primary turn was still running when this side-conversation snapshot was created.',
        },
      });
    }
    await appendModelMessage(runtime, child.id, 'developer', SIDE_CONVERSATION_POLICY);
    await appendModelMessage(runtime, child.id, 'user', [
      '<side_conversation_boundary>',
      'The primary conversation ends above. Respond only to the new side-conversation messages that follow.',
      parent.activeTurnId
        ? 'The primary conversation was still running at snapshot time, so its latest response may be incomplete.'
        : 'The primary conversation was idle at snapshot time.',
      '</side_conversation_boundary>',
    ].join('\n'));
  } catch (error) {
    await runtime.attachmentStore.releaseThread(child.id).catch(() => undefined);
    await runtime.threadStore.deleteThread(child.id).catch(() => undefined);
    throw error;
  }

  return await runtime.threadStore.getThread(child.id) ?? child;
}

/** Removes side conversations left behind by an unclean desktop shutdown. */
export async function cleanupRuntimeSideConversations(runtime: RuntimeContainer): Promise<void> {
  const threads = await runtime.threadStore.listThreads({ includeArchived: true, includeSide: true });
  for (const thread of threads) {
    if (thread.kind !== 'side') continue;
    await deleteRuntimeThread(runtime, thread.id);
  }
}

async function appendModelMessage(
  runtime: RuntimeContainer,
  threadId: string,
  role: Extract<RuntimeMessage['role'], 'developer' | 'user'>,
  content: string,
): Promise<void> {
  const message: RuntimeMessage = {
    id: randomRuntimeId('msg_side'),
    role,
    content,
    createdAt: new Date().toISOString(),
    status: 'complete',
    visibility: 'model',
  };
  await appendSideEvent(runtime, threadId, {
    id: randomRuntimeId('event_side_message'),
    threadId,
    type: 'message.created',
    createdAt: message.createdAt,
    payload: { message },
  });
}

async function appendSideEvent(
  runtime: RuntimeContainer,
  threadId: string,
  event: Omit<RuntimeEvent, 'seq'>,
): Promise<void> {
  await runtime.threadStore.appendEvent(threadId, event);
}
