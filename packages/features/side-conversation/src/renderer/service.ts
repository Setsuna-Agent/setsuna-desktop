import type { FeatureScope } from '@setsuna-desktop/feature-core/scope';
import type {
  SideConversationRendererHost,
  SideConversationRendererService,
} from '../contracts/index.js';
import type { SideConversationClient } from './client.js';

export class RendererSideConversationService implements SideConversationRendererService {
  readonly available = true;

  constructor(private readonly options: Readonly<{
    client: SideConversationClient;
    host: SideConversationRendererHost;
    scope: FeatureScope;
  }>) {}

  create(
    parentThreadId: string,
    isCurrentOwner: () => boolean = () => true,
  ) {
    return this.options.scope.runOperation(async (signal) => {
      const created = await this.options.client.create(parentThreadId, { signal });
      let accepted = false;
      try {
        if (!isCurrentOwner()) throw ownerChangedError();
        const thread = await this.options.host.getThread(created.threadId);
        if (!isCurrentOwner()) throw ownerChangedError();
        accepted = true;
        return thread;
      } finally {
        if (!accepted) {
          await this.options.host.deleteThread(created.threadId).catch(() => undefined);
        }
      }
    });
  }

  discard(threadId: string): Promise<void> {
    return this.options.host.deleteThread(threadId);
  }
}

function ownerChangedError(): Error {
  return new Error('Side conversation owner changed before creation completed.');
}
