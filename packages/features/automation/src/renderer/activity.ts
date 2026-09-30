import type { AutomationRun, AutomationTask } from '../contracts/index.js';

export type AutomationActivityEntry = {
  taskId: string;
  taskTitle: string;
  run: AutomationRun;
};

export function automationActivity(tasks: AutomationTask[]): AutomationActivityEntry[] {
  return tasks.flatMap((task) => task.runs.map((run) => ({ taskId: task.id, taskTitle: task.title, run })))
    .sort((left, right) => Date.parse(right.run.startedAt) - Date.parse(left.run.startedAt));
}
