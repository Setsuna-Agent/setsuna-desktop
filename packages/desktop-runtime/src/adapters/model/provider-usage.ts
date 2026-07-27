import type { RuntimeUsage } from '@setsuna-desktop/contracts';
import { numberValue, objectValue } from './provider-values.js';

export function normalizeOpenAiUsage(value: unknown): RuntimeUsage | undefined {
  const usage = objectValue(value);
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
  const inputDetails = objectValue(usage.prompt_tokens_details ?? usage.input_tokens_details ?? usage.input_token_details);
  const cachedInputTokens = numberValue(
    inputDetails.cached_tokens ?? usage.cached_input_tokens ?? usage.input_cached_tokens,
  );
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = numberValue(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}

export function normalizeAnthropicUsage(value: unknown): RuntimeUsage | undefined {
  const usage = objectValue(value);
  const uncachedInputTokens = numberValue(usage.input_tokens);
  const cachedInputTokens = numberValue(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = numberValue(usage.cache_creation_input_tokens);
  const inputParts = [uncachedInputTokens, cachedInputTokens, cacheCreationInputTokens]
    .filter((count): count is number => count !== undefined);
  const inputTokens = inputParts.length ? inputParts.reduce((total, count) => total + count, 0) : undefined;
  const outputTokens = numberValue(usage.output_tokens);
  const totalTokens = inputTokens !== undefined || outputTokens !== undefined
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, totalTokens };
}
