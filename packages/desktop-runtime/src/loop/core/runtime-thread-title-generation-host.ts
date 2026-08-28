import type {
  ThreadTitleGenerationResolvedModel,
  ThreadTitleGenerationRuntimeHost,
} from '@setsuna-desktop/feature-thread-title-generation/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageRecorder } from '../../ports/usage-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';

const BUILTIN_SMOKE_MODEL = 'local-runtime-smoke';

type RuntimeThreadTitleGenerationHostDependencies = Readonly<{
  appendEvent(
    threadId: string,
    event: Parameters<ThreadStore['appendEvent']>[1],
  ): Promise<void>;
  clock: Clock;
  configStore?: ConfigStore;
  eventWriter: Pick<RuntimeEventWriter, 'flushThread'>;
  ids: IdGenerator;
  modelClient: Pick<ModelClient, 'stream'>;
  threadStore: Pick<ThreadStore, 'getThread' | 'listEvents'>;
  usageStore?: UsageRecorder;
}>;

/** Adapts Core model and event services without leaking runtime ports into the Feature. */
export function createRuntimeThreadTitleGenerationHost(
  dependencies: RuntimeThreadTitleGenerationHostDependencies,
): ThreadTitleGenerationRuntimeHost {
  const host: ThreadTitleGenerationRuntimeHost = {
    now: () => dependencies.clock.now(),
    resolveModel: (input) => resolveTitleModel(dependencies.configStore, input.selection, input.fallback),
    listModelOptions: async () => {
      const config = await dependencies.configStore?.getConfig().catch(() => null);
      if (!config) return [];
      return config.providers.flatMap((provider) => (
        provider.enabled
          ? provider.models.flatMap((model) => {
              const modelCode = model.code.trim();
              const modelId = model.id.trim();
              if (!isUsableTitleModelCode(modelCode) || !modelId) return [];
              return [Object.freeze({
                providerId: provider.id,
                providerName: provider.name.trim() || provider.id,
                modelId,
                modelName: model.name,
                modelCode,
              })];
            })
          : []
      ));
    },
    generateText: async (request) => {
      const output = createModelStreamTextCollector();
      let finishReason: string | undefined;
      let usage: Awaited<ReturnType<ThreadTitleGenerationRuntimeHost['generateText']>>['usage'];
      let protocolUsage: typeof usage;
      for await (const event of dependencies.modelClient.stream(request)) {
        output.consume(event);
        if (event.type === 'done') finishReason = event.finishReason;
        if (event.type === 'usage') usage = event.usage;
        if (event.type === 'token_count') protocolUsage = event.usage;
      }
      const reportedUsage = usage ?? protocolUsage;
      return Object.freeze({
        content: output.text(),
        ...(finishReason ? { finishReason } : {}),
        ...(reportedUsage ? { usage: reportedUsage } : {}),
      });
    },
    recordUsage: async (threadId, turnId, usage) => {
      await dependencies.usageStore?.recordUsage({
        threadId,
        turnId,
        createdAt: dependencies.clock.now().toISOString(),
        ...usage,
      });
    },
    flushThread: (threadId) => dependencies.eventWriter.flushThread(threadId),
    listEvents: (threadId, afterSeq) => dependencies.threadStore.listEvents(threadId, afterSeq),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    appendTitleUpdate: (threadId, turnId, title) => dependencies.appendEvent(threadId, {
      id: dependencies.ids.id('event'),
      threadId,
      turnId,
      type: 'thread.updated',
      createdAt: dependencies.clock.now().toISOString(),
      payload: { title },
    }),
  };
  return Object.freeze(host);
}

async function resolveTitleModel(
  configStore: ConfigStore | undefined,
  selection: Readonly<{ providerId: string; modelId: string }> | null,
  fallback: ThreadTitleGenerationResolvedModel | undefined,
): Promise<ThreadTitleGenerationResolvedModel | null> {
  const [config, activeProvider] = await Promise.all([
    configStore?.getConfig().catch(() => null) ?? Promise.resolve(null),
    configStore?.getActiveProviderConfig().catch(() => null) ?? Promise.resolve(null),
  ]);
  if (selection) {
    const provider = config?.providers.find((item) => item.enabled && item.id === selection.providerId);
    const model = provider?.models.find((item) => (
      item.id === selection.modelId && isUsableTitleModelCode(item.code)
    ));
    if (provider && model) {
      return Object.freeze({ providerId: provider.id, model: model.code.trim() });
    }
  }
  if (fallback && isUsableTitleModelCode(fallback.model)) {
    return Object.freeze({
      model: fallback.model.trim(),
      ...(fallback.providerId ? { providerId: fallback.providerId } : {}),
    });
  }
  const activeModel = activeProvider?.enabled ? activeProvider.activeModel : undefined;
  if (!activeProvider?.enabled || !activeModel || !isUsableTitleModelCode(activeModel.code)) return null;
  return Object.freeze({
    model: activeModel.code.trim(),
    providerId: activeProvider.id,
  });
}

function isUsableTitleModelCode(value: string): boolean {
  const model = value.trim();
  return Boolean(model) && model !== BUILTIN_SMOKE_MODEL;
}
