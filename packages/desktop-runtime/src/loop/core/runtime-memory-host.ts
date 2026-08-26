import type {
  MemoryRuntimeHost,
  MemoryStore,
} from '@setsuna-desktop/feature-memory/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageRecorder } from '../../ports/usage-store.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import { resolveRuntimeTurnModel } from './runtime-thread-model.js';

type RuntimeMemoryHostDependencies = Readonly<{
  clock: Clock;
  configStore?: ConfigStore;
  eventWriter: RuntimeEventWriter;
  ids: IdGenerator;
  modelClient: ModelClient;
  store: MemoryStore;
  threadStore: ThreadStore;
  usageStore?: UsageRecorder;
}>;

/** Adapts Core persistence/model services to Memory without exposing runtime internals. */
export function createRuntimeMemoryHost(
  dependencies: RuntimeMemoryHostDependencies,
): MemoryRuntimeHost {
  const host: MemoryRuntimeHost = {
    store: dependencies.store,
    now: () => dependencies.clock.now(),
    id: (prefix) => dependencies.ids.id(prefix),
    listThreads: (query) => dependencies.threadStore.listThreads(query),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    updateThreadMode: (threadId, mode, reason) => (
      dependencies.threadStore.updateThreadMemoryMode(threadId, mode, reason)
    ),
    appendEvent: async (threadId, event) => {
      await dependencies.eventWriter.append(threadId, event);
    },
    streamModel: (request) => dependencies.modelClient.stream(request),
    recordUsage: async (input) => {
      await dependencies.usageStore?.recordUsage(input);
    },
    resolveModel: async ({
      selection,
      legacyModelCode,
      fallbackModel,
      thread,
      preferThreadModel,
    }) => {
      const config = await dependencies.configStore?.getConfig().catch(() => null) ?? null;
      if (selection) {
        const provider = config?.providers.find((item) => item.enabled && item.id === selection.providerId);
        const model = provider?.models.find((item) => item.id === selection.modelId && Boolean(item.code.trim()));
        if (provider && model) return { providerId: provider.id, model: model.code.trim() };
      }
      if (legacyModelCode?.trim()) return { model: legacyModelCode.trim() };
      if (preferThreadModel && thread) {
        const resolved = resolveRuntimeTurnModel(config, thread);
        if (resolved) {
          return {
            providerId: resolved.binding.providerId,
            model: resolved.binding.modelCode,
          };
        }
      }
      return { model: fallbackModel };
    },
    hasActiveModel: async () => Boolean(
      (await dependencies.configStore?.getActiveProviderConfig().catch(() => null))?.activeModel,
    ),
    listModelOptions: async () => {
      const config = await dependencies.configStore?.getConfig().catch(() => null);
      if (!config) return [];
      return config.providers.flatMap((provider) => (
        provider.enabled
          ? provider.models
            .filter((model) => Boolean(model.code.trim()))
            .map((model) => Object.freeze({
              providerId: provider.id,
              providerName: provider.name.trim() || provider.id,
              modelId: model.id,
              modelName: model.name,
              modelCode: model.code.trim(),
            }))
          : []
      ));
    },
    sharedMemoryFilesEnabled: async () => {
      const config = await dependencies.configStore?.getConfig().catch(() => null);
      return config?.features?.memory_unscoped_files === true;
    },
  };
  return Object.freeze(host);
}
