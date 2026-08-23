import type {
  RuntimeMemoryCitation,
  RuntimeInterfaceLanguage,
  RuntimeMessage,
  RuntimeTaskKind,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import { parseRuntimeReviewResult } from '@setsuna-desktop/contracts';
import type { MemoryControl } from '@setsuna-desktop/feature-memory/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { UsageStore } from '../../ports/usage-store.js';
import type { RuntimeModelStreamEventPublisher } from '../core/runtime-model-stream-event-publisher.js';
import type {
  RuntimeThreadTitleCoordinator,
  RuntimeThreadTitleGeneration,
} from './runtime-thread-title-coordinator.js';

export type RuntimeAssistantTurnFinalization = {
  content?: string;
  explicitMemory?: NonNullable<Parameters<MemoryControl['rememberExplicitUserMemory']>[2]>;
  memoryCitation?: RuntimeMemoryCitation;
  providerMetadata?: RuntimeMessage['providerMetadata'];
  review?: {
    content: string;
    language: RuntimeInterfaceLanguage;
  };
  taskKind?: RuntimeTaskKind;
  threadTitle?: RuntimeThreadTitleGeneration | null;
};

type RuntimeTurnFinalizerOptions = {
  clock: Clock;
  ids: IdGenerator;
  memoryControl(): Pick<MemoryControl, 'schedulePassiveMemoriesForTurn' | 'rememberExplicitUserMemory'>;
  streamEvents: Pick<RuntimeModelStreamEventPublisher, 'completeMessage' | 'publishMessage'>;
  threadTitles: Pick<RuntimeThreadTitleCoordinator, 'commit'>;
  usageStore?: UsageStore;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** 按固定顺序应用结束成功助手轮次所需的副作用。 */
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
      phase: 'final_answer',
      usage: messageUsage,
      memoryCitation: finalization.memoryCitation,
      providerMetadata: finalization.providerMetadata,
    });
    await this.options.threadTitles.commit(threadId, turnId, finalization.threadTitle);
    if (finalization.review !== undefined) {
      const rawReview = finalization.review.content.trim();
      const parsedReview = parseRuntimeReviewResult(rawReview, { legacyThinkTags: false });
      const fallbackReview = (
        finalization.review.language === 'zh-CN'
          ? '审查已完成。'
          : 'Review completed.'
      );
      const hasVisibleReview = Boolean(parsedReview.summary || parsedReview.findings.length);
      const review = hasVisibleReview ? rawReview : fallbackReview;
      const result = hasVisibleReview
        ? parsedReview
        : parseRuntimeReviewResult(fallbackReview, { legacyThinkTags: false });
      await this.publishReviewModeMessage(threadId, turnId, 'exited', review, result);
    }
    await this.options.memoryControl().rememberExplicitUserMemory(
      threadId,
      turnId,
      finalization.explicitMemory,
    );
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.completed',
      createdAt: this.options.clock.now().toISOString(),
      payload: { usage, taskKind: finalization.taskKind },
    });
    // 被动记忆属于辅助工作，只能在轮次持久化完成后入队。
    this.options.memoryControl().schedulePassiveMemoriesForTurn(threadId, turnId);
  }

  async publishReviewModeMessage(
    threadId: string,
    turnId: string,
    kind: NonNullable<RuntimeMessage['reviewMode']>['kind'],
    review: string,
    result?: ReturnType<typeof parseRuntimeReviewResult>,
  ): Promise<void> {
    await this.options.streamEvents.publishMessage(threadId, turnId, {
      id: this.options.ids.id('msg'),
      turnId,
      role: 'system',
      content: '',
      createdAt: this.options.clock.now().toISOString(),
      status: 'complete',
      visibility: 'transcript',
      reviewMode: {
        kind,
        review,
        ...(kind === 'exited' ? { reasoningSeparated: true } : {}),
        ...(result?.findings.length ? { findings: result.findings } : {}),
        ...(result?.summary ? { summary: result.summary } : {}),
      },
    });
  }
}
