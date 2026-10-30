import type { Provider } from '@earendil-works/pi-ai';
import {
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
  createPiReplayContext,
  providerReplayDecisions,
} from './pi-context.js';
import {
  bridgePiStream,
  type ProviderTransportFailure,
} from './pi-stream-bridge.js';
import {
  nextPiCompatibilityRetry,
} from './pi-request-compatibility.js';
import { builtinCatalogProviderIdForConfig, getBuiltinCatalogProvider } from './provider-catalog.js';
import { applyProviderRequestHeaders } from './provider-request-headers.js';
import { recoverIncompletePiStream } from './pi-stream-recovery.js';
import { ModelRequestDiagnostics } from './model-request-diagnostics.js';

import { preparePiRequest } from './pi-request-preparation.js';
import { streamForProvider } from './pi-provider-stream.js';
import type { ResponsesCompactionProtocol } from './responses-native-compactor.js';

const EMPTY_API_KEY = 'setsuna-no-provider-api-key';
const LOCAL_SMOKE_MODEL = 'local-runtime-smoke';

export class PiModelClient implements ModelProviderSamplingService {
  private readonly compactionProtocols = new Map<string, ResponsesCompactionProtocol>();
  constructor(
    private readonly host: ModelProviderRuntimeHost,
    private readonly providers?: readonly Provider[],
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const diagnostics = new ModelRequestDiagnostics(request, this.host.reportModelDiagnostic);
    diagnostics.record('model.started', { messageCount: request.messages.length, toolCount: request.tools?.length ?? 0 });
    try {
      const provider = await this.resolveRequestProvider(request);
      if (!provider || isBuiltInLocalSmokeProvider(provider)) {
        yield* localSmokeStream();
        return;
      }

      let prepared = preparePiRequest(provider, request, this.providers);
      const compatibilityModel = prepared.model;
      let currentRequest = prepared.request;
      while (true) {
        let emitted = false;
        try {
          for await (const event of this.streamConfigured(provider, prepared, diagnostics)) {
            emitted = true;
            diagnostics.observe(event);
            yield event;
          }
          diagnostics.record('model.completed');
          return;
        } catch (error) {
          if (emitted || request.signal?.aborted) throw error;
          const retryRequest = nextPiCompatibilityRetry(currentRequest, error, compatibilityModel.api);
          if (!retryRequest) throw error;
          diagnostics.record('model.compatibility_retry');
          currentRequest = retryRequest;
          prepared = preparePiRequest(provider, currentRequest, this.providers);
        }
      }
    } catch (error) {
      diagnostics.record('model.failed', { aborted: request.signal?.aborted ?? false });
      throw error;
    } finally {
      diagnostics.record('model.closed', { aborted: request.signal?.aborted ?? false });
    }
  }

  async compactConversation(request: ModelCompactionRequest): Promise<ModelCompactionResult> {
    const provider = await this.resolveRequestProvider(request);
    if (!provider || provider.provider !== 'openai-responses') {
      return { kind: 'unsupported' };
    }
    const model = provider.activeModel?.code || request.model;
    const { compactNativeResponses } = await import('./responses-native-compactor.js');
    return runWithModelTimeout(
      (signal) => compactNativeResponses(
        { ...request, model, signal },
        provider,
        this.providerFetch(provider, request.sessionId),
        this.compactionProtocols,
        this.providers,
      ),
      request.signal,
    );
  }

  private async *streamConfigured(
    provider: ModelProviderRuntimeConfig,
    prepared: ReturnType<typeof preparePiRequest>,
    diagnostics: ModelRequestDiagnostics,
  ): AsyncGenerator<ModelStreamEvent> {
    const { model, context, replayContext, request } = prepared;
    this.publishProviderReplayDebug(request, replayContext);
    diagnostics.record('provider.ready', {
      thinking: request.thinking, reasoningEffort: request.reasoningEffort,
      maxOutputTokens: request.maxOutputTokens,
    });
    const transportFailure: ProviderTransportFailure = {};
    const fetch = diagnostics.wrapFetch(this.providerFetch(provider, request.sessionId, transportFailure));
    const catalogProviderId = builtinCatalogProviderIdForConfig(provider, this.providers);
    const catalogProvider = catalogProviderId ? getBuiltinCatalogProvider(catalogProviderId, this.providers) : undefined;
    // All stream attempts and their backoff share this sampling step's total deadline.
    yield* streamWithModelTimeout((signal) => recoverIncompletePiStream(() => {
      const events = streamForProvider(model, context, {
        ...request,
        signal,
        apiKey: provider.apiKey.trim() || EMPTY_API_KEY,
        fetch,
      }, catalogProvider);
      return bridgePiStream(events, provider, replayContext, transportFailure);
    }, signal), request.signal);
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
    sessionId: string | undefined,
    transportFailure?: ProviderTransportFailure,
  ): typeof fetch {
    const fetchImpl = this.host.fetchForRoute(provider.proxyRoute);
    const hasApiKey = Boolean(provider.apiKey.trim());
    return async (input, init) => {
      if (transportFailure) {
        delete transportFailure.status;
        delete transportFailure.code;
      }
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!hasApiKey) {
        headers.delete('authorization');
        headers.delete('x-api-key');
      }
      // Remove only the SDK's placeholder credentials before applying explicit user headers.
      applyProviderRequestHeaders(headers, provider, { appVersion: this.host.appVersion, sessionId }, this.providers);
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

function safeNetworkErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 3) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.code === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/u.test(record.code.toUpperCase())) {
    return record.code.toUpperCase();
  }
  return safeNetworkErrorCode(record.cause, depth + 1);
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
