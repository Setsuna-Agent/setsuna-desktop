import { createAnthropic } from '@ai-sdk/anthropic';
import {
  DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS,
  type ModelRequest,
  type ModelStreamEvent,
} from '@setsuna-desktop/contracts';
import { streamText } from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  toAiSdkInstructions,
  toAiSdkMessages,
  toAiSdkToolChoice,
  toAiSdkTools,
} from './ai-sdk-prompt.js';
import { bridgeAiSdkStream } from './ai-sdk-stream-bridge.js';
import { AnthropicNativeMetadataCollector } from './anthropic-native-metadata.js';
import { anthropicAiSdkPromptOptions } from './anthropic-provider-messages.js';
import { requireFetch, type FetchImpl } from './provider-http.js';
import { providerReplayContext } from './provider-replay-context.js';
import { aiSdkOutputForRequest } from './provider-response-format.js';
import { anthropicThinkingBody } from './provider-thinking.js';

const EMPTY_API_KEY_PLACEHOLDER = 'setsuna-no-anthropic-api-key';

export class AnthropicMessagesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const activeModel = this.provider.activeModel;
    const requestedModel = activeModel?.code || request.model;
    const replayContext = providerReplayContext(this.provider, requestedModel);
    const configuredMaxOutputTokens = request.maxOutputTokens
      ?? activeModel?.maxOutputTokens
      ?? DEFAULT_ANTHROPIC_MODEL_MAX_OUTPUT_TOKENS;
    const thinking = anthropicThinkingBody(this.provider, {
      ...request,
      maxOutputTokens: configuredMaxOutputTokens,
    });
    const apiKey = this.provider.apiKey.trim();
    const anthropic = createAnthropic({
      baseURL: normalizeAnthropicBaseUrl(this.provider.baseUrl),
      apiKey: apiKey || EMPTY_API_KEY_PLACEHOLDER,
      fetch: createAnthropicFetch(this.fetchImpl, Boolean(apiKey)),
    });
    const collector = new AnthropicNativeMetadataCollector(
      this.provider,
      replayContext,
      requestedModel,
    );
    const output = aiSdkOutputForRequest(request);
    const result = streamText({
      model: anthropic(requestedModel),
      instructions: toAiSdkInstructions(request.messages),
      messages: toAiSdkMessages(
        request.messages,
        anthropicAiSdkPromptOptions(replayContext),
      ),
      tools: toAiSdkTools(request.tools),
      toolChoice: toAiSdkToolChoice(request.toolChoice),
      // Anthropic counts thinking inside max_tokens. AI SDK treats
      // maxOutputTokens as visible output and adds the budget itself.
      maxOutputTokens: anthropicVisibleOutputTokens(configuredMaxOutputTokens, thinking),
      ...(output ? { output } : {}),
      ...(thinking ? { providerOptions: { anthropic: { thinking: toAiSdkThinking(thinking) } } } : {}),
      abortSignal: request.signal,
      maxRetries: 0,
      include: { rawChunks: true },
      onError: () => undefined,
    });

    yield* bridgeAiSdkStream(result.fullStream, {
      provider: this.provider,
      model: requestedModel,
      textItemId: (sourceId) => `content_${sourceId}`,
      reasoningItemId: (sourceId) => `reasoning_${sourceId}`,
      includeToolName: true,
      useRawFinishReason: true,
      onPart: (part) => collector.observe(part),
      beforeTerminalEvents: () => collector.terminalEvents(),
    });
  }
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Provider base URL is required.');
  if (/\/v1\/messages$/i.test(trimmed)) return trimmed.replace(/\/messages$/i, '');
  if (/\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function createAnthropicFetch(fetchImpl: FetchImpl, sendApiKey: boolean) {
  const fetcher = requireFetch(fetchImpl);
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!sendApiKey) headers.delete('x-api-key');
    const normalizedHeaders: Record<string, string> = {};
    headers.forEach((value, name) => {
      normalizedHeaders[name] = value;
    });
    const target = input instanceof Request ? input.url : input;
    return fetcher(target instanceof URL ? target : String(target), {
      ...init,
      headers: normalizedHeaders,
    });
  };
}

function anthropicVisibleOutputTokens(
  maxOutputTokens: number,
  thinking: Record<string, unknown> | null,
): number {
  const budgetTokens = thinking?.type === 'enabled' && typeof thinking.budget_tokens === 'number'
    ? thinking.budget_tokens
    : 0;
  return Math.max(1, maxOutputTokens - budgetTokens);
}

function toAiSdkThinking(thinking: Record<string, unknown>) {
  if (thinking.type === 'adaptive') return { type: 'adaptive' as const };
  return {
    type: 'enabled' as const,
    budgetTokens: typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : undefined,
  };
}
