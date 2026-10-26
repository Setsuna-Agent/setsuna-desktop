import { DEFAULT_THREAD_TITLE, fallbackThreadTitle, type PendingStoredThreadEvent, type RuntimeMessage } from '@setsuna-desktop/contracts';
import type { GoalRuntimeHost } from '../contracts/index.js';

export type GoalPublishOptions = {
  lifecycleMessage?: RuntimeMessage;
  preserveExecution?: boolean;
  queuedInputId?: string;
  sourceMessage?: RuntimeMessage;
  turnId?: string;
};

export function goalLifecycleEvents(host: GoalRuntimeHost, threadId: string, options: GoalPublishOptions): PendingStoredThreadEvent[] {
  return [options.sourceMessage, options.lifecycleMessage]
    .filter((message): message is RuntimeMessage => Boolean(message))
    .map(message => ({ id: host.id('event'), threadId,
      ...(message.turnId ? { turnId: message.turnId } : {}), type: 'message.created', createdAt: message.createdAt,
      payload: { message, ...(message === options.sourceMessage && options.queuedInputId ? { queuedInputId: options.queuedInputId } : {}) },
    }));
}

export async function updateDefaultGoalTitle(host: GoalRuntimeHost, threadId: string, currentTitle: string, objective: string): Promise<void> {
  if (currentTitle !== DEFAULT_THREAD_TITLE) return;
  await host.appendEvents(threadId, [{ id: host.id('event'), threadId, type: 'thread.updated',
    createdAt: host.now().toISOString(), payload: { title: fallbackThreadTitle(objective) } }]);
}
