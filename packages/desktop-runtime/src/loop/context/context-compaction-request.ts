import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
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
import { compactionSummaryPrompt, compactionSummaryTokenLimit, type CompactionSummarySource } from './context-compaction-summary.js';

export type ContextCompactionRequestBudget = {
  modelRequest: Omit<ModelRequest, 'messages'>;
  contextWindow: number;
  modelOutputLimit: number;
  summaryTokenLimit: number;
  inputTokenLimit: number;
};

/** Resolve the actual summarizer once, including room for a handoff between batches. */
export function contextCompactionRequestBudget(input: {
  candidate: RuntimeContextCompactionCandidate;
  runtimeConfig?: RuntimeConfigState | null;
  conversationModel?: Pick<ModelRequest, 'model' | 'providerId'>;
}): ContextCompactionRequestBudget {
  const { candidate, runtimeConfig, conversationModel } = input;
  const selected = runtimeTaskModelRequest(runtimeConfig, 'contextCompaction', 'context-compaction', conversationModel);
  const provider = runtimeConfig?.providers.find((item) => item.enabled && item.id === (selected.providerId ?? runtimeConfig.activeProviderId));
  const model = provider?.models.find((item) => item.code === selected.model)
    ?? (!selected.providerId ? provider?.models.find((item) => item.enabled) : undefined);
  const modelOutputLimit = model?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  const contextWindow = model?.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  const summaryTokenLimit = Math.min(
    compactionSummaryTokenLimit(candidate), modelOutputLimit,
    Math.max(COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS, Math.floor(contextWindow / 8)),
  );
  if (summaryTokenLimit < COMPACTION_SUMMARY_MIN_OUTPUT_TOKENS) {
    throw new Error(`Context compaction has insufficient output budget on ${selected.model}; original history was retained.`);
  }
  // The visible handoff is not the generation budget: reasoning needs space too.
  // Leave at least a quarter of the window for generation when the model allows it.
  const outputReserve = Math.min(modelOutputLimit, Math.max(summaryTokenLimit, Math.floor(contextWindow / 4)));
  return {
    contextWindow, modelOutputLimit, summaryTokenLimit,
    inputTokenLimit: contextWindow - outputReserve - COMPACTION_SUMMARY_CONTEXT_OVERHEAD_TOKENS,
    modelRequest: {
      ...selected,
      thinking: model?.thinkingEnabled === true,
      ...(model?.thinkingEnabled ? { reasoningEffort: model.defaultThinkingEffort || model.thinkingEfforts[0] } : {}),
      toolChoice: 'none',
    },
  };
}

export function contextCompactionRequest(input: {
  budget: ContextCompactionRequestBudget;
  source: CompactionSummarySource;
  previousSummary: string;
  createdAt: string;
  retry: boolean;
}): ModelRequest {
  const { budget, source, previousSummary, createdAt, retry } = input;
  const messages = compactionSummaryPrompt(source, createdAt, budget.summaryTokenLimit, retry, previousSummary);
  const inputTokens = estimateRuntimeMessageTokens(messages);
  const maxOutputTokens = Math.floor(Math.min(
    budget.modelOutputLimit,
    budget.contextWindow - inputTokens - COMPACTION_SUMMARY_CONTEXT_OVERHEAD_TOKENS,
  ));
  if (maxOutputTokens < budget.summaryTokenLimit) {
    throw new Error(`Context compaction has insufficient output budget on ${budget.modelRequest.model}; original history was retained.`);
  }
  return { ...budget.modelRequest, messages, maxOutputTokens };
}
