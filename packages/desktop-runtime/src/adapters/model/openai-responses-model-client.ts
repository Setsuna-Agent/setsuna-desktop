import { createOpenAI } from '@ai-sdk/openai';
import {
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  type ModelRequest,
  type ModelStreamEvent,
} from '@setsuna-desktop/contracts';
import { streamText } from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type {
  ModelClient,
  ModelCompactionRequest,
  ModelCompactionResult,
} from '../../ports/model-client.js';
import {
  toAiSdkToolChoice,
  toAiSdkTools,
} from './ai-sdk-prompt.js';
import { bridgeAiSdkStream } from './ai-sdk-stream-bridge.js';
import {
  toOpenAiResponsesAiSdkPrompt,
  toOpenAiResponsesInput,
} from './openai-provider-messages.js';
import {
  createOpenAiResponsesFetch,
  openAiSdkApiKey,
} from './openai-responses-extension-fetch.js';
import { OpenAiResponsesNativeEvents } from './openai-responses-native-events.js';
import {
  openAiResponsesMetadata,
  sanitizeOpenAiResponsesItems,
} from './openai-responses-provider-metadata.js';
import {
  assertOkResponse,
  bearerAuthHeader,
  requireFetch,
  withEndpoint,
  type FetchImpl,
} from './provider-http.js';
import { systemText } from './provider-message-content.js';
import {
  providerMetadataSource,
  providerReplayContext,
} from './provider-replay-context.js';
import { aiSdkOutputForRequest } from './provider-response-format.js';
import { openAiResponsesReasoningBody } from './provider-thinking.js';
import { normalizeOpenAiUsage } from './provider-usage.js';
import { objectValue, stringValue } from './provider-values.js';

export class OpenAiResponsesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const activeModel = this.provider.activeModel;
    const requestedModel = activeModel?.code || request.model;
    const replayContext = providerReplayContext(this.provider, requestedModel);
    const nativeEvents = new OpenAiResponsesNativeEvents(
      this.provider,
      replayContext,
      requestedModel,
    );
    const prompt = toOpenAiResponsesAiSdkPrompt(request.messages, replayContext);
    const apiKey = this.provider.apiKey.trim();
    const openai = createOpenAI({
      baseURL: normalizeOpenAiResponsesBaseUrl(this.provider.baseUrl),
      apiKey: openAiSdkApiKey(apiKey),
      fetch: createOpenAiResponsesFetch(
        this.fetchImpl,
        Boolean(apiKey),
        nativeEvents,
        prompt.nativeReplayInput,
      ),
    });
    const reasoning = objectValue(
      openAiResponsesReasoningBody(this.provider, request).reasoning,
    );
    const reasoningEffort = stringValue(reasoning.effort);
    const instructions = systemText(request.messages);
    const output = aiSdkOutputForRequest(request);
    const result = streamText({
      model: openai.responses(requestedModel),
      messages: prompt.messages,
      allowSystemInMessages: true,
      tools: toAiSdkTools(request.tools),
      toolChoice: toAiSdkToolChoice(request.toolChoice),
      maxOutputTokens: request.maxOutputTokens
        ?? activeModel?.maxOutputTokens
        ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
      ...(output ? { output } : {}),
      providerOptions: {
        openai: {
          store: false,
          include: ['reasoning.encrypted_content'],
          systemMessageMode: 'developer',
          ...(instructions ? { instructions } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
      },
      abortSignal: request.signal,
      maxRetries: 0,
      include: { rawChunks: true },
      onError: () => undefined,
    });

    yield* bridgeAiSdkStream(result.fullStream, {
      provider: this.provider,
      model: requestedModel,
      sideEvents: nativeEvents.liveEvents(),
      textItemId: (sourceId) => sourceId,
      toolCallArguments: (toolCallId) => nativeEvents.toolCallArguments(toolCallId),
      includeToolName: true,
      handleReasoning: false,
      useRawFinishReason: true,
      eventsForPart: (part) => nativeEvents.eventsForPart(part),
      beforeTerminalEvents: () => nativeEvents.terminalEvents(),
    });
  }

  async compactConversation(request: ModelCompactionRequest): Promise<ModelCompactionResult> {
    // The AI SDK provider does not expose the dedicated /responses/compact
    // endpoint, so native compaction remains a deliberately narrow extension.
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const requestedModel = activeModel?.code || request.model;
    const replayContext = providerReplayContext(this.provider, requestedModel);
    const instructions = systemText(request.messages);
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/responses/compact'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearerAuthHeader(this.provider.apiKey),
      },
      signal: request.signal,
      body: JSON.stringify({
        model: requestedModel,
        input: toOpenAiResponsesInput(request.messages, replayContext),
        ...(instructions ? { instructions } : {}),
      }),
    });
    await assertOkResponse(response, 'OpenAI Responses compact request failed');

    const payload = objectValue(await response.json().catch(() => null));
    const responsePayload = objectValue(payload.response);
    const usage = normalizeOpenAiUsage(payload.usage ?? responsePayload.usage);
    const replacementItems = responsesCompactionOutput(payload);
    const sanitizedItems = replacementItems
      ? sanitizeOpenAiResponsesItems(replacementItems, 'compaction')
      : undefined;
    if (!sanitizedItems) {
      throw new Error('OpenAI Responses compact response did not include a complete replayable replacement item list.');
    }
    const providerMetadata = openAiResponsesMetadata(providerMetadataSource(replayContext), {
      kind: 'compaction',
      responseId: stringValue(payload.id) || stringValue(responsePayload.id) || undefined,
      items: sanitizedItems,
    });
    if (!providerMetadata) {
      throw new Error('OpenAI Responses compact response could not be normalized into native metadata.');
    }
    const normalizedUsage = usage
      ? {
          ...usage,
          providerId: this.provider.id,
          provider: this.provider.name,
          model: requestedModel,
        }
      : undefined;
    return {
      kind: 'native',
      providerMetadata,
      ...(normalizedUsage ? { usage: normalizedUsage } : {}),
    };
  }
}

function normalizeOpenAiResponsesBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Provider base URL is required.');
  return trimmed.replace(/\/responses$/i, '');
}

function responsesCompactionOutput(payload: Record<string, unknown>): unknown[] | undefined {
  if (Array.isArray(payload.output)) return payload.output;
  const response = objectValue(payload.response);
  return Array.isArray(response.output) ? response.output : undefined;
}
