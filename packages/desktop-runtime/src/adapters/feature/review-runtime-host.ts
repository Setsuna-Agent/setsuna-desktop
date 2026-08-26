import type {
  ReviewRuntimeHost,
  ReviewTextGenerationRequest,
} from '@setsuna-desktop/feature-review/contracts';
import type { ConfigStore } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import { createModelStreamTextCollector } from '../../utils/model-stream-text-collector.js';

type HostDependencies = Readonly<{
  config: Pick<ConfigStore, 'getActiveProviderConfig'>;
  models: Pick<ModelClient, 'stream'>;
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
      // ConfiguredModelClient interprets this sentinel as "use the active model".
      model: 'local-runtime-smoke',
    })) {
      collector.consume(event);
    }
    return collector.text();
  }
}
