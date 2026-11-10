import { setImmediate } from 'node:timers/promises';
import type { AgentLoop } from '../loop/core/agent-loop.js';
import type { AttachmentStore } from '../ports/attachment-store.js';
import type { EventBus } from '../ports/event-bus.js';
import { copyRuntimeMessagesToThread, type RuntimeMessageCopyHost } from '../runtime/use-cases/thread-copy.js';

type AssistantHistoryHost = RuntimeMessageCopyHost & {
  agentLoop: Pick<AgentLoop, 'withIdleThreadMutation'>;
  attachmentStore: Pick<AttachmentStore, 'retainForThread'>;
  eventBus: Pick<EventBus, 'publish'>;
};

/** Imports each durable message once; originals remain archived so no historical evidence is destroyed. */
export async function mergeAssistantConversationHistory(runtime: AssistantHistoryHost, sourceThreadId: string, destinationThreadId: string): Promise<boolean> {
  if (sourceThreadId === destinationThreadId) return true;
  let imported = false;
  const claimed = await runtime.agentLoop.withIdleThreadMutation([sourceThreadId, destinationThreadId], async () => {
    const source = await runtime.threadStore.getThread(sourceThreadId);
    const destination = await runtime.threadStore.getThread(destinationThreadId);
    if (!source || !destination || source.featureId !== 'assistants' || destination.featureId !== 'assistants') {
      throw new Error('Assistant history must stay within assistant transcripts.');
    }
    if (source.queuedTurnInputs?.length || destination.queuedTurnInputs?.length) return;
    const known = new Set(destination.messages.map((message) => message.id));
    const missing = source.messages.filter((message) => !known.has(message.id));
    if (missing.length) {
      await runtime.attachmentStore.retainForThread(destinationThreadId, missing.flatMap((message) => message.attachments ?? []));
      // Copy the current context and checkpoints as messages. Replaying source compaction events
      // would replace the destination's context and lose what the assistant already knew there.
      // Yield between bounded batches so a large optional import cannot starve other runtime requests.
      for (let offset = 0; offset < missing.length; offset += 128) {
        await copyRuntimeMessagesToThread(runtime, sourceThreadId, destinationThreadId, missing.slice(offset, offset + 128));
        if (offset + 128 < missing.length) await setImmediate();
      }
    }
    if (!source.archived) await runtime.threadStore.updateThread(sourceThreadId, { archived: true });
    for (const event of await runtime.threadStore.listEvents(destinationThreadId, destination.lastSeq)) runtime.eventBus.publish(event);
    for (const event of await runtime.threadStore.listEvents(sourceThreadId, source.lastSeq)) runtime.eventBus.publish(event);
    imported = true;
  });
  return claimed && imported;
}
