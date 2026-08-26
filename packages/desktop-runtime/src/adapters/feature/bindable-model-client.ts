import type { ModelProviderSamplingService } from '@setsuna-desktop/feature-model-provider/contracts';
import type { ModelRequest } from '@setsuna-desktop/contracts';
import type { ModelClient, ModelCompactionRequest } from '../../ports/model-client.js';

/**
 * Runtime Core is assembled before required Features activate. This stable port keeps Core free of
 * concrete Feature imports while making an unbound sampler a startup error rather than a fallback.
 */
export class BindableModelClient implements ModelClient {
  private delegate: ModelProviderSamplingService | null = null;

  bind(delegate: ModelProviderSamplingService): () => void {
    if (this.delegate) throw new Error('Model provider sampling is already bound.');
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = null;
    };
  }

  stream(request: ModelRequest) {
    return this.requireDelegate().stream(request);
  }

  compactConversation(request: ModelCompactionRequest) {
    const compact = this.requireDelegate().compactConversation;
    if (!compact) throw new Error('The active model provider does not support native compaction.');
    return compact.call(this.delegate, request);
  }

  private requireDelegate(): ModelProviderSamplingService {
    if (!this.delegate) throw new Error('Required model-provider Feature is not active.');
    return this.delegate;
  }
}
