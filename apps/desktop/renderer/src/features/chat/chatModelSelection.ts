import type {
  ProviderConfigState,
  ProviderModelConfig,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimeThread,
  RuntimeThreadModelBinding,
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
  config: Pick<RuntimeConfigState, 'providers' | 'activeProviderId'> | null,
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
    return boundModelSelection(config, bound);
  }

  const selection = chatDefaultModelSelection(config);
  return {
    // Histories that predate model metadata cannot be safely guessed. They stay selectable
    // until the next turn persists an explicit binding.
    ...selection,
  };
}

/** Execution details use the recorded turn, never the current global or next-turn choice. */
export function chatExecutionModelSelection(
  config: RuntimeConfigState | null,
  thread: RuntimeThread | null,
  activeTurnId: string | null,
  dispatchedModel?: RuntimeThreadModelBinding,
): ChatThreadModelSelection | null {
  const turn = activeTurnId
    ? thread?.turns?.find((turn) => turn.id === activeTurnId)
    : thread?.turns?.at(-1);
  const bound = turn?.stepSnapshots?.at(-1)?.snapshot.modelBinding
    ?? turn?.modelBinding
    ?? dispatchedModel
    ?? (!turn ? thread?.modelBinding : undefined);
  return bound ? boundModelSelection(config, bound) : null;
}

function boundModelSelection(config: RuntimeConfigState | null, bound: RuntimeThreadModelBinding): ChatThreadModelSelection {
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
