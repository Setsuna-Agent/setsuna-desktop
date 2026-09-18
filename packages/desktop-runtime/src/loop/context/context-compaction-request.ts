import {
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type ModelRequest,
  type RuntimeConfigState,
} from '@setsuna-desktop/contracts';
import { runtimeTaskModelRequest } from '../core/runtime-task-model.js';
import {
  COMPACTION_SUMMARY_CONTEXT_OVERHEAD_TOKENS,
  COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS,
  estimateRuntimeMessageTokens,
  type RuntimeContextCompactionCandidate,
} from './context-compaction.js';
import { compactionSummaryPrompt, compactionSummaryTokenLimit } from './context-compaction-summary.js';

/** Resolve and budget the actual summarizer, which may differ from the conversation model. */
export function contextCompactionRequest(input: {
  candidate: RuntimeContextCompactionCandidate;
  runtimeConfig?: RuntimeConfigState | null;
  conversationModel?: Pick<ModelRequest, 'model' | 'providerId'>;
  createdAt: string;
  retry: boolean;
}): { request: ModelRequest; summaryTokenLimit: number } {
  const { candidate, runtimeConfig, conversationModel, createdAt, retry } = input;
  const selected = runtimeTaskModelRequest(runtimeConfig, 'contextCompaction', 'context-compaction', conversationModel);
  const provider = runtimeConfig?.providers.find((item) => item.enabled && item.id === (selected.providerId ?? runtimeConfig.activeProviderId));
  const model = provider?.models.find((item) => item.code === selected.model)
    ?? (!selected.providerId ? provider?.models.find((item) => item.enabled) : undefined);
  const modelOutputLimit = model?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  let summaryTokenLimit = Math.min(compactionSummaryTokenLimit(candidate), modelOutputLimit);
  if (summaryTokenLimit < COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS) {
    throw new Error(`Context compaction has insufficient output budget on ${selected.model}; original history was retained.`);
  }
  let messages = compactionSummaryPrompt(candidate, createdAt, summaryTokenLimit, retry);
  const inputTokens = estimateRuntimeMessageTokens(messages);
  // Match the provider adapter's conservative fallback for uncatalogued models. A per-message
  // excerpt limit does not bound the aggregate prompt or make a smaller task model fit it.
  const contextWindow = model?.contextWindowTokens ?? 128_000;
  const maxOutputTokens = Math.floor(Math.min(
    modelOutputLimit,
    contextWindow - inputTokens - COMPACTION_SUMMARY_CONTEXT_OVERHEAD_TOKENS,
  ));
  if (maxOutputTokens < COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS) {
    throw new Error(`Context compaction input does not fit ${selected.model}: approximately ${inputTokens} input tokens leave fewer than ${COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS} output tokens in its ${contextWindow}-token window; original history was retained.`);
  }
  if (summaryTokenLimit > maxOutputTokens) {
    summaryTokenLimit = maxOutputTokens;
    messages = compactionSummaryPrompt(candidate, createdAt, summaryTokenLimit, retry);
  }
  return {
    summaryTokenLimit,
    request: {
      ...selected,
      messages,
      // This is the entire generation budget, including reasoning. Do not cap it at the
      // size of the persisted summary or rely on every provider supporting thinking=false.
      maxOutputTokens,
      thinking: model?.thinkingEnabled === true,
      ...(model?.thinkingEnabled ? { reasoningEffort: model.defaultThinkingEffort || model.thinkingEfforts[0] } : {}),
      toolChoice: 'none',
    },
  };
}
