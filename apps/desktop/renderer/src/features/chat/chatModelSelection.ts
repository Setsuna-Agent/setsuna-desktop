import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeThread,
} from '@setsuna-desktop/contracts';

export type ChatThreadModelSelection = {
  fallbackModelCode?: string;
  model: ProviderModelConfig | null;
  provider: ProviderConfigState | null;
  reference: RuntimeConfiguredModelReference | null;
};

export type ChatModelSelectionHandler = (
  providerId: string,
  modelId: string,
  threadId?: string,
) => void | Promise<void>;

export type ChatDefaultModelSelection = Pick<
  ChatThreadModelSelection,
  'model' | 'provider' | 'reference'
>;

/** Resolves the global model choice that will bind the next new conversation. */
export function chatDefaultModelSelection(
  config: RuntimeConfigState | null,
): ChatDefaultModelSelection {
  const provider = config?.providers?.find((item) => item.id === config.activeProviderId && item.enabled)
    ?? config?.providers?.find((item) => item.enabled)
    ?? null;
  const model = provider?.models.find((item) => item.enabled) ?? provider?.models[0] ?? null;
  return {
    model,
    provider,
    reference: provider && model ? { providerId: provider.id, modelId: model.id } : null,
  };
}

/** Resolves the model selected for this thread, including an in-flight optimistic change. */
export function chatThreadModelSelection(
  config: RuntimeConfigState | null,
  thread: RuntimeThread | null,
  requested?: RuntimeConfiguredModelReference,
): ChatThreadModelSelection {
  if (requested) {
    const provider = config?.providers?.find((item) => item.id === requested.providerId) ?? null;
    const model = provider?.models.find((item) => item.id === requested.modelId) ?? null;
    return {
      fallbackModelCode: model?.code,
      model,
      provider,
      reference: { ...requested },
    };
  }

  const bound = thread?.modelBinding;
  if (bound) {
    const provider = config?.providers?.find((item) => item.id === bound.providerId) ?? null;
    const model = provider?.models.find((item) => (
      item.id === bound.modelId && item.code.trim() === bound.modelCode
    )) ?? null;
    return {
      fallbackModelCode: bound.modelCode,
      model,
      provider,
      reference: { providerId: bound.providerId, modelId: bound.modelId },
    };
  }

  const selection = chatDefaultModelSelection(config);
  return {
    // Histories that predate model metadata cannot be safely guessed. They stay selectable
    // until the next turn persists an explicit binding.
    ...selection,
  };
}
