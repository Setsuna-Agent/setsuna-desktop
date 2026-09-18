import type { RuntimeConfigState, RuntimeThread } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { isAbortError } from '../core/runtime-turn-errors.js';
import { resolveRuntimeTurnModel, type RuntimeResolvedTurnModel } from '../core/runtime-thread-model.js';
import type { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { createRuntimeContextCompactionCandidate, reserveRuntimeContextCompactionBudget } from './context-compaction.js';
import { nativeCompactionMatchesModel, restoreNativeCompactionHistory } from './context-compaction-history.js';
import { contextCompactionBudgetForConfig, HookStoppedTurnError, reservedOutputTokensForConfig, type RuntimeContextCompactor } from './runtime-context-compactor.js';

type RuntimeCompactionTurnCoordinatorOptions = {
  clock: Clock;
  configStore?: ConfigStore;
  contextCompactor: Pick<RuntimeContextCompactor, 'compactMessagesBeforeModelRequest'>;
  ids: IdGenerator;
  threadStore: ThreadStore;
  turnTasks: RuntimeTurnTaskRegistry;
  turnTermination: Pick<RuntimeTurnTerminationCoordinator, 'publishCancelledOnce'>;
  observeRun?(threadId: string, turnId: string, done: Promise<RuntimeThread>): void;
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
    const runtimeConfig = await this.options.configStore?.getConfig();
    const turnModel = resolveRuntimeTurnModel(runtimeConfig, thread);
    const budget = reserveRuntimeContextCompactionBudget(
      contextCompactionBudgetForConfig(runtimeConfig, turnModel?.model),
      reservedOutputTokensForConfig(runtimeConfig, turnModel?.model),
    );
    const messages = restoreNativeCompactionHistory(thread.messages, (message) => Boolean(turnModel && nativeCompactionMatchesModel(message, runtimeConfig, {
      providerId: turnModel.binding.providerId, model: turnModel.binding.modelCode,
    })));
    const candidate = createRuntimeContextCompactionCandidate({ budget, force, messages });
    if (!candidate) return thread;
    const turnId = this.options.ids.id('turn');
    const run = this.options.turnTasks.run<RuntimeThread>({
      acceptingSteers: false,
      taskKind: 'compact',
      threadId,
      turnId,
    }, (task) => this.run({ runtimeConfig, turnModel, force, signal: task.controller.signal, thread, threadId, turnId }));
    this.options.observeRun?.(threadId, turnId, run.done);
    return run.done;
  }

  private async run({
    runtimeConfig,
    turnModel,
    force,
    signal,
    thread,
    threadId,
    turnId,
  }: {
    runtimeConfig: RuntimeConfigState | undefined;
    turnModel: RuntimeResolvedTurnModel | undefined;
    force: boolean;
    signal: AbortSignal;
    thread: RuntimeThread;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeThread> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: {
        input: force ? '/compact' : '/compact auto',
        taskKind: 'compact',
        ...(turnModel ? { modelBinding: { ...turnModel.binding } } : {}),
      },
    });
    try {
      // Manual and automatic compaction share hooks, validation, persistence and debug tracing.
      await this.options.contextCompactor.compactMessagesBeforeModelRequest({
        force,
        messages: thread.messages,
        thread,
        threadId,
        turnId,
        signal,
        runtimeConfig,
        contextBudget: contextCompactionBudgetForConfig(runtimeConfig, turnModel?.model),
        reservedTokens: reservedOutputTokensForConfig(runtimeConfig, turnModel?.model),
        conversationModel: turnModel
          ? {
              providerId: turnModel.binding.providerId,
              model: turnModel.binding.modelCode,
            }
          : undefined,
      });
      await this.publishCompleted(threadId, turnId);
      return (await this.options.threadStore.getThread(threadId)) ?? thread;
    } catch (error) {
      if (error instanceof HookStoppedTurnError) {
        await this.publishCompleted(threadId, turnId);
        return (await this.options.threadStore.getThread(threadId)) ?? thread;
      }
      if (signal.aborted || isAbortError(error)) {
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
