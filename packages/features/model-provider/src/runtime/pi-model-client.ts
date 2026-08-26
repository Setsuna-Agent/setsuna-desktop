import {
  stream as streamAnthropic,
  type AnthropicEffort,
} from '@earendil-works/pi-ai/api/anthropic-messages';
import { stream as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import type {
  AnthropicOptions,
  AssistantMessageEvent,
  Context,
  Model,
  ModelThinkingLevel,
  OpenAICompletionsOptions,
  OpenAIResponsesOptions,
} from '@earendil-works/pi-ai';
import {
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type ModelCompactionRequest,
  type ModelCompactionResult,
  type ModelRequest,
  type ModelStreamEvent,
} from '@setsuna-desktop/contracts';
import type {
  ModelProviderRuntimeConfig,
  ModelProviderRuntimeHost,
  ModelProviderSamplingService,
} from '../contracts/index.js';
import { runWithModelTimeout, streamWithModelTimeout } from './model-request-timeout.js';
import {
  createPiModel,
  createPiReplayContext,
  providerReplayDecisions,
  toPiContext,
  type PiApi,
} from './pi-context.js';
import {
  bridgePiStream,
  type ProviderTransportFailure,
} from './pi-stream-bridge.js';
import {
  nextPiCompatibilityRetry,
  piResponseFormatPayload,
  withKnownPiRequestCompatibility,
} from './pi-request-compatibility.js';
import { builtinCatalogProviderIdForConfig, getBuiltinCatalogProvider } from './provider-catalog.js';

const EMPTY_API_KEY = 'setsuna-no-provider-api-key';
const LOCAL_SMOKE_MODEL = 'local-runtime-smoke';
const PI_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export class PiModelClient implements ModelProviderSamplingService {
  constructor(private readonly host: ModelProviderRuntimeHost) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const provider = await this.resolveRequestProvider(request);
    if (!provider || isBuiltInLocalSmokeProvider(provider)) {
      yield* localSmokeStream();
      return;
    }

    const modelId = provider.activeModel?.code || request.model;
    const compatibilityModel = createPiModel(provider, modelId);
    let currentRequest = withKnownPiRequestCompatibility(
      withProviderDefaults(request, provider, modelId),
      compatibilityModel,
    );
    while (true) {
      let emitted = false;
      try {
        for await (const event of this.streamConfigured(provider, currentRequest)) {
          emitted = true;
          yield event;
        }
        return;
      } catch (error) {
        if (emitted || request.signal?.aborted) throw error;
        const retryRequest = nextPiCompatibilityRetry(currentRequest, error, compatibilityModel.api);
        if (!retryRequest) throw error;
        currentRequest = retryRequest;
      }
    }
  }

  async compactConversation(request: ModelCompactionRequest): Promise<ModelCompactionResult> {
    const provider = await this.resolveRequestProvider(request);
    if (!provider || provider.provider !== 'openai-responses') {
      throw new Error('Native remote compaction is only supported by OpenAI Responses providers.');
    }
    const model = provider.activeModel?.code || request.model;
    const { compactOpenAiResponsesConversation } = await import('./responses-compactor.js');
    return runWithModelTimeout(
      (signal) => compactOpenAiResponsesConversation(
        { ...request, model, signal },
        provider,
        this.providerFetch(provider),
      ),
      request.signal,
    );
  }

  private async *streamConfigured(
    provider: ModelProviderRuntimeConfig,
    request: ModelRequest,
  ): AsyncGenerator<ModelStreamEvent> {
    const replayContext = createPiReplayContext(provider, request.model);
    this.publishProviderReplayDebug(request, replayContext);
    const model = createPiModel(provider, request.model, {
      forceAdaptiveThinking: usesAdaptiveAnthropicThinking(request),
    });
    const context = toPiContext(request, replayContext);
    const transportFailure: ProviderTransportFailure = {};
    const fetch = this.providerFetch(provider, transportFailure);
    const createStream = (signal: AbortSignal) => streamForProvider(model, context, {
      ...request,
      signal,
      apiKey: provider.apiKey.trim() || EMPTY_API_KEY,
      fetch,
    }, builtinCatalogProviderIdForConfig(provider));
    const events = streamWithModelTimeout(createStream, request.signal);
    yield* bridgePiStream(events, provider, replayContext, transportFailure);
  }

  private publishProviderReplayDebug(request: ModelRequest, replayContext: ReturnType<typeof createPiReplayContext>): void {
    const snapshot = request.stepSnapshot;
    if (!snapshot || !this.host.reportReplayDecisions) return;
    try {
      this.host.reportReplayDecisions({
        afterEventSeq: snapshot.threadLastSeq,
        decisions: providerReplayDecisions(request.messages, replayContext),
        threadId: snapshot.threadId,
        turnId: snapshot.turnId,
      });
    } catch {
      // Debug-only diagnostics must never affect model sampling.
    }
  }

  private async resolveRequestProvider(
    request: Pick<ModelRequest, 'providerId' | 'model'>,
  ): Promise<ModelProviderRuntimeConfig | null> {
    const provider = await this.host.resolveProvider(request.providerId);
    if (!provider?.enabled || !provider.activeModel?.code) {
      if (request.providerId && request.model !== LOCAL_SMOKE_MODEL) {
        throw new Error(`Configured provider is unavailable: ${request.providerId}`);
      }
      return null;
    }
    const requestedModel = request.model.trim();
    if (!requestedModel) return provider;
    const model = provider.models.find((candidate) => candidate.code === requestedModel);
    if (!model && request.providerId) {
      throw new Error(`Configured model is unavailable on provider ${provider.id}: ${requestedModel}`);
    }
    return model && model.id !== provider.activeModel.id
      ? { ...provider, activeModel: model }
      : provider;
  }

  private providerFetch(
    provider: ModelProviderRuntimeConfig,
    transportFailure?: ProviderTransportFailure,
  ): typeof fetch {
    const fetchImpl = this.host.fetchForRoute(provider.proxyRoute);
    const hasApiKey = Boolean(provider.apiKey.trim());
    return async (input, init) => {
      if (transportFailure) {
        delete transportFailure.status;
        delete transportFailure.code;
      }
      const headers = new Headers(init?.headers);
      if (!hasApiKey) {
        headers.delete('authorization');
        headers.delete('x-api-key');
      }
      try {
        const response = await fetchImpl(input, { ...init, headers });
        if (!response.ok && transportFailure) transportFailure.status = response.status;
        return response;
      } catch (error) {
        const code = safeNetworkErrorCode(error);
        if (code && transportFailure) transportFailure.code = code;
        throw error;
      }
    };
  }
}

