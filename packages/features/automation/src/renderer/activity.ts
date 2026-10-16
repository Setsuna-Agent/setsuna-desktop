import type { AutomationActivityEntry, AutomationState } from '../contracts/index.js';

export function automationActivity({ tasks, archivedRuns }: Pick<AutomationState, 'tasks' | 'archivedRuns'>): AutomationActivityEntry[] {
  return [...archivedRuns, ...tasks.flatMap((task) => task.runs.map((run) => ({ taskId: task.id, taskTitle: task.title, run })))]
    .sort((left, right) => Date.parse(right.run.startedAt) - Date.parse(left.run.startedAt));
}
