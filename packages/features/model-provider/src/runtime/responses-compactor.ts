import { convertResponsesMessages } from '@earendil-works/pi-ai/api/openai-responses-shared';
import { createGrammarToolInputProperties } from '@earendil-works/pi-ai/api/constrained-sampling';
import { getDeclaredTools, resolveTranscript } from '@earendil-works/pi-ai/utils/transcript';
import type { Provider, Model } from '@earendil-works/pi-ai';
import type { ModelCompactionRequest, ModelCompactionResult } from '@setsuna-desktop/contracts';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import { preparePiRequest } from './pi-request-preparation.js';
import { compactionFailure, compactionUsage, nativeCompactionResult, objectRecord, observeCompactionUsage } from './responses-compaction-result.js';

/** Legacy standalone endpoint; use Pi's serializer instead of maintaining another replay implementation. */
export async function compactOpenAiResponsesConversation(
  request: ModelCompactionRequest,
  provider: ModelProviderRuntimeConfig,
  fetchImpl: typeof fetch,
  providers?: readonly Provider[],
  preparedInput?: readonly unknown[],
): Promise<Extract<ModelCompactionResult, { kind: 'native' }>> {
  const prepared = preparePiRequest(provider, request, providers);
  const model = prepared.model as Model<'openai-responses'>;
  const compat = model.compat;
  const context = resolveTranscript(prepared.context, compat?.supportsMidConvoSystemMessages ?? false);
  const input = preparedInput ?? convertResponsesMessages(model, context, new Set(['openai', 'openai-codex', 'opencode']), {
    supportsMidConvoSystemMessages: compat?.supportsMidConvoSystemMessages ?? false,
    supportsAdditionalTools: compat?.supportsAdditionalTools ?? false,
    supportsToolSearch: compat?.supportsToolSearch ?? false,
    grammarToolInputProperties: createGrammarToolInputProperties(getDeclaredTools(context.messages), compat?.supportsOpenAIGrammarTools ?? false),
    toolOptions: { supportsStrictMode: compat?.supportsStrictMode ?? false, supportsOpenAIGrammarTools: compat?.supportsOpenAIGrammarTools ?? false },
  });
  const baseUrl = provider.baseUrl.trim().replace(/\/+$/u, '').replace(/\/responses$/iu, '');
  if (!baseUrl) throw new Error('Provider base URL is required.');
  const response = await fetchImpl(`${baseUrl}/responses/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(provider.apiKey.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : {}) },
    signal: request.signal,
    body: JSON.stringify({ model: prepared.request.model, input }),
  });
  if (!response.ok) throw compactionFailure(response.status, await response.text().catch(() => ''), 'responses-compact');
  const payload = objectRecord(await response.json());
  const nested = objectRecord(payload.response);
  const usage = compactionUsage(payload.usage ?? nested.usage, provider, request.model);
  observeCompactionUsage(request, usage);
  const output = payload.output ?? nested.output;
  return nativeCompactionResult(Array.isArray(output) ? output : [], payload.id ?? nested.id, prepared.replayContext, 'responses-compact', usage);
}
