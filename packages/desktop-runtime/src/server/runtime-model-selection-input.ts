import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import {
  resolveRuntimeModelReference,
  type RuntimeResolvedTurnModel,
} from '../loop/core/runtime-thread-model.js';
import type { ConfigStore } from '../ports/config-store.js';
import { stringInput } from './app-server/input.js';
import { RuntimeHttpError } from './http-error.js';

export type ResolvedRuntimeModelSelectionInput = RuntimeResolvedTurnModel & {
  reference: RuntimeConfiguredModelReference;
};

/** Validates the configured-model reference shared by turn-like REST inputs. */
export function runtimeModelSelection(value: unknown): RuntimeConfiguredModelReference | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeHttpError(400, 'modelSelection must be an object.', 'invalid_model_selection');
  }
  const input = value as Record<string, unknown>;
  const providerId = stringInput(input.providerId ?? input.provider_id);
  const modelId = stringInput(input.modelId ?? input.model_id);
  if (!providerId || !modelId) {
    throw new RuntimeHttpError(400, 'modelSelection requires providerId and modelId.', 'invalid_model_selection');
  }
  return { providerId, modelId };
}

/** Resolves shape and configured availability before a REST mutation can be accepted. */
export async function resolveRuntimeModelSelectionInput(
  configStore: Pick<ConfigStore, 'getConfig'>,
  value: unknown,
): Promise<ResolvedRuntimeModelSelectionInput | undefined> {
  const reference = runtimeModelSelection(value);
  if (!reference) return undefined;

  const config = await configStore.getConfig();
  try {
    return {
      reference,
      ...resolveRuntimeModelReference(config, reference),
    };
  } catch (error) {
    throw new RuntimeHttpError(
      400,
      error instanceof Error ? error.message : 'The selected model is unavailable.',
      'invalid_model_selection',
    );
  }
}
