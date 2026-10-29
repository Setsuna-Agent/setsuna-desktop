import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { CollaborationRuntimeHost } from '@setsuna-desktop/feature-collaboration/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { resolveRuntimeTurnModel } from './runtime-thread-model.js';

export function collaborationModelServices(configStore: ConfigStore | undefined, tasks: Pick<RuntimeTurnTaskRegistry, 'registeredForThread'>): Pick<CollaborationRuntimeHost, 'listModels' | 'resolveAgentConfiguration'> {
  return {
    async listModels() {
      const config = await configStore?.getConfig();
      return config?.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => ({
        providerId: provider.id, providerName: provider.name || provider.id,
        modelId: model.id, modelName: model.name || model.code, modelCode: model.code,
        reasoningEfforts: model.thinkingEnabled ? model.thinkingEfforts : [],
      }))) ?? [];
    },
    async resolveAgentConfiguration(parent: RuntimeThread, input) {
      const config = await configStore?.getConfig();
      const parentModel = resolveRuntimeTurnModel(config, parent);
      const resolved = input.model ? resolveRuntimeTurnModel(config, parent, input.model) : parentModel;
      const inherited = tasks.registeredForThread(parent.id)?.thinkingOptions;
      const requested = input.reasoningEffort;
      if (requested && requested !== 'none' && (!resolved?.model.thinkingEnabled || !resolved.model.thinkingEfforts.includes(requested))) {
        throw new Error(`Selected agent model does not support reasoning effort: ${requested}`);
      }
      // Different model families need different effort vocabularies; don't forward an unsupported inherited value.
      const inheritedEffort = inherited?.reasoningEffort ?? parentModel?.model.defaultThinkingEffort;
      const thinking = (requested ? requested !== 'none' : inherited?.thinking === true) && resolved?.model.thinkingEnabled !== false;
      const effort = requested ?? (resolved?.model.thinkingEfforts.includes(inheritedEffort ?? '') ? inheritedEffort : resolved?.model.defaultThinkingEffort);
      return { role: input.role, instructions: input.instructions,
        ...(resolved ? { modelBinding: resolved.binding } : parent.modelBinding ? { modelBinding: parent.modelBinding } : {}),
        thinking,
        ...(thinking && effort && effort !== 'none' ? { reasoningEffort: effort } : {}),
      };
    },
  };
}
