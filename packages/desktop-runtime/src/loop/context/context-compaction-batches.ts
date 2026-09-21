import { estimateRuntimeMessageTokens } from './context-compaction.js';
import type { ContextCompactionRequestBudget } from './context-compaction-request.js';
import { compactionSummaryPrompt, type CompactionSummarySource } from './context-compaction-summary.js';

/** Split only the summary input; the original history is committed after every batch succeeds. */
export function nextContextCompactionBatch(input: {
  source: CompactionSummarySource;
  previousSummary: string;
  budget: ContextCompactionRequestBudget;
  createdAt: string;
}): { source: CompactionSummarySource; remaining: CompactionSummarySource } {
  const { source, previousSummary, budget, createdAt } = input;
  const fits = (part: CompactionSummarySource): boolean => estimateRuntimeMessageTokens(
    // Plan for the longer retry prompt so a retry never changes the batch boundary.
    compactionSummaryPrompt(part, createdAt, budget.summaryTokenLimit, true, previousSummary),
  ) <= budget.inputTokenLimit;
  if (fits(source)) return { source, remaining: { olderHistory: '', recentContext: '' } };

  const length = source.olderHistory.length + source.recentContext.length;
  let low = 0;
  let high = length;
  // Measure the serialized prompt, including escaping and the accumulated summary.
  // A single message can contain many tool calls, so message-count limits are insufficient.
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(sourcePrefix(source, middle))) low = middle;
    else high = middle - 1;
  }
  const count = batchBoundary(source, low);
  if (count === 0) {
    throw new Error(`Context compaction has insufficient input budget on ${budget.modelRequest.model}; original history was retained.`);
  }
  return {
    source: sourcePrefix(source, count),
    remaining: {
      olderHistory: source.olderHistory.slice(count),
      recentContext: source.recentContext.slice(Math.max(0, count - source.olderHistory.length)),
    },
  };
}

function sourcePrefix(source: CompactionSummarySource, count: number): CompactionSummarySource {
  return {
    olderHistory: source.olderHistory.slice(0, count),
    recentContext: source.recentContext.slice(0, Math.max(0, count - source.olderHistory.length)),
  };
}

function batchBoundary(source: CompactionSummarySource, limit: number): number {
  if (limit === 0) return 0;
  const inOlder = limit <= source.olderHistory.length;
  const offset = inOlder ? 0 : source.olderHistory.length;
  const text = inOlder ? source.olderHistory : source.recentContext;
  const end = limit - offset;
  // Prefer a message or line boundary, but still make progress on large single records.
  const newline = text.lastIndexOf('\n', end - 1);
  if (offset + newline + 1 > limit / 2) return offset + newline + 1;
  // Keep UTF-16 surrogate pairs together when a single line must be split.
  const last = text.charCodeAt(end - 1);
  return last >= 0xD800 && last <= 0xDBFF ? limit - 1 : limit;
}