function isBuiltInLocalSmokeProvider(provider: ModelProviderRuntimeConfig): boolean {
  return provider.id === 'local-test'
    && provider.activeModel?.code === LOCAL_SMOKE_MODEL
    && !provider.apiKey.trim();
}

function streamForProvider(
  model: Model<PiApi>,
  context: Context,
  input: ModelRequest & Readonly<{ apiKey: string; fetch: typeof fetch; signal: AbortSignal }>,
  catalogProviderId?: string,
): AsyncIterable<AssistantMessageEvent> {
  const common = {
    apiKey: input.apiKey,
    fetch: input.fetch,
    signal: input.signal,
    maxRetries: 0,
    maxTokens: input.maxOutputTokens,
    ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
  };
  const builtinProvider = catalogProviderId === model.provider
    ? getBuiltinCatalogProvider(catalogProviderId)
    : undefined;
  if (model.api === 'openai-responses') {
    const typedModel = model as Model<'openai-responses'>;
    const options = {
      ...common,
      toolChoice: openAiResponsesToolChoice(input.toolChoice),
      reasoningEffort: reasoningEffort(input),
      reasoningSummary: input.thinking ? 'auto' : null,
      onPayload: (payload) => piResponseFormatPayload(payload, input, 'openai-responses'),
    } satisfies OpenAIResponsesOptions;
    return builtinProvider
      ? builtinProvider.stream(typedModel, context, options)
      : streamOpenAiResponses(typedModel, context, options);
  }
  if (model.api === 'anthropic-messages') {
    const typedModel = model as Model<'anthropic-messages'>;
    const options = {
      ...common,
      toolChoice: anthropicToolChoice(input.toolChoice),
      ...anthropicThinkingOptions(input, typedModel),
      cacheRetention: input.stepSnapshot ? 'short' : 'none',
      onPayload: (payload) => piResponseFormatPayload(payload, input, 'anthropic-messages'),
    } satisfies AnthropicOptions;
    return builtinProvider
      ? builtinProvider.stream(typedModel, context, options)
      : streamAnthropic(typedModel, context, options);
  }
  const typedModel = model as Model<'openai-completions'>;
  const options = {
    ...common,
    toolChoice: openAiCompletionsToolChoice(input.toolChoice),
    reasoningEffort: reasoningEffort(input),
    onPayload: (payload) => piResponseFormatPayload(payload, input, 'openai-completions'),
  } satisfies OpenAICompletionsOptions;
  return builtinProvider
    ? builtinProvider.stream(typedModel, context, options)
    : streamOpenAiCompletions(typedModel, context, options);
}

function withProviderDefaults(
  request: ModelRequest,
  provider: ModelProviderRuntimeConfig,
  model: string,
): ModelRequest {
  const configuredModel = provider.activeModel;
  const thinking = request.thinking === true;
  const defaultEffort = configuredModel?.defaultThinkingEffort
    || configuredModel?.thinkingEfforts.find((effort) => effort.trim());
  return {
    ...request,
    model,
    maxOutputTokens: request.maxOutputTokens
      ?? configuredModel?.maxOutputTokens
      ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
    thinking,
    ...(thinking && !request.reasoningEffort && defaultEffort
      ? { reasoningEffort: defaultEffort }
      : {}),
  };
}

