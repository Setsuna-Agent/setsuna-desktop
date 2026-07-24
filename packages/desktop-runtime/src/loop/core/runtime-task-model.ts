import type {
  ModelRequest,
  RuntimeConfigState,
  RuntimeTaskModelId,
} from '@setsuna-desktop/contracts';

export type RuntimeTaskModelRequest = Pick<ModelRequest, 'model' | 'providerId'>;

export function runtimeTaskModelRequest(
  config: RuntimeConfigState | null | undefined,
  taskId: RuntimeTaskModelId,
  fallbackModel: string,
): RuntimeTaskModelRequest {
  const reference = config?.taskModels?.[taskId];
  if (reference) {
    const provider = config?.providers.find((item) => (
      item.enabled && item.id === reference.providerId
    ));
    const model = provider?.models.find((item) => (
      item.id === reference.modelId && Boolean(item.code.trim())
    ));
    if (provider && model) {
      return {
        model: model.code.trim(),
        providerId: provider.id,
      };
    }
    return { model: fallbackModel };
  }

  const legacyModel = legacyTaskModel(config, taskId);
  return { model: legacyModel || fallbackModel };
}

function legacyTaskModel(
  config: RuntimeConfigState | null | undefined,
  taskId: RuntimeTaskModelId,
): string | undefined {
  if (taskId === 'memoryExtraction') return config?.memory.extractModel?.trim() || undefined;
  if (taskId === 'memoryConsolidation') return config?.memory.consolidationModel?.trim() || undefined;
  return undefined;
}
