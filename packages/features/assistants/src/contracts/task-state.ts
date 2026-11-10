import type { AssistantTask, AssistantTaskStatus } from './types.js';

const TERMINAL_TASK_STATUSES: ReadonlySet<AssistantTaskStatus> = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

export function isActiveTask(task: Pick<AssistantTask, 'status'>): boolean {
  return !TERMINAL_TASK_STATUSES.has(task.status);
}
