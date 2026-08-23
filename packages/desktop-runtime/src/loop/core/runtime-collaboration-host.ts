import type {
  CollaborationActiveTask,
  CollaborationRuntimeHost,
  CollaborationSubagentTurnInput,
} from '@setsuna-desktop/feature-collaboration/contracts';
import type { StartTurnResponse } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';

type RuntimeCollaborationHostDependencies = Readonly<{
  clock: Clock;
  ids: IdGenerator;
  threadStore: ThreadStore;
  eventWriter: RuntimeEventWriter;
  activeTask(threadId: string): CollaborationActiveTask | null;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  deliverMailbox(
    threadId: string,
    input: Parameters<CollaborationRuntimeHost['deliverMailbox']>[1],
  ): ReturnType<CollaborationRuntimeHost['deliverMailbox']>;
  startTurn(
    threadId: string,
    input: CollaborationSubagentTurnInput,
  ): Promise<StartTurnResponse>;
}>;

/** Adapt Core thread and turn services to the Collaboration Feature's narrow host port. */
export function createRuntimeCollaborationHost(
  dependencies: RuntimeCollaborationHostDependencies,
): CollaborationRuntimeHost {
  const host: CollaborationRuntimeHost = {
    now: () => dependencies.clock.now(),
    id: (prefix) => dependencies.ids.id(prefix),
    listThreads: () => dependencies.threadStore.listThreads({
      includeArchived: true,
      includeSide: true,
    }),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    createThread: (input) => dependencies.threadStore.createThread(input),
    activeTask: (threadId) => dependencies.activeTask(threadId),
    cancelTurn: (threadId, turnId) => dependencies.cancelTurn(threadId, turnId),
    deliverMailbox: (threadId, input) => dependencies.deliverMailbox(threadId, input),
    startTurn: async (threadId, input) => {
      const started = await dependencies.startTurn(threadId, input);
      if ('queuedInputId' in started && !started.turnId) {
        throw new Error(`Collaboration turn was queued instead of started: ${started.queuedInputId}`);
      }
      if (!started.turnId) throw new Error('Collaboration turn did not return a turn id.');
      return { turnId: started.turnId };
    },
    appendEvents: (threadId, events) => dependencies.eventWriter.appendBatch(threadId, events),
  };
  return Object.freeze(host);
}
