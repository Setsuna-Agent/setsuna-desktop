import { isActiveToolRun, type RuntimeThread } from '@setsuna-desktop/contracts';

/** Include legacy message/tool state even when no activeTurnId was persisted. */
export function activeTurnIdsInThread(thread: RuntimeThread | null): string[] {
  const turnIds = new Set<string>();
  if (!thread) return [];
  if (thread.activeTurnId) turnIds.add(thread.activeTurnId);
  for (const turn of thread.turns ?? []) {
    if (turn.status === 'in_progress' || turn.items.some((item) => item.status === 'in_progress')) {
      turnIds.add(turn.id);
    }
  }
  for (const message of thread.messages) {
    if (!message.turnId) continue;
    if (message.status === 'streaming' || message.toolRuns?.some(isActiveToolRun)) {
      turnIds.add(message.turnId);
    }
  }
  return [...turnIds];
}
