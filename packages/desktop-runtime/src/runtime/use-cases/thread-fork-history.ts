import { applyRuntimeEventToThread, type RuntimeEvent, type RuntimeMessage, type RuntimeThread, type StoredThreadEvent } from '@setsuna-desktop/contracts';
import type { ThreadStore } from '../../ports/thread-store.js';
import { RuntimeUseCaseError } from './errors.js';

type CopyEvent = Pick<Extract<RuntimeEvent, { type: 'message.created' }>, 'type' | 'payload' | 'turnId'>
  | Pick<Extract<RuntimeEvent, { type: 'thread.context_compacted' }>, 'type' | 'payload' | 'turnId'>;

/** Keep the context transitions, not turns/tool execution, so a fork can itself be forked historically. */
export function runtimeMessageCopyEvents(events: StoredThreadEvent[], messages: RuntimeMessage[]): CopyEvent[] {
  if (!events.length) return messages.map((message) => ({ type: 'message.created', turnId: message.turnId, payload: { message } }));
  const selected = new Map(messages.map((message) => [message.id, message]));
  const seen = new Set<string>();
  const copied: CopyEvent[] = [];
  let through = 0;
  let historical: RuntimeThread = {
    id: '', title: '', createdAt: '', updatedAt: '', archived: false,
    messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  for (const event of events) {
    historical = applyRuntimeEventToThread(historical, event);
    if (event.type === 'thread.context_cleared') {
      // A later fork must never recover checkpoints from before the clear boundary.
      copied.length = 0;
      seen.clear();
      through = 0;
      continue;
    }
    if (event.type === 'thread.context_compacted') {
      const window = event.payload.messages.flatMap((message) => {
        const current = selected.get(message.id);
        // Old model-only checkpoints may have disappeared from the latest window.
        // Ordinary deleted messages must never be resurrected by the copy.
        return current ? [{ ...current, visibility: message.visibility }]
          : message.visibility === 'model' && message.contextCompaction ? [message] : [];
      });
      copied.push({ type: 'thread.context_compacted', turnId: event.turnId,
        payload: { notice: event.payload.notice, messages: window } });
    }
    for (const message of historical.messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      const current = selected.get(message.id);
      if (!current) continue;
      if (event.type !== 'thread.context_compacted') {
        copied.push({ type: 'message.created', turnId: current.turnId,
          payload: { message: { ...current, visibility: message.visibility } } });
      }
      through = copied.length;
    }
    if (event.type === 'message.completed' && selected.has(event.payload.messageId)) through = copied.length;
  }
  // Ignore compactions after the selected boundary, even if they re-archive its messages.
  const result = copied.slice(0, through);
  for (const message of messages) {
    if (!seen.has(message.id)) result.push({ type: 'message.created', turnId: message.turnId, payload: { message } });
  }
  return result;
}

/** Resolve the boundary from durable messages, including history outside the renderer's page. */
export async function runtimeMessagesThroughMessage(
  store: ThreadStore,
  source: RuntimeThread,
  messageId: string,
): Promise<RuntimeMessage[]> {
  const index = source.messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw new RuntimeUseCaseError('invalid_input', 'Fork message not found.');
  if (source.messages[index].status === 'streaming') {
    throw new RuntimeUseCaseError('conflict', 'Cannot fork a message that is still streaming.');
  }
  if (!source.messages.some((message) => message.contextCompaction)) return source.messages.slice(0, index + 1);
  const events = await store.listEvents(source.id);
  const boundary = [...events].reverse().find((event) => event.seq <= source.lastSeq && (
    (event.type === 'message.created' && event.payload.message.id === messageId)
    || (event.type === 'message.completed' && event.payload.messageId === messageId)
  ));
  if (!boundary) throw new RuntimeUseCaseError('invalid_request', 'Fork message history is unavailable.');

  // Compaction reorders the model window and archives old messages. A slice of today's
  // snapshot can therefore lose the entire prompt or leak a later summary into the fork.
  let historical: RuntimeThread = {
    id: source.id, title: source.title, createdAt: source.createdAt, updatedAt: source.createdAt,
    archived: false, messageCount: 0, lastMessagePreview: '', messages: [], lastSeq: 0,
  };
  for (const event of events) {
    if (event.seq > boundary.seq) break;
    historical = applyRuntimeEventToThread(historical, event);
  }
  const currentMessages = new Map(source.messages.map((message) => [message.id, message]));
  return historical.messages.flatMap((message) => {
    const current = currentMessages.get(message.id);
    // Keep historical model-only compaction checkpoints, but respect messages the user deleted.
    if (!current) return message.visibility === 'model' ? [message] : [];
    return [{ ...current, visibility: message.visibility }];
  });
}
