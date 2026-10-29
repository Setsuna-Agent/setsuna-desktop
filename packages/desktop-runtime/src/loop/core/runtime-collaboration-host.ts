import type {
  CollaborationRuntimeHost,
  CollaborationSubagentTurnInput,
} from '@setsuna-desktop/feature-collaboration/contracts';
import type { StartTurnResponse } from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import type { RuntimeEventWriter } from '../lifecycle/runtime-event-writer.js';
import type { RuntimeTurnTaskRegistry } from '../lifecycle/turn-task-registry.js';
import { TurnCancelledError } from './runtime-turn-errors.js';
import type { ConfigStore } from '../../ports/config-store.js';
import type { AttachmentStore } from '../../ports/attachment-store.js';
import { collaborationModelServices } from './runtime-collaboration-model.js';

type RuntimeCollaborationTurnServices = Readonly<{
  steerTurn(threadId: string, input: { input: string; expectedTurnId: string }): Promise<unknown>;
  cancelTurn(threadId: string, turnId: string): Promise<boolean>;
  deliverMailboxInput(
    threadId: string,
    input: Parameters<CollaborationRuntimeHost['deliverMailbox']>[1],
    execution?: Parameters<CollaborationRuntimeHost['deliverMailbox']>[2],
  ): ReturnType<CollaborationRuntimeHost['deliverMailbox']>;
  startSubagentTurn(
    threadId: string,
    input: CollaborationSubagentTurnInput,
    execution?: Parameters<CollaborationRuntimeHost['startTurn']>[2],
  ): Promise<StartTurnResponse>;
}>;

type RuntimeCollaborationHostDependencies = Readonly<{
  clock: Clock;
  ids: IdGenerator;
  threadStore: ThreadStore;
  eventWriter: RuntimeEventWriter;
  turnTasks: Pick<RuntimeTurnTaskRegistry, 'registeredForThread' | 'taskFor'>;
  turns: RuntimeCollaborationTurnServices;
  configStore?: ConfigStore;
  attachmentStore?: AttachmentStore;
}>;

/** Adapt Core thread and turn services to the Collaboration Feature's narrow host port. */
export function createRuntimeCollaborationHost(
  dependencies: RuntimeCollaborationHostDependencies,
): CollaborationRuntimeHost {
  const host: CollaborationRuntimeHost = {
    ...collaborationModelServices(dependencies.configStore, dependencies.turnTasks),
    steerTurn: async (threadId, content, expectedTurnId) => { await dependencies.turns.steerTurn(threadId, { input: content, expectedTurnId }); },
    retainAttachments: async (parentThreadId, childThreadId, attachments) => {
      if (!attachments.length) return;
      const parent = await dependencies.threadStore.getThread(parentThreadId);
      const owned = new Map(parent?.messages.flatMap((message) => message.attachments ?? []).map((attachment) => [attachment.id, attachment]));
      for (const attachment of attachments) {
        if (JSON.stringify(owned.get(attachment.id)) !== JSON.stringify(attachment)) throw new Error('Handoff attachment is not owned by the parent thread.');
      }
      const runtimeAttachments = attachments.filter((attachment) => attachment.source === 'runtime');
      if (runtimeAttachments.length) {
        if (!dependencies.attachmentStore) throw new Error('Attachment store is unavailable.');
        const resolved = await dependencies.attachmentStore.resolveForThread(parentThreadId, runtimeAttachments);
        if (resolved.length !== runtimeAttachments.length) throw new Error('A parent attachment is no longer available.');
        await dependencies.attachmentStore.retainForThread(childThreadId, runtimeAttachments);
      }
    },
    now: () => dependencies.clock.now(),
    id: (prefix) => dependencies.ids.id(prefix),
    getThread: (threadId) => dependencies.threadStore.getThread(threadId),
    createThread: (input) => dependencies.threadStore.createThread(input),
    activeTask: (threadId) => {
      const task = dependencies.turnTasks.registeredForThread(threadId);
      return task ? { threadId, turnId: task.turnId, done: task.done,
        acceptingInput: task.acceptingSteers && !task.controller.signal.aborted } : null;
    },
    waitForInput: (threadId, turnId, signal) => {
      const task = dependencies.turnTasks.taskFor(threadId, turnId);
      return task ? task.inputQueue.waitForInput(signal) : Promise.reject(new TurnCancelledError());
    },
    cancelTurn: (threadId, turnId) => dependencies.turns.cancelTurn(threadId, turnId),
    deliverMailbox: (threadId, input, execution) => dependencies.turns.deliverMailboxInput(threadId, input, execution),
    startTurn: async (threadId, input, execution) => {
      const started = await dependencies.turns.startSubagentTurn(threadId, input, execution);
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
