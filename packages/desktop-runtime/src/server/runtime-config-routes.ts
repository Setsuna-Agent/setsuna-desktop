import type { IncomingMessage, ServerResponse } from 'node:http';
import type { URL } from 'node:url';
import type { RuntimeConfigInput } from '@setsuna-desktop/contracts';
import {
  reviewModelSelectionCodec,
  type ReviewModelSelection,
} from '@setsuna-desktop/feature-review/contracts';
import { ProviderProxyReferenceError } from '../adapters/store/file-config-store.js';
import { RuntimeHttpError } from './http-error.js';
import { readBody, sendJson } from './http-utils.js';
import type { RuntimeFactory } from './types.js';

type LegacyRuntimeConfigInput = RuntimeConfigInput & {
  taskModels?: Record<string, unknown>;
};

export async function handleRuntimeConfigRequest(
  runtime: RuntimeFactory,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/v1/config') {
    const config = await runtime.configStore.getConfig();
    sendJson(response, 200, await legacyRuntimeConfigResponse(runtime, config));
    return true;
  }

  if (request.method === 'PUT' && url.pathname === '/v1/config') {
    const input = await readBody<LegacyRuntimeConfigInput>(request);
    const legacyReviewSelection = reviewSelectionFromLegacyConfigInput(input.taskModels);
    const coreMutation = coreConfigInputWithoutLegacyReview(input);
    if (legacyReviewSelection.provided && coreMutation.writes) {
      throw new RuntimeHttpError(
        400,
        'Core config and Review settings must be written in separate requests.',
        'mixed_review_config_write',
      );
    }
    const saved = coreMutation.writes
      ? await runtime.configStore.saveConfig(coreMutation.input)
      : await runtime.configStore.getConfig();
    if (legacyReviewSelection.provided) {
      const settings = await runtime.reviewControl.readSettings();
      await runtime.reviewControl.updateSettings({
        expectedRevision: settings.revision,
        selection: legacyReviewSelection.value,
      });
    }
    sendJson(response, 200, await legacyRuntimeConfigResponse(runtime, saved));
    return true;
  }

  const deletedProxyServerId = networkProxyDeleteId(url.pathname);
  if (request.method === 'DELETE' && deletedProxyServerId) {
    try {
      const state = await runtime.configStore.deleteProxyServerIfUnreferenced(
        deletedProxyServerId,
        () => runtime.nativeBridge.deleteNetworkProxy(deletedProxyServerId),
      );
      sendJson(response, 200, state);
    } catch (error) {
      if (error instanceof ProviderProxyReferenceError) {
        throw new RuntimeHttpError(409, error.message, 'network_proxy_in_use');
      }
      throw error;
    }
    return true;
  }

  return false;
}

async function legacyRuntimeConfigResponse(
  runtime: RuntimeFactory,
  config: Awaited<ReturnType<RuntimeFactory['configStore']['getConfig']>>,
) {
  // This legacy projection must never make the Core config endpoint depend on
  // the health of a separately recoverable Feature settings document.
  const review = await runtime.reviewControl.readSettings().catch(() => null);
  return Object.freeze({
    ...config,
    taskModels: Object.freeze({
      ...(config.taskModels ?? {}),
      ...(review?.selection ? { review: review.selection } : {}),
    }),
  });
}

function coreConfigInputWithoutLegacyReview(
  input: LegacyRuntimeConfigInput,
): Readonly<{ input: RuntimeConfigInput; writes: boolean }> {
  const coreInput = { ...input } as Record<string, unknown>;
  if (input.taskModels && typeof input.taskModels === 'object' && !Array.isArray(input.taskModels)) {
    const taskModels = { ...input.taskModels };
    delete taskModels.review;
    if (Object.keys(taskModels).length) coreInput.taskModels = taskModels;
    else delete coreInput.taskModels;
  }
  return Object.freeze({
    input: coreInput as RuntimeConfigInput,
    writes: Object.keys(coreInput).length > 0,
  });
}

function reviewSelectionFromLegacyConfigInput(
  taskModels: Record<string, unknown> | undefined,
): Readonly<{ provided: false; value: null } | { provided: true; value: ReviewModelSelection }> {
  if (!taskModels || !Object.hasOwn(taskModels, 'review')) {
    return Object.freeze({ provided: false, value: null });
  }
  try {
    return Object.freeze({
      provided: true,
      value: reviewModelSelectionCodec.parse(taskModels.review),
    });
  } catch (error) {
    throw new RuntimeHttpError(
      400,
      error instanceof Error ? error.message : String(error),
      'invalid_review_model',
    );
  }
}

function networkProxyDeleteId(pathname: string): string | null {
  const match = /^\/v1\/config\/network-proxy\/([^/]+)$/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const proxyServerId = decodeURIComponent(match[1]).trim();
    return proxyServerId || null;
  } catch {
    throw new RuntimeHttpError(400, 'Network proxy server ID is invalid.');
  }
}
