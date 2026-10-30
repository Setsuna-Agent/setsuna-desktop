import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ContextWindowSnapshot, PendingContextCompactionEvent, ThreadStore } from '../../ports/thread-store.js';
import { captureContextWindow, contextWindowMatches } from '../../utils/context-window-snapshot.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { estimateRuntimeMessageTokens } from './context-compaction.js';

export type CompactionSourceSnapshot = { messages: readonly RuntimeMessage[]; sourceMessageIds: readonly string[] };

/** Flush streaming deltas before capture; candidate rejection never poisons the shared writer. */
export class ContextCompactionCommitter {
  constructor(private readonly store: ThreadStore, private readonly writer: RuntimeEventWriter) {}

  async currentMessages(threadId: string): Promise<RuntimeMessage[] | undefined> {
    return (await this.store.getThread(threadId))?.messages;
  }

  async capture(threadId: string, messages: RuntimeMessage[], sourceSnapshot?: CompactionSourceSnapshot): Promise<ContextWindowSnapshot> {
    await this.writer.flushThread(threadId);
    const current = await this.store.getThread(threadId);
    if (!current) throw new Error(`Thread not found: ${threadId}`);
    // Coverage precedes provider restoration/normalization: an expanded native checkpoint must
    // also be replaced, while newly appended input not present in the request remains outside it.
    const expected = captureContextWindow(sourceSnapshot?.messages ?? messages,
      new Set(sourceSnapshot?.sourceMessageIds ?? messages.map((message) => message.id)));
    // Prompt/tool preparation can await I/O. Do not bless a newer prefix while sampling the older one.
    if (!contextWindowMatches(current.messages, expected)) throw new Error('Context changed before compaction; current history was retained.');
    return {
      ...expected,
      mutationSeq: current.contextBudgetInvalidatedAtSeq ?? 0,
    };
  }

  async commit(threadId: string, expected: ContextWindowSnapshot, event: PendingContextCompactionEvent, signal: AbortSignal) {
    signal.throwIfAborted();
    const coveredIds = new Set([...expected.messageIds, ...event.payload.messages.map((message) => message.id)]);
    const notice = event.payload.notice;
    const saved = await this.writer.commitCompaction(threadId, expected, event, {
      signal,
      acceptsWindow: (current) => {
        const appended = current.filter((message) => !coveredIds.has(message.id) && message.visibility !== 'transcript');
        return estimateRuntimeMessageTokens(appended) + (notice.compactedRequestTokens ?? notice.compactedTokens)
          < (notice.autoCompactTokenLimit ?? notice.maxContextTokens ?? notice.maxContextTokensK * 1_000);
      },
    });
    return saved?.type === 'thread.context_compacted' ? saved : null;
  }
}
