import type { RuntimeMessage } from '../threads.js';

/** Native checkpoints retain their source messages in the existing transcript, not a second store. */
export function restoreNativeCompactionHistory(
  messages: RuntimeMessage[],
  canReplay: (message: RuntimeMessage) => boolean = () => false,
): RuntimeMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const restored = new Map<string, RuntimeMessage['visibility']>();
  const replaced = new Set<string>();
  const visiting = new Set<string>();
  const restore = (message: RuntimeMessage, visibility: RuntimeMessage['visibility']): void => {
    const ids = message.contextCompaction?.nativeSourceMessageIds;
    if (!ids || canReplay(message)) {
      restored.set(message.id, visibility);
      return;
    }
    if (!ids.length || visiting.has(message.id)) throw new Error('Native compaction source history is invalid; original history was retained.');
    visiting.add(message.id);
    replaced.add(message.id);
    for (const id of ids) {
      const original = byId.get(id);
      if (!original) throw new Error(`Native compaction source message ${id} is unavailable; original history was retained.`);
      restore(original, visibility);
    }
    visiting.delete(message.id);
  };
  for (const message of messages) {
    if (message.visibility !== 'transcript' && message.contextCompaction?.nativeSourceMessageIds) restore(message, message.visibility);
  }
  if (!replaced.size) return messages;
  // Keep transcript order and identities so a subsequent compaction can archive this window again.
  return messages.map<RuntimeMessage>((message) => replaced.has(message.id)
    ? { ...message, visibility: 'transcript' }
    : restored.has(message.id) ? { ...message, visibility: restored.get(message.id) } : message);
}

/** Deletion invalidates opaque state too; merely removing a source ID would retain deleted content. */
export function removeMessagesWithNativeCompaction(
  messages: RuntimeMessage[],
  deletedIds: ReadonlySet<string>,
): RuntimeMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const dependents = new Map<string, string[]>();
  for (const message of messages) {
    for (const sourceId of message.contextCompaction?.nativeSourceMessageIds ?? []) {
      const ids = dependents.get(sourceId) ?? [];
      ids.push(message.id);
      dependents.set(sourceId, ids);
    }
  }
  const invalidated = new Set(deletedIds);
  const pending = [...deletedIds];
  for (let index = 0; index < pending.length; index += 1) {
    for (const id of dependents.get(pending[index]!) ?? []) {
      if (invalidated.has(id)) continue;
      invalidated.add(id);
      pending.push(id);
    }
  }

  const restored = new Map<string, RuntimeMessage['visibility']>();
  const expanded = new Set<string>();
  const restoreSurvivors = (message: RuntimeMessage, visibility: RuntimeMessage['visibility']): void => {
    if (!invalidated.has(message.id)) {
      restored.set(message.id, visibility);
      return;
    }
    if (expanded.has(message.id)) return;
    expanded.add(message.id);
    // A removed checkpoint is a representation, not a request to remove all of its sources.
    for (const sourceId of message.contextCompaction?.nativeSourceMessageIds ?? []) {
      const source = byId.get(sourceId);
      if (source) restoreSurvivors(source, visibility);
    }
  };
  for (const message of messages) {
    if (message.visibility !== 'transcript' && invalidated.has(message.id)) {
      restoreSurvivors(message, message.visibility);
    }
  }
  return messages.filter((message) => !invalidated.has(message.id))
    .map((message) => restored.has(message.id) ? { ...message, visibility: restored.get(message.id) } : message);
}
