import type {
  ReviewModelSelection,
  ReviewRuntimeHost,
  ReviewTextGenerationRequest,
  ReviewTurnRequest,
  StartReviewResult,
} from '@setsuna-desktop/feature-review/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';

type HostDependencies = Readonly<{
  config: Pick<ConfigStore, 'getActiveProviderConfig' | 'getConfig'>;
  models: Pick<ModelClient, 'stream'>;
  startTurn(threadId: string, request: ReviewTurnRequest): Promise<StartReviewResult>;
  threads: Pick<ThreadStore, 'getThread'>;
}>;

/** Adapts the configured default model without exposing Core model clients to Review. */
export class DesktopReviewRuntimeHost implements ReviewRuntimeHost {
  constructor(private readonly dependencies: HostDependencies) {}

  async isDefaultModelConfigured(): Promise<boolean> {
    const provider = await this.dependencies.config.getActiveProviderConfig();
    return Boolean(
      provider?.enabled
      && provider.activeModel?.code
      && (provider.apiKey || provider.activeModel.code !== 'local-runtime-smoke'),
    );
  }

  async generateText(input: ReviewTextGenerationRequest): Promise<string> {
    const collector = createModelStreamTextCollector();
    for await (const event of this.dependencies.models.stream({
      ...input,
      // The model-provider Feature interprets this sentinel as "use the active model".
      model: 'local-runtime-smoke',
    })) {
      collector.consume(event);
    }
    return collector.text();
  }

  async hasThread(threadId: string): Promise<boolean> {
    return Boolean(await this.dependencies.threads.getThread(threadId));
  }

  async listModelOptions() {
    const config = await this.dependencies.config.getConfig().catch(() => null);
    if (!config) return [];
    return config.providers.flatMap((provider) => (
      provider.enabled
        ? provider.models.flatMap((model) => {
            const modelCode = model.code.trim();
            const modelId = model.id.trim();
            if (!modelCode || !modelId) return [];
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
  }

  async resolveModelSelection(input: Readonly<{
    fallback?: NonNullable<ReviewTurnRequest['modelSelection']>;
    selection: ReviewModelSelection;
  }>) {
    const config = await this.dependencies.config.getConfig().catch(() => null);
    if (input.selection && config) {
      const provider = config.providers.find((item) => (
        item.enabled && item.id === input.selection?.providerId
      ));
      const model = provider?.models.find((item) => (
        item.id === input.selection?.modelId && Boolean(item.code.trim())
      ));
      if (provider && model) {
        return Object.freeze({
          providerId: provider.id,
          modelId: model.id,
        });
      }
    }
    return input.fallback
      ? Object.freeze({ ...input.fallback })
      : undefined;
  }

  startTurn(threadId: string, request: ReviewTurnRequest): Promise<StartReviewResult> {
    return this.dependencies.startTurn(threadId, request);
  }
}
