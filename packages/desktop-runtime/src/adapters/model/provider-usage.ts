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
