import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import type { ToolResultStore } from '../../ports/tool-result-store.js';
import { estimateUtf8Tokens } from '../tools/tool-output-budget.js';
import { estimateRuntimeMessageTokens } from './context-compaction.js';

const KEEP_RECENT_RESULTS = 6;
const REFERENCE_PREFIX = '[Stored tool observation]';

/** Project old observations, never the transcript or assistant/native reasoning envelopes. */
export async function projectToolResultWorkingSet(input: {
  messages: RuntimeMessage[];
  transcriptMessages: readonly RuntimeMessage[];
  store?: ToolResultStore;
  threadId: string;
  conversationTokenLimit: number;
}): Promise<RuntimeMessage[]> {
  // A prior projection becomes the next step's history. Always rehydrate its body before
  // budgeting: a later tool call may have evicted the result even below the trigger.
  const messages = restoreToolObservations(input.messages, input.transcriptMessages);
  if (!input.store) return messages;
  const trigger = Math.min(40_000, Math.floor(input.conversationTokenLimit * 0.7));
  let tokens = estimateRuntimeMessageTokens(messages);
  if (tokens <= trigger) return messages;
  const recent = new Set(messages.filter(message => message.role === 'tool' && message.visibility !== 'transcript')
    .slice(-KEEP_RECENT_RESULTS).map(message => message.id));
  const projected = [...messages];
  for (let index = 0; index < projected.length && tokens > trigger; index += 1) {
    const message = projected[index];
    const ref = message.toolResultRef;
    // Local truncation stores only a prefix; the visible output can contain an unrecoverable tail.
    if (message.role !== 'tool' || message.visibility === 'transcript' || message.status !== 'complete'
      || !ref || ref.locallyTruncated || message.attachments?.length || recent.has(message.id)
      || message.content.startsWith(REFERENCE_PREFIX) || estimateUtf8Tokens(message.content) < 512) continue;
    // Quota eviction and I/O failure must not replace usable evidence with a dead reference.
    const available = await input.store.read(input.threadId, ref.resultId, 0, 1).catch(() => null);
    if (!available) continue;
    const content = [REFERENCE_PREFIX, `tool: ${message.toolName ?? 'unknown'}`,
      `tool_call_id: ${message.toolCallId ?? ''}`, `result_id: ${ref.resultId}`,
      `original_estimated_tokens: ${ref.originalEstimatedTokens}`,
      'Historical output. Use read_tool_result for the original text; re-read the workspace to check current state.',
    ].join('\n');
    const visibleTokens = estimateUtf8Tokens(content);
    tokens -= estimateUtf8Tokens(message.content) - visibleTokens;
    projected[index] = { ...message, content, toolResultRef: { ...ref, visibleTokens } };
  }
  return projected;
}

/** Restore bodies without changing the model/archival visibility or rewritten protocol IDs. */
export function restoreToolObservations(messages: RuntimeMessage[], transcript: readonly RuntimeMessage[]): RuntimeMessage[] {
  const isReference = (message: RuntimeMessage) => message.role === 'tool'
    && Boolean(message.toolResultRef) && message.content.startsWith(REFERENCE_PREFIX);
  if (!messages.some(isReference)) return messages;
  const originals = new Map(transcript.map(message => [message.id, message]));
  return messages.map(message => {
    if (!isReference(message)) return message;
    const original = originals.get(message.id);
    if (!original || original.toolResultRef?.resultId !== message.toolResultRef?.resultId) return message;
    return { ...message, content: original.content, toolResultRef: original.toolResultRef };
  });
}
