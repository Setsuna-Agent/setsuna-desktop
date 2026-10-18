import type { MessageDeleteInput, RuntimeMessage } from '../threads.js';
import { messagesInTranscriptOrder } from './transcript-order.js';

type MessageExchange = { promptId?: string; turnId?: string; ids: string[] };

/** Resolve chat selection against persisted history, never a page. Exact-ID
 * deletion remains the default for maintenance callers and older clients. */
export function resolveMessageDeletionIds(messages: RuntimeMessage[], input: MessageDeleteInput): string[] {
  if (input.scope !== undefined && input.scope !== 'messages' && input.scope !== 'turns') {
    throw new Error('Unknown message deletion scope.');
  }
  const selected = new Set(input.messageIds.map((id) => id.trim()).filter(Boolean));
  if (!selected.size) throw new Error('At least one message id is required.');
  if (input.scope !== 'turns') {
    const existing = new Set(messages.map((message) => message.id));
    return [...selected].filter((id) => existing.has(id));
  }

  const byTurn = new Map<string, MessageExchange>();
  const selectedExchanges = new Set<MessageExchange>();
  let current: MessageExchange | undefined;
  for (const message of messagesInTranscriptOrder(messages)) {
    const visiblePrompt = message.role === 'user' && message.visibility !== 'model' && !message.contextCompaction;
    // A question owns its answers, including regeneration/continuation executions
    // with new turn IDs. Turn IDs identify steers and otherwise unprompted runs;
    // they must not split an existing question/answer exchange.
    let owner = message.turnId ? byTurn.get(message.turnId) : undefined;
    if (!owner && visiblePrompt) owner = { ids: [] };
    if (!owner && message.turnId) {
      owner = current && (current.promptId || !current.turnId) ? current : { ids: [] };
    }
    // Untagged compaction notices do not start a question. Keep the legacy
    // exchange intact across them; native dependent checkpoints are pruned later.
    owner ??= current;
    if (!owner && message.role === 'assistant') owner = { ids: [] };
    if (!owner) continue; // Unowned initial system/developer context stays intact.
    owner.ids.push(message.id);
    if (visiblePrompt) owner.promptId ??= message.id;
    if (selected.has(message.id)) selectedExchanges.add(owner);
    if (message.turnId) {
      owner.turnId ??= message.turnId;
      byTurn.set(message.turnId, owner);
    }
    current = owner;
  }

  const ids = new Set(selected);
  for (const exchange of selectedExchanges) for (const id of exchange.ids) ids.add(id);
  return messages.filter((message) => ids.has(message.id)).map((message) => message.id);
}
