import { createHash } from 'node:crypto';
import type { Provider, Model } from '@earendil-works/pi-ai';
import type { ModelCompactionRequest, ModelCompactionResult, RuntimeUsage } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import { preparePiRequest } from './pi-request-preparation.js';
import { streamForProvider } from './pi-provider-stream.js';
import { builtinCatalogProviderIdForConfig, getBuiltinCatalogProvider } from './provider-catalog.js';
import { compactOpenAiResponsesConversation } from './responses-compactor.js';
import { compactionFailure, compactionUsage, nativeCompactionResult, objectRecord, observeCompactionUsage, ResponsesCompactionContextLimitError, UnsupportedResponsesCompactionError } from './responses-compaction-result.js';

export type ResponsesCompactionProtocol = 'responses-v2' | 'responses-compact' | 'unsupported';

/** Capability decisions are lazy, configuration-scoped and never inferred from transport failure. */
export async function compactNativeResponses(
  request: ModelCompactionRequest,
  provider: ModelProviderRuntimeConfig,
  fetch: typeof globalThis.fetch,
  protocols: Map<string, ResponsesCompactionProtocol>,
  providers?: readonly Provider[],
): Promise<ModelCompactionResult> {
  const key = createHash('sha256').update(JSON.stringify([
    provider.id, provider.baseUrl, request.model, provider.apiKey, provider.requestHeaders, provider.proxyRoute,
  ])).digest('hex');
  const remember = (protocol: ResponsesCompactionProtocol) => {
    protocols.set(key, protocol);
    if (protocols.size > 64) protocols.delete(protocols.keys().next().value!);
  };
  const protocol = protocols.get(key);
  if (protocol === 'unsupported') return { kind: 'unsupported' };
  const prepared = preparePiRequest(provider, { ...request, responseFormat: undefined, toolChoice: undefined }, providers);
  let input: readonly unknown[] | undefined;
  if (protocol !== 'responses-compact') {
    try {
      const result = await compactV2(prepared, request, provider, fetch, providers, (items) => { input = items; });
      remember('responses-v2');
      return result;
    } catch (error) {
      request.signal?.throwIfAborted();
      if (error instanceof ResponsesCompactionContextLimitError) return { kind: 'context_limit' };
      if (!(error instanceof UnsupportedResponsesCompactionError)) throw error;
      remember('responses-compact');
    }
  }
  // The standalone API rejects configuration updates. Never silently strip them from a history.
  const model = prepared.model as Model<'openai-responses'>;
  if (input?.some((item) => objectRecord(item).type === 'configuration_update')
    || (model.api === 'openai-responses' && model.compat?.supportsMidConvoEffort && prepared.request.reasoningEffort)) {
    return { kind: 'unsupported' };
  }
  try {
    return await compactOpenAiResponsesConversation({ ...request, ...prepared.request }, provider, fetch, providers, input);
  } catch (error) {
    request.signal?.throwIfAborted();
    if (error instanceof ResponsesCompactionContextLimitError) return { kind: 'context_limit' };
    if (!(error instanceof UnsupportedResponsesCompactionError)) throw error;
    remember('unsupported');
    return { kind: 'unsupported' };
  }
}

async function compactV2(
  prepared: ReturnType<typeof preparePiRequest>,
  request: ModelCompactionRequest,
  provider: ModelProviderRuntimeConfig,
  fetch: typeof globalThis.fetch,
  providers: readonly Provider[] | undefined,
  captureInput: (items: readonly unknown[]) => void,
): Promise<ModelCompactionResult> {
  const items: unknown[] = [];
  let completed = false;
  let responseId: unknown;
  let usage: RuntimeUsage | undefined;
  let transportError: Error | undefined;
  const catalogId = builtinCatalogProviderIdForConfig(provider, providers);
  const catalog = catalogId ? getBuiltinCatalogProvider(catalogId, providers) : undefined;
  const events = streamForProvider(prepared.model, prepared.context, {
    ...prepared.request,
    apiKey: provider.apiKey.trim() || 'setsuna-no-provider-api-key',
    signal: request.signal ?? new AbortController().signal,
    fetch: async (url, init) => {
      transportError = undefined;
      const response = await fetch(url, init);
      if (!response.ok) transportError = compactionFailure(response.status, await response.clone().text().catch(() => ''), 'responses-v2');
      return response;
    },
  }, catalog, {
    onPayload: (payload) => {
      const body = objectRecord(payload);
      if (!Array.isArray(body.input)) throw new Error('Responses compaction requires a complete input window.');
      captureInput(body.input);
      return { ...body, input: [...body.input, { type: 'compaction_trigger' }] };
    },
    onProviderStreamEvent: (raw) => {
      const event = objectRecord(raw);
      if (event.type === 'response.output_item.done' && objectRecord(event.item).type === 'compaction') items.push(event.item);
      if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
        const response = objectRecord(event.response);
        usage = compactionUsage(response.usage, provider, prepared.request.model);
        observeCompactionUsage(request, usage);
        responseId = response.id;
        completed = event.type === 'response.completed' && response.status !== 'incomplete' && response.status !== 'failed';
      }
    },
  });
  for await (const event of events) {
    request.signal?.throwIfAborted();
    if (event.type === 'error') {
      const message = event.error.errorMessage || 'Responses compaction stream failed.';
      // The OpenAI SDK can throw SSE validation errors before the raw-event hook sees them.
      // Classify only explicit rejection before any output/usage; HTTP errors keep their status.
      throw transportError ?? (items.length || completed || usage || event.error.content.length
        ? new Error(message) : compactionFailure(undefined, message, 'responses-v2'));
    }
  }
  request.signal?.throwIfAborted();
  if (!completed) throw new Error('Responses compaction stream closed before response.completed.');
  if (items.length !== 1) throw new Error(`Responses compaction expected exactly one compaction item, received ${items.length}.`);
  return nativeCompactionResult(items, responseId, prepared.replayContext, 'responses-v2', usage);
}