function reasoningEffort(request: Pick<ModelRequest, 'thinking' | 'reasoningEffort'>) {
  if (!request.thinking || !request.reasoningEffort) return undefined;
  const effort = request.reasoningEffort.trim().toLowerCase();
  return PI_REASONING_EFFORTS.has(effort)
    ? effort as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    : undefined;
}

function anthropicThinkingOptions(
  request: ModelRequest,
  model: Model<'anthropic-messages'>,
): Partial<AnthropicOptions> {
  if (!request.thinking) return { thinkingEnabled: false };
  if (model.compat?.forceAdaptiveThinking === true) {
    const effort = anthropicAdaptiveEffort(request.reasoningEffort, model);
    return { thinkingEnabled: true, ...(effort ? { effort } : {}) };
  }
  const maxTokens = request.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS;
  if (maxTokens <= 1_024) return { thinkingEnabled: false };
  const budget = anthropicThinkingBudget(request.reasoningEffort, maxTokens);
  return {
    thinkingEnabled: true,
    ...(budget ? { thinkingBudgetTokens: budget } : {}),
  };
}

function anthropicAdaptiveEffort(
  effort: unknown,
  model: Model<'anthropic-messages'>,
): AnthropicEffort | undefined {
  const normalized = typeof effort === 'string' ? effort.trim().toLowerCase() : '';
  if (!normalized || normalized === 'adaptive' || normalized === 'auto') return undefined;
  const mapped = model.thinkingLevelMap?.[normalized as ModelThinkingLevel];
  if (typeof mapped === 'string') {
    const mappedEffort = mapped.toLowerCase();
    if (mappedEffort === 'minimal' || mappedEffort === 'low') return 'low';
    return mappedEffort === 'medium' || mappedEffort === 'high'
      || mappedEffort === 'xhigh' || mappedEffort === 'max'
      ? mappedEffort
      : undefined;
  }
  const candidate = normalized;
  if (candidate === 'minimal' || candidate === 'low') return 'low';
  if (candidate === 'medium') return 'medium';
  if (candidate === 'high') return 'high';
  // Match Pi's adaptive Anthropic clamp: extended levels require an explicit
  // model mapping and otherwise fall back to the provider's highest base tier.
  return candidate === 'xhigh' || candidate === 'max' ? 'high' : undefined;
}

function safeNetworkErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/u.test(record.code.toUpperCase())) {
    return record.code.toUpperCase();
  }
  return safeNetworkErrorCode(record.cause, depth + 1);
}

function usesAdaptiveAnthropicThinking(request: ModelRequest): boolean {
  if (!request.thinking || typeof request.reasoningEffort !== 'string') return false;
  const effort = request.reasoningEffort.trim().toLowerCase();
  return effort === 'adaptive' || effort === 'auto';
}

function anthropicThinkingBudget(effort: unknown, maxTokens: number): number | undefined {
  const normalized = typeof effort === 'string' ? effort.trim().toLowerCase() : '';
  if (!normalized || normalized === 'adaptive' || normalized === 'auto') return undefined;
  const mapped = {
    minimal: 1_024,
    low: 2_048,
    medium: 4_096,
    high: 8_192,
    xhigh: 16_384,
  }[normalized];
  const requested = normalized === 'max' ? maxTokens - 1 : mapped ?? positiveInt(normalized);
  if (!requested) return undefined;
  return Math.max(1_024, Math.min(requested, maxTokens - 1));
}

function openAiCompletionsToolChoice(choice: ModelRequest['toolChoice']): OpenAICompletionsOptions['toolChoice'] {
  if (!choice || choice === 'auto' || choice === 'none') return choice;
  return { type: 'function', function: { name: choice.name } };
}

function openAiResponsesToolChoice(choice: ModelRequest['toolChoice']): OpenAIResponsesOptions['toolChoice'] {
  if (!choice || choice === 'auto' || choice === 'none') return choice;
  return { type: 'function', name: choice.name };
}

function anthropicToolChoice(choice: ModelRequest['toolChoice']): AnthropicOptions['toolChoice'] {
  if (!choice || choice === 'auto' || choice === 'none') return choice;
  return { type: 'tool', name: choice.name };
}

function positiveInt(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

async function* localSmokeStream(): AsyncGenerator<ModelStreamEvent> {
  const chunks = [
    'Local runtime is online. ',
    'No provider API key is configured yet, so the built-in smoke provider answered locally. ',
    'so no backend Agent API or remote WebView is involved yet.',
  ];
  for (const text of chunks) {
    await new Promise<void>((resolve) => setTimeout(resolve, 35));
    yield { type: 'text_delta', text };
  }
  const outputTokens = chunks.join('').length;
  yield {
    type: 'usage',
    usage: { provider: 'test', model: 'local-runtime-smoke', inputTokens: 0, outputTokens, totalTokens: outputTokens },
  };
  yield { type: 'done', finishReason: 'stop' };
}
