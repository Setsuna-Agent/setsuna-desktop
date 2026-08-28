import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  RuntimeActivityRendererService,
  RuntimeActivityServiceListTarget,
  RuntimeActivityServiceTarget,
  RuntimeActivityTaskTarget,
} from '../contracts/index.js';
import type { RuntimeActivityClient } from './client.js';

export class RendererRuntimeActivityService implements RuntimeActivityRendererService {
  constructor(private readonly options: Readonly<{
    client: RuntimeActivityClient;
    scope: FeatureScope;
  }>) {}

  list(options?: Readonly<{ signal?: AbortSignal }>) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.list({ signal }),
      options,
    );
  }

  listServices(
    input: RuntimeActivityServiceListTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.listServices(input, { signal }),
      options,
    );
  }

  stopService(
    input: RuntimeActivityServiceTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.stopService(input, { signal }),
      options,
    );
  }

  stopTask(
    input: RuntimeActivityTaskTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ) {
    return this.options.scope.runOperation(
      (signal) => this.options.client.stopTask(input, { signal }),
      options,
    );
  }
}
