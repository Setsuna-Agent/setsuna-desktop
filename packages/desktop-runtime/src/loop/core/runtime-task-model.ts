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
  fallbackRequest?: RuntimeTaskModelRequest,
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
    return fallbackRequest ?? { model: fallbackModel };
  }

  return fallbackRequest ?? { model: fallbackModel };
}
