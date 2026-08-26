import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  RuntimeUsageQuery,
  UsageRendererStateService,
  UsageSnapshot,
} from '../contracts/index.js';
import type { UsageClient } from './client.js';
import { UsageRendererController } from './controller.js';

export class RendererUsageStateService implements UsageRendererStateService {
  readonly available = true;
  private readonly activeControllers = new Set<UsageRendererController>();
  private readonly invalidationListeners = new Set<(threadId: string) => void>();
  private disposed = false;

  constructor(private readonly options: Readonly<{
    client: UsageClient;
    scope: FeatureScope;
  }>) {
    options.scope.add(() => this.dispose());
  }

  controller(threadId: string): UsageRendererController {
    return new UsageRendererController({
      query: (options) => this.query({ threadId }, options),
      onStop: (controller) => this.activeControllers.delete(controller),
      onStart: (controller) => this.activeControllers.add(controller),
      subscribeInvalidation: (listener) => this.subscribeInvalidation((changedThreadId) => {
        if (changedThreadId === threadId) listener();
      }),
    });
  }

  invalidate(threadId: string): void {
    if (this.disposed) return;
    for (const listener of [...this.invalidationListeners]) listener(threadId);
  }

  query(
    input?: RuntimeUsageQuery,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<UsageSnapshot> {
    return this.options.scope.runOperation(
      (signal) => this.options.client.query(input, { signal }),
      options,
    );
  }

  subscribeInvalidation(listener: (threadId: string) => void): () => void {
    if (this.disposed) return () => undefined;
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of [...this.activeControllers]) controller.dispose();
    this.activeControllers.clear();
    this.invalidationListeners.clear();
  }
}
