import { stream as streamAnthropic, type AnthropicEffort } from '@earendil-works/pi-ai/api/anthropic-messages';
import { stream as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { stream as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import type { TranscriptContext } from '@earendil-works/pi-ai/utils/transcript';
import type { AnthropicOptions, AssistantMessageEvent, Model, ModelThinkingLevel, OpenAICompletionsOptions, OpenAIResponsesOptions, Provider } from '@earendil-works/pi-ai';
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS, type ModelRequest } from '@setsuna-desktop/contracts';
import type { PiApi } from './pi-context.js';
import { piOpenAiRequestPayload, piResponseFormatPayload, type PiModelRequest } from './pi-request-compatibility.js';
import { getBuiltinCatalogProvider } from './provider-catalog.js';

export type PiResponsesHooks = Pick<OpenAIResponsesOptions, 'onPayload' | 'onProviderStreamEvent'>;

export function streamForProvider(
  model: Model<PiApi>,
  context: TranscriptContext,
  input: PiModelRequest & Readonly<{ apiKey: string; fetch: typeof fetch; signal: AbortSignal }>,
  catalogProvider?: Provider,
  hooks?: PiResponsesHooks,
): AsyncIterable<AssistantMessageEvent> {
  const common = {
    apiKey: input.apiKey,
    fetch: input.fetch,
    signal: input.signal,
    // Pi retries transient request failures with abortable backoff before emitting
    // output, preserving this sampling step and its already-completed tool results.
    maxRetries: 3,
    maxTokens: input.maxOutputTokens,
    // 同一任务的工具续跑及后续轮次共享缓存亲和性；不能使用每轮变化的 turnId。
    sessionId: input.sessionId,
    ...(typeof input.temperature === 'number' ? { temperature: input.temperature } : {}),
  };
  // A catalog upgrade can change a provider's protocol (e.g. Kimi Code). Keep
  // saved connections on their configured API instead of invoking the new adapter.
  const builtinProvider = catalogProvider?.id === model.provider
    && getBuiltinCatalogProvider(model.provider)?.getModels().some((candidate) => candidate.api === model.api)
    ? catalogProvider
    : undefined;
  if (model.api === 'openai-responses') {
    const typedModel = model as Model<'openai-responses'>;
    const options = {
      ...common,
      toolChoice: openAiResponsesToolChoice(input.toolChoice),
      reasoningEffort: reasoningEffort(input),
      reasoningSummary: input.thinking ? 'auto' : null,
      onPayload: (payload) => {
        const compatible = piOpenAiRequestPayload(payload, input, typedModel) ?? payload;
        return hooks?.onPayload ? hooks.onPayload(compatible, typedModel) : compatible;
      },
      onProviderStreamEvent: hooks?.onProviderStreamEvent,
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
    onPayload: (payload) => piOpenAiRequestPayload(payload, input, typedModel),
  } satisfies OpenAICompletionsOptions;
  return builtinProvider
    ? builtinProvider.stream(typedModel, context, options)
    : streamOpenAiCompletions(typedModel, context, options);
}

function reasoningEffort(
  request: Pick<ModelRequest, 'thinking' | 'reasoningEffort'>,
): OpenAICompletionsOptions['reasoningEffort'] {
  if (!request.thinking || !request.reasoningEffort) return undefined;
  // Pi accepts wire values at runtime; its narrower type must not silently
  // discard user-configured levels such as `none` or a gateway-specific value.
  return (request.reasoningEffort.trim() || undefined) as OpenAICompletionsOptions['reasoningEffort'];
}

function anthropicThinkingOptions(
  request: PiModelRequest,
  model: Model<'anthropic-messages'>,
): Partial<AnthropicOptions> {
  if (request.anthropicThinkingMode === 'default') return {};
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

export function usesAdaptiveAnthropicThinking(request: ModelRequest): boolean {
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
