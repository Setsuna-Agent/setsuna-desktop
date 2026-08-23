import type {
  Goal,
  GoalRuntimeHost,
} from '@setsuna-desktop/feature-goal/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import type { RuntimeQueuedTurnCoordinator } from '../lifecycle/runtime-queued-turn-coordinator.js';
import type { RuntimeTurnTerminationCoordinator } from '../lifecycle/runtime-turn-termination-coordinator.js';
import type { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import type { RuntimeTurnRunFactory } from './runtime-turn-run-factory.js';

type RuntimeGoalHostDependencies = Readonly<{
  clock: Clock;
  ids: IdGenerator;
  threadStore: ThreadStore;
  eventWriter: RuntimeEventWriter;
  queuedTurns: RuntimeQueuedTurnCoordinator;
  turnRuns: RuntimeTurnRunFactory;
  turnTasks: RuntimeTurnTaskRegistry;
  turnTermination: RuntimeTurnTerminationCoordinator;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  mutateThread<T>(threadId: string, operation: () => Promise<T>): Promise<T>;
}>;

/** Adapt Core services to the narrow host capability consumed by the Goal Feature. */
export function createRuntimeGoalHost(
  dependencies: RuntimeGoalHostDependencies,
): GoalRuntimeHost {
  const host: GoalRuntimeHost = {
    now: () => dependencies.clock.now(),
    id: (prefix) => dependencies.ids.id(prefix),
    listThreads: () => dependencies.threadStore.listThreads({
      includeArchived: true,
      includeSide: true,
    }),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    listEvents: (threadId) => dependencies.threadStore.listEvents(threadId),
    activeTask: (threadId) => dependencies.turnTasks.activeForThread(threadId),
    registeredTask: (threadId) => dependencies.turnTasks.registeredForThread(threadId),
    cancelTurn: (threadId, turnId) => dependencies.cancelTurn(threadId, turnId),
    createContinuation: (threadId: string, goal: Goal, execution) => dependencies.mutateThread(
      threadId,
      async () => {
        const run = await dependencies.turnRuns.createGoalContinuation(threadId, goal, execution);
        dependencies.queuedTurns.observeRun(threadId, run.turnId, 'goal', run.done);
        return run;
      },
    ),
    hasQueuedInput: (threadId) => dependencies.queuedTurns.hasPending(threadId),
    waitForCancellationWrites: (threadId) => dependencies.turnTermination.waitForThread(threadId),
    appendEvents: (threadId, events) => dependencies.eventWriter.appendBatch(threadId, events),
  };
  return Object.freeze(host);
}
