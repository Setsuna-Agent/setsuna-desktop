import type {
  PendingStoredThreadEvent,
  RuntimeMessage,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import type { SideConversationRuntimeHost } from '../contracts/index.js';
import {
  SideConversationInvalidParentError,
  SideConversationThreadNotFoundError,
} from './errors.js';

const SIDE_CONVERSATION_POLICY = [
  'You are in a temporary side conversation forked from a primary conversation.',
  'Messages enclosed by <primary_conversation_snapshot> are copied from the primary conversation and are available as reference context.',
  'Use that snapshot to answer questions about what the primary conversation said, asked, decided, or did; do not claim it is unavailable when the answer is present there.',
  'Messages after <side_conversation_boundary> belong to this side conversation. Do not continue or redirect the primary task.',
  'Answer the user’s side question directly. Prefer explanation and read-only inspection unless the user explicitly asks for a scoped change here.',
  'Do not create sub-agents or persistent goals from this side conversation.',
  'Work in this side conversation does not change the primary conversation.',
].join(' ');

const PRIMARY_SNAPSHOT_START = '<primary_conversation_snapshot>';

/** Creates a point-in-time, model-visible fork without mutating the primary thread. */
export async function createRuntimeSideConversation(
  host: SideConversationRuntimeHost,
  parentThreadId: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<RuntimeThread> {
  throwIfCancelled(options.signal);
  await host.flushThread(parentThreadId);
  throwIfCancelled(options.signal);
  const parent = await host.getThread(parentThreadId);
  if (!parent) throw new SideConversationThreadNotFoundError();
  if (parent.kind === 'side') throw new SideConversationInvalidParentError();
  throwIfCancelled(options.signal);

  const inheritedMessages = parent.messages
    .filter((message) => message.visibility !== 'transcript')
    .map((message): RuntimeMessage => ({ ...message, visibility: 'model' }));
  const child = await host.createThread({
    kind: 'side',
    title: 'Side conversation',
    projectId: parent.projectId,
    forkedFromId: parent.id,
    memoryMode: 'disabled',
    modelBinding: parent.modelBinding ? { ...parent.modelBinding } : undefined,
  });
  const attachments = inheritedMessages.flatMap((message) => message.attachments ?? []);

  try {
    // Core stores are not abort-aware. Check after every durable step so a
    // disconnected requester cannot publish an ownerless snapshot.
    throwIfCancelled(options.signal);
    await host.retainAttachments(child.id, attachments);
    throwIfCancelled(options.signal);
    await appendModelMessage(host, child.id, 'developer', SIDE_CONVERSATION_POLICY);
    throwIfCancelled(options.signal);
    await appendModelMessage(host, child.id, 'user', PRIMARY_SNAPSHOT_START);
    throwIfCancelled(options.signal);
    await host.copyMessages(parent.id, child.id, inheritedMessages);
    throwIfCancelled(options.signal);
    if (parent.activeTurnId) {
      await appendSideEvent(host, child.id, {
        id: host.id('event_side_cancel'),
        threadId: child.id,
        turnId: parent.activeTurnId,
        type: 'turn.cancelled',
        createdAt: host.now().toISOString(),
        payload: {
          reason: 'The primary turn was still running when this side-conversation snapshot was created.',
        },
      });
      throwIfCancelled(options.signal);
    }
    await appendModelMessage(host, child.id, 'user', [
      '</primary_conversation_snapshot>',
      '<side_conversation_boundary>',
      'The messages enclosed above are the point-in-time snapshot copied from the primary conversation.',
      'The side conversation begins after this boundary. Respond to its new messages without continuing the primary task.',
      parent.activeTurnId
        ? 'The primary conversation was still running at snapshot time, so its latest response may be incomplete.'
        : 'The primary conversation was idle at snapshot time.',
      '</side_conversation_boundary>',
    ].join('\n'));
    throwIfCancelled(options.signal);
    // Reassert after copied developer messages so inherited instructions cannot outrank the policy.
    await appendModelMessage(host, child.id, 'developer', SIDE_CONVERSATION_POLICY);
    throwIfCancelled(options.signal);
    const created = await host.getThread(child.id);
    throwIfCancelled(options.signal);
    return created ?? child;
  } catch (error) {
    await host.rollbackCreatedThread(child.id).catch(() => undefined);
    throw error;
  }
}

/** Removes transient side conversations left behind by an unclean renderer shutdown. */
export async function cleanupRuntimeSideConversations(
  host: SideConversationRuntimeHost,
): Promise<void> {
  const threads = await host.listThreads();
  for (const thread of threads) {
    if (thread.kind === 'side') await host.deleteThread(thread.id);
  }
}

async function appendModelMessage(
  host: SideConversationRuntimeHost,
  threadId: string,
  role: Extract<RuntimeMessage['role'], 'developer' | 'user'>,
  content: string,
): Promise<void> {
  const message: RuntimeMessage = {
    id: host.id('msg_side'),
    role,
    content,
    createdAt: host.now().toISOString(),
    status: 'complete',
    visibility: 'model',
  };
  await appendSideEvent(host, threadId, {
    id: host.id('event_side_message'),
    threadId,
    type: 'message.created',
    createdAt: message.createdAt,
    payload: { message },
  });
}

async function appendSideEvent(
  host: SideConversationRuntimeHost,
  threadId: string,
  event: PendingStoredThreadEvent,
): Promise<void> {
  await host.appendEvent(threadId, event);
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}
