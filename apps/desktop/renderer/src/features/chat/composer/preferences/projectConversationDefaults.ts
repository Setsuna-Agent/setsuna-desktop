import type { RuntimeConfigState, RuntimeConfiguredModelReference, WorkspaceConversationDefaults } from '@setsuna-desktop/contracts';

/** Missing models and disabled providers fall back without mutating the project. */
export function availableProjectDefaultModel(config: RuntimeConfigState | null, defaults?: WorkspaceConversationDefaults): RuntimeConfiguredModelReference | undefined {
  const reference = defaults?.model;
  const provider = config?.providers?.find((provider) => provider.id === reference?.providerId && provider.enabled);
  // model.enabled is the provider's global selection, not model availability.
  return provider?.models.some((model) => model.id === reference?.modelId) ? reference : undefined;
}
