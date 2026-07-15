import type {
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeTaskKind,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ThreadStore } from '../ports/thread-store.js';
import type { UsageStore } from '../ports/usage-store.js';
import type { ExplicitMemoryInput, RuntimeMemoryCoordinator } from './runtime-memory-coordinator.js';
import type { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import type { RuntimeThreadTitleCoordinator, RuntimeThreadTitleGeneration } from './runtime-thread-title-coordinator.js';

export type RuntimeAssistantTurnFinalization = {
  content?: string;
  explicitMemory?: ExplicitMemoryInput;
  memoryCitation?: RuntimeMemoryCitation;
  planMode?: RuntimeMessage['planMode'];
  review?: string;
  taskKind?: RuntimeTaskKind;
  threadTitle?: RuntimeThreadTitleGeneration | null;
};

type RuntimeTurnFinalizerOptions = {
  clock: Clock;
  ids: IdGenerator;
  memory: Pick<RuntimeMemoryCoordinator, 'schedulePassiveMemoriesForTurn' | 'rememberExplicitUserMemory'>;
  streamEvents: Pick<RuntimeModelStreamEventPublisher, 'completeMessage' | 'publishMessage'>;
  threadTitles: Pick<RuntimeThreadTitleCoordinator, 'commit'>;
  usageStore?: UsageStore;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** Applies the fixed, ordered side effects that close a successful assistant turn. */
export class RuntimeTurnFinalizer {
  constructor(private readonly options: RuntimeTurnFinalizerOptions) {}

  async finish({
    finalization,
    messageId,
    messageUsage,
    threadId,
    turnId,
    usage,
  }: {
    finalization: RuntimeAssistantTurnFinalization;
    messageId: string;
    messageUsage?: RuntimeUsage;
    threadId: string;
    turnId: string;
    usage?: RuntimeUsage;
  }): Promise<void> {
    if (usage) {
      await this.options.usageStore?.recordUsage({
        threadId,
        turnId,
        createdAt: this.options.clock.now().toISOString(),
        ...usage,
      });
    }
    await this.options.streamEvents.completeMessage(threadId, turnId, messageId, {
      content: finalization.content,
      usage: messageUsage,
      memoryCitation: finalization.memoryCitation,
      planMode: finalization.planMode,
    });
    await this.options.threadTitles.commit(threadId, turnId, finalization.threadTitle);
    if (finalization.review !== undefined) {
      await this.publishReviewModeMessage(threadId, turnId, 'exited', finalization.review.trim() || 'Review completed.');
    }
    await this.options.memory.rememberExplicitUserMemory(threadId, turnId, finalization.explicitMemory);
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.completed',
      createdAt: this.options.clock.now().toISOString(),
      payload: { usage, taskKind: finalization.taskKind },
    });
    // Passive memory is auxiliary: enqueue it only after the turn is durably complete.
    this.options.memory.schedulePassiveMemoriesForTurn(threadId, turnId);
  }

  async publishReviewModeMessage(
    threadId: string,
    turnId: string,
    kind: NonNullable<RuntimeMessage['reviewMode']>['kind'],
    review: string,
  ): Promise<void> {
    await this.options.streamEvents.publishMessage(threadId, turnId, {
      id: this.options.ids.id('msg'),
      turnId,
      role: 'system',
      content: '',
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'transcript',
      reviewMode: { kind, review },
    });
  }
}
