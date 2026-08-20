import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadModelBinding,
} from '@setsuna-desktop/contracts';
import {
  effectiveRuntimeThreadModelBinding,
  resolveRuntimeModelReference,
  type RuntimeResolvedTurnModel,
} from '../../loop/core/runtime-thread-model.js';
import {
  appendAndPublishRuntimeEvent,
  randomRuntimeId,
  requireRuntimeThread,
} from '../runtime-thread-events.js';
import type { RuntimeFactory } from '../types.js';
import { sweModelCatalogId } from './config-protocol.js';
import { AppServerRpcError } from './errors.js';

type AppServerModelCandidate = {
  model: ProviderModelConfig;
  provider: ProviderConfigState;
};

/** Resolves App Server's model string and makes it the sticky choice for later turns. */
export async function appServerTurnModelSelection(
  runtime: RuntimeFactory,
  threadId: string,
  value: unknown,
  providerValue?: unknown,
): Promise<RuntimeConfiguredModelReference | undefined> {
  const requestedModel = optionalModelInput(value, 'model');
  if (!requestedModel) return undefined;

  const requestedProvider = optionalModelInput(providerValue, 'modelProvider');
  const [config, thread] = await Promise.all([
    runtime.configStore.getConfig(),
    requireRuntimeThread(runtime, threadId),
  ]);
  const selected = resolveAppServerModel(
    config,
    thread,
    requestedModel,
    requestedProvider,
  );

  // The explicit reference snapshots this turn. The thread event independently records the
  // choice for later turns, while an already-running turn keeps its own turn.started binding.
  await runtime.agentLoop.withThreadMutation(threadId, async () => {
    const current = await requireRuntimeThread(runtime, threadId);
    if (sameModelBinding(current.modelBinding, selected.binding)) return;
    await appendAndPublishRuntimeEvent(runtime, threadId, {
      id: randomRuntimeId('event_model'),
      threadId,
      type: 'thread.updated',
      createdAt: new Date().toISOString(),
      payload: { modelBinding: { ...selected.binding } },
    });
  });

  return {
    providerId: selected.binding.providerId,
    modelId: selected.binding.modelId,
  };
}

function resolveAppServerModel(
  config: RuntimeConfigState,
  thread: RuntimeThread,
  requestedModel: string,
  requestedProvider?: string,
): RuntimeResolvedTurnModel {
  const candidates = configuredModelCandidates(config).filter(({ model, provider }) => (
    sweModelCatalogId(provider, model) === requestedModel
    || model.id === requestedModel
    || model.code.trim() === requestedModel
  ));
  const providerCandidates = requestedProvider
    ? candidates.filter(({ provider }) => provider.id === requestedProvider)
    : candidates;
  const selected = selectCandidate(config, thread, providerCandidates);
  if (!selected) {
    const qualifier = requestedProvider ? ` for provider ${requestedProvider}` : '';
    const reason = providerCandidates.length > 1 ? 'ambiguous' : 'unavailable';
    throw new AppServerRpcError(
      -32602,
      `The requested model is ${reason}${qualifier}: ${requestedModel}`,
    );
  }

  return resolveRuntimeModelReference(config, {
    providerId: selected.provider.id,
    modelId: selected.model.id,
  });
}

function configuredModelCandidates(config: RuntimeConfigState): AppServerModelCandidate[] {
  return config.providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.map((model) => ({ model, provider })));
}

function selectCandidate(
  config: RuntimeConfigState,
  thread: RuntimeThread,
  candidates: AppServerModelCandidate[],
): AppServerModelCandidate | undefined {
  if (candidates.length <= 1) return candidates[0];

  const boundProviderId = effectiveRuntimeThreadModelBinding(config, thread)?.providerId;
  const bound = candidates.filter(({ provider }) => provider.id === boundProviderId);
  if (bound.length === 1) return bound[0];

  const active = candidates.filter(({ provider }) => provider.id === config.activeProviderId);
  return active.length === 1 ? active[0] : undefined;
}

function optionalModelInput(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppServerRpcError(-32602, `${name} must be a non-empty string`);
  }
  return value.trim();
}

function sameModelBinding(
  left: RuntimeThreadModelBinding | undefined,
  right: RuntimeThreadModelBinding,
): boolean {
  return left?.providerId === right.providerId
    && left.modelId === right.modelId
    && left.modelCode === right.modelCode;
}
