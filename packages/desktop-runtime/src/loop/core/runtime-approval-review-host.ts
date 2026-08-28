import type {
  ApprovalReviewRuntimeHost,
} from '@setsuna-desktop/feature-approval-review/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageRecorder } from '../../ports/usage-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';
import { resolveRuntimeTurnModel } from './runtime-thread-model.js';

const BUILTIN_SMOKE_MODEL = 'local-runtime-smoke';

type RuntimeApprovalReviewHostDependencies = Readonly<{
  clock: Clock;
  configStore?: ConfigStore;
  modelClient: Pick<ModelClient, 'stream'>;
  threadStore: Pick<ThreadStore, 'getThread'>;
  usageStore?: UsageRecorder;
}>;

/** Adapts Core model, thread, and usage services without leaking runtime ports into the Feature. */
export function createRuntimeApprovalReviewHost(
  dependencies: RuntimeApprovalReviewHostDependencies,
): ApprovalReviewRuntimeHost {
  return Object.freeze({
    now: () => dependencies.clock.now(),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    resolveModel: async ({ selection, thread }) => {
      const config = await dependencies.configStore?.getConfig().catch(() => null) ?? null;
      if (!config) throw new Error('Approval review model configuration is unavailable.');
      if (selection) {
        const provider = config?.providers.find((item) => item.enabled && item.id === selection.providerId);
        const model = provider?.models.find((item) => (
          item.id === selection.modelId && isUsableApprovalReviewModelCode(item.code)
        ));
        if (provider && model) {
          return Object.freeze({ providerId: provider.id, model: model.code.trim() });
        }
      }
      const turnModel = resolveRuntimeTurnModel(config, thread);
      if (turnModel) {
        return Object.freeze({
          providerId: turnModel.binding.providerId,
          model: turnModel.binding.modelCode,
        });
      }
      return Object.freeze({ model: BUILTIN_SMOKE_MODEL });
    },
    listModelOptions: async () => {
      const config = await dependencies.configStore?.getConfig().catch(() => null);
      if (!config) return [];
      return config.providers.flatMap((provider) => (
        provider.enabled
          ? provider.models.flatMap((model) => {
              const modelCode = model.code.trim();
              const modelId = model.id.trim();
              if (!isUsableApprovalReviewModelCode(modelCode) || !modelId) return [];
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
      let usage: Awaited<ReturnType<ApprovalReviewRuntimeHost['generateText']>>['usage'];
      let protocolUsage: typeof usage;
      for await (const event of dependencies.modelClient.stream(request)) {
        output.consume(event);
        if (event.type === 'usage') usage = event.usage;
        if (event.type === 'token_count') protocolUsage = event.usage;
      }
      const reportedUsage = usage ?? protocolUsage;
      return Object.freeze({
        content: output.text(),
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
  } satisfies ApprovalReviewRuntimeHost);
}

function isUsableApprovalReviewModelCode(value: string): boolean {
  const model = value.trim();
  return Boolean(model) && model !== BUILTIN_SMOKE_MODEL;
}
