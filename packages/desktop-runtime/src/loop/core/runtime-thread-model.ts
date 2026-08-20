import type {
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadModelBinding,
} from '@setsuna-desktop/contracts';

export type RuntimeResolvedTurnModel = {
  binding: RuntimeThreadModelBinding;
  model: ProviderModelConfig;
};

/**
 * Returns the model currently selected for a thread. Legacy threads are inferred from their first
 * conversation-model response, so callers must pass the complete thread projection rather than
 * a paginated message window.
 */
export function effectiveRuntimeThreadModelBinding(
  config: RuntimeConfigState | null | undefined,
  thread: RuntimeThread,
): RuntimeThreadModelBinding | undefined {
  if (thread.modelBinding) return { ...thread.modelBinding };
  return inferLegacyBinding(config, thread)?.binding;
}

/**
 * Resolves the conversation model once, before a turn starts. An explicit request selects that
 * new turn, while an already-running turn keeps its own snapshot across every sampling step.
 */
export function resolveRuntimeTurnModel(
  config: RuntimeConfigState | null | undefined,
  thread: RuntimeThread,
  requested?: RuntimeConfiguredModelReference,
): RuntimeResolvedTurnModel | undefined {
  if (requested) return resolveRuntimeModelReference(config, requested);

  const activeTurnBinding = thread.activeTurnId
    ? thread.turns?.find((turn) => (
        turn.id === thread.activeTurnId && turn.status === 'in_progress'
      ))?.modelBinding
    : undefined;
  if (activeTurnBinding) return resolveBinding(config, activeTurnBinding);

  return resolveRuntimeNextTurnModel(config, thread);
}

/** Resolves a queued/future turn without inheriting the currently running turn snapshot. */
export function resolveRuntimeNextTurnModel(
  config: RuntimeConfigState | null | undefined,
  thread: RuntimeThread,
  requested?: RuntimeConfiguredModelReference,
): RuntimeResolvedTurnModel | undefined {
  if (requested) return resolveRuntimeModelReference(config, requested);

  if (thread.modelBinding) return resolveBinding(config, thread.modelBinding);

  const inferred = inferLegacyBinding(config, thread);
  if (inferred) return inferred;

  const activeProviderId = config?.activeProviderId?.trim();
  // A configured active id is authoritative. Falling through to another provider can accidentally
  // promote a provider that exists only for a background task into the conversation model.
  const provider = activeProviderId
    ? config?.providers.find((item) => item.id === activeProviderId && item.enabled)
    : config?.providers.find((item) => item.enabled);
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0];
  return provider && model ? resolved(provider.id, model) : undefined;
}

function resolveBinding(
  config: RuntimeConfigState | null | undefined,
  binding: RuntimeThreadModelBinding,
): RuntimeResolvedTurnModel {
  const provider = config?.providers.find((item) => item.id === binding.providerId && item.enabled);
  const model = provider?.models.find((item) => (
    item.id === binding.modelId && item.code.trim() === binding.modelCode
  ));
  if (!provider || !model) {
    throw new Error(`The model bound to this conversation is no longer available: ${binding.modelCode}`);
  }
  return { binding: { ...binding }, model };
}

export function resolveRuntimeModelReference(
  config: RuntimeConfigState | null | undefined,
  reference: RuntimeConfiguredModelReference,
): RuntimeResolvedTurnModel {
  const provider = config?.providers.find((item) => item.id === reference.providerId && item.enabled);
  const model = provider?.models.find((item) => item.id === reference.modelId);
  if (!provider || !model) throw new Error('The selected model is no longer available.');
  return resolved(provider.id, model);
}

function inferLegacyBinding(
  config: RuntimeConfigState | null | undefined,
  thread: RuntimeThread,
): RuntimeResolvedTurnModel | undefined {
  const nonConversationTurnIds = new Set(
    (thread.turns ?? [])
      .filter((turn) => turn.taskKind === 'review' || turn.taskKind === 'compact' || turn.taskKind === 'user_shell')
      .map((turn) => turn.id),
  );
  const source = thread.messages.find((message) => (
    message.role === 'assistant'
    && !message.contextCompaction
    && !message.reviewMode
    && !nonConversationTurnIds.has(message.turnId ?? '')
    && message.providerMetadata?.source
  ))?.providerMetadata?.source;
  if (!source) return undefined;

  const provider = config?.providers.find((item) => (
    item.id === source.providerId
    && item.provider === source.providerKind
    && item.enabled
  ));
  const model = provider?.models.find((item) => item.code.trim() === source.model.trim());
  return provider && model ? resolved(provider.id, model) : undefined;
}

function resolved(providerId: string, model: ProviderModelConfig): RuntimeResolvedTurnModel {
  return {
    binding: {
      providerId,
      modelId: model.id,
      modelCode: model.code.trim(),
    },
    model,
  };
}
