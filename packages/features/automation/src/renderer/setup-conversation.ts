import type { RuntimeThread } from '@setsuna-desktop/contracts';

/** Private setup instructions exist before the first user turn. */
export function automationSetupPending(thread: RuntimeThread | null): boolean {
  if (!thread || thread.activeTurnId || thread.turns?.length || thread.queuedTurnInputs?.length
    || thread.messagePage?.nextBefore != null) return false;
  return thread.messages.every((message) => !message.turnId && (
    message.visibility === 'model'
    || (message.role === 'assistant' && message.status === 'complete' && !message.toolRuns?.length && !message.hookRuns?.length)
  ));
}
