import type { RuntimeThread } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { isAbortError } from '../core/runtime-turn-errors.js';
import type { RuntimeHookCoordinator } from '../lifecycle/runtime-hook-coordinator.js';
import type { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { createRuntimeContextCompactionCandidate, materializeRuntimeContextCompaction } from './context-compaction.js';
import { compactHookTrigger, type RuntimeContextCompactor } from './runtime-context-compactor.js';

type RuntimeCompactionTurnCoordinatorOptions = {
  clock: Clock;
  configStore?: ConfigStore;
  contextCompactor: Pick<
    RuntimeContextCompactor,
    | 'generateContextCompactionSummary'
    | 'publishContextCompacting'
    | 'publishContextCompactionUsages'
    | 'publishProviderMetadataWarning'
  >;
  hooks: Pick<RuntimeHookCoordinator, 'queueSessionStartSource' | 'runCompactHooks'>;
  ids: IdGenerator;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
  turnTermination: Pick<RuntimeTurnTerminationCoordinator, 'publishCancelledOnce'>;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** 在主代理循环外编排手动及显式压缩轮次。 */
export class RuntimeCompactionTurnCoordinator {
  constructor(private readonly options: RuntimeCompactionTurnCoordinatorOptions) {}

  compact(threadId: string, force = true): Promise<RuntimeThread> {
    const compacting = this.create(threadId, force);
    // 将提前取消标记为已观察，同时为调用方保留拒绝结果。
    void compacting.catch(() => undefined);
    return compacting;
  }

  private async create(threadId: string, force: boolean): Promise<RuntimeThread> {
    await this.options.turnTasks.waitForFinalizingRegularTurn(threadId);
    const thread = await this.options.threadStore.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const candidate = createRuntimeContextCompactionCandidate({ force, messages: thread.messages });
    if (!candidate) return thread;
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run<RuntimeThread>({
      acceptingSteers: false,
      taskKind: 'compact',
      threadId,
      turnId,
    }, (task) => this.run({ candidate, force, signal: task.controller.signal, thread, threadId, turnId }));
    return run.done;
  }

  private async run({
    candidate,
    force,
    signal,
    thread,
    threadId,
    turnId,
  }: {
    candidate: NonNullable<ReturnType<typeof createRuntimeContextCompactionCandidate>>;
    force: boolean;
    signal: AbortSignal;
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeThread> {
    const runtimeConfig = await this.options.configStore?.getConfig().catch(() => null);
    const trigger = compactHookTrigger(force);
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: { input: force ? '/compact' : '/compact auto', taskKind: 'compact' },
    });
    const preCompact = await this.options.hooks.runCompactHooks({
      eventName: 'PreCompact',
      runtimeConfig,
      signal,
      thread,
      trigger,
      turnId,
    });
    if (preCompact.shouldStop) {
      await this.publishCompleted(threadId, turnId);
      return (await this.options.threadStore.getThread(threadId)) ?? thread;
    }

    await this.options.contextCompactor.publishContextCompacting(threadId, turnId, force, thread.messages);
    try {
      const summary = await this.options.contextCompactor.generateContextCompactionSummary(
        candidate,
        signal,
        undefined,
        runtimeConfig,
      );
      const result = materializeRuntimeContextCompaction({
        candidate,
        createdAt: this.options.clock.now().toISOString(),
        id: this.options.ids.id('msg'),
        providerMetadata: summary.providerMetadata,
        source: summary.source,
        summary: summary.text,
        turnId,
      });
      await this.options.contextCompactor.publishProviderMetadataWarning(
        threadId,
        turnId,
        summary.omittedProviderMetadata,
      );
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'thread.context_compacted',
        createdAt: this.options.clock.now().toISOString(),
        payload: result,
      });
      await this.options.contextCompactor.publishContextCompactionUsages(
        threadId,
        turnId,
        summary.usages,
      );
      this.options.hooks.queueSessionStartSource(threadId, 'compact');
      await this.options.hooks.runCompactHooks({
        eventName: 'PostCompact',
        runtimeConfig,
        signal,
        thread,
        trigger,
        turnId,
      });
      await this.publishCompleted(threadId, turnId);
      return (await this.options.threadStore.getThread(threadId)) ?? thread;
    } catch (error) {
      if (isAbortError(error)) {
        await this.options.turnTermination.publishCancelledOnce(
          threadId,
          turnId,
          'compact',
          error instanceof Error ? error.message : 'Turn cancelled.',
          { marker: true },
        );
        throw error;
      }
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'runtime.error',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          code: 'context_compaction_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async publishCompleted(threadId: string, turnId: string): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.completed',
      createdAt: this.options.clock.now().toISOString(),
      payload: { taskKind: 'compact' },
    });
  }
}
