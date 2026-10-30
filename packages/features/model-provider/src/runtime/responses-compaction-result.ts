import { normalizeRuntimeMessageProviderMetadata, sanitizeResponsesItems, type ModelCompactionResult, type ModelCompactionRequest, type RuntimeUsage } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import type { PiReplayContext } from './pi-context.js';

export function compactionUsage(value: unknown, provider: ModelProviderRuntimeConfig, model: string): RuntimeUsage | undefined {
  const usage = objectRecord(value);
  const inputTokens = finiteNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = finiteNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = finiteNumber(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return {
    providerId: provider.id, provider: provider.name, model, inputTokens, outputTokens, totalTokens,
    cachedInputTokens: finiteNumber(objectRecord(usage.input_tokens_details ?? usage.prompt_tokens_details).cached_tokens),
  };
}

export function nativeCompactionResult(
  output: readonly unknown[], responseId: unknown, replay: PiReplayContext,
  mode: 'responses-v2' | 'responses-compact', usage?: RuntimeUsage,
): Extract<ModelCompactionResult, { kind: 'native' }> {
  const items = sanitizeResponsesItems(output, 'compaction');
  if (!items) throw new Error('OpenAI Responses compact response did not include a complete replayable replacement item list.');
  const providerMetadata = normalizeRuntimeMessageProviderMetadata({
    schemaVersion: 3,
    source: { providerId: replay.providerId, providerKind: replay.providerKind, model: replay.model, endpointFingerprint: replay.endpointFingerprint },
    openAiResponsesCompaction: {
      mode,
      ...(typeof responseId === 'string' ? { responseId } : {}), items,
    },
  });
  if (!providerMetadata) throw new Error('OpenAI Responses compact metadata exceeded the persistence boundary.');
  return { kind: 'native', mode, providerMetadata, ...(usage ? { usage } : {}) };
}

export function observeCompactionUsage(request: ModelCompactionRequest, usage: RuntimeUsage | undefined): void {
  if (usage) request.onUsage?.(usage);
}

export class UnsupportedResponsesCompactionError extends Error {}
export class ResponsesCompactionContextLimitError extends Error {}

/** Only explicit protocol rejection permits a fidelity-changing fallback. */
export function compactionFailure(status: number | undefined, body: string, mode: 'responses-v2' | 'responses-compact'): Error {
  const details = body.slice(0, 2_000);
  const validation = status === undefined || status === 400 || status === 422;
  if (validation && /context_length_exceeded|context_window_exceeded|maximum context length|exceeds? (?:the )?context (?:window|length)/iu.test(details)) {
    return new ResponsesCompactionContextLimitError('The native compaction input exceeds the model context window.');
  }
  const rejectedType = validation && /compaction_trigger|compaction/iu.test(details)
    && /unsupported|not supported|does not support|unknown|unrecognized|invalid.*(?:type|value)|not allowed/iu.test(details);
  const missingEndpoint = mode === 'responses-compact' && (status === 404 || status === 405 || status === 501)
    && !/model_not_found|invalid_api_key|authentication|permission/iu.test(details);
  const message = `OpenAI Responses compact request failed${status === undefined ? '' : ` (${status})`}: ${details.slice(0, 500)}`;
  return rejectedType || missingEndpoint ? new UnsupportedResponsesCompactionError(message) : new Error(message);
}

export function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
