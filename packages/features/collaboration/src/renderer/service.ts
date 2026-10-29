import type { RendererFeatureEventFeed } from '@setsuna-desktop/feature-core/renderer';
import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type { CollaborationRendererStateService } from '../contracts/index.js';
import type { CollaborationUserAction } from '../contracts/index.js';
import type { CollaborationClient } from './client.js';
import { CollaborationRendererController } from './controller.js';

export class RendererCollaborationStateService implements CollaborationRendererStateService {
  readonly available = true;
  private readonly controllers = new Map<string, CollaborationRendererController>();

  constructor(private readonly options: Readonly<{
    client: CollaborationClient;
    feed: RendererFeatureEventFeed;
    scope: FeatureScope;
  }>) {
    options.scope.add(() => this.dispose());
  }

  controller(threadId: string): CollaborationRendererController {
    const existing = this.controllers.get(threadId);
    if (existing) return existing;
    const controller = new CollaborationRendererController({ ...this.options, threadId });
    this.controllers.set(threadId, controller);
    return controller;
  }

  async act(input: CollaborationUserAction) {
    const result = await this.options.client.act(input);
    this.controllers.get(input.threadId)?.retry();
    return result;
  }

  private dispose(): void {
    for (const controller of this.controllers.values()) controller.dispose();
    this.controllers.clear();
  }
}
