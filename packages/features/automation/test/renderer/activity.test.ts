import { expect, it } from 'vitest';
import type { AutomationRun, AutomationTask } from '../../src/contracts/index.js';
import { automationActivity } from '../../src/renderer/activity.js';

it('merges runs from every task by execution time and retains the task and conversation to open', () => {
  const run = (id: string, at: string, status: AutomationRun['status']): AutomationRun => ({
    id, threadId: `thread-${id}`, scheduledFor: at, startedAt: at, status,
  });
  const task = (id: string, runs: AutomationRun[]): AutomationTask => ({
    id, title: `Task ${id}`, prompt: 'Run task', schedule: { kind: 'interval', minutes: 60 }, newChat: false,
    conversationThreadId: `setup-${id}`, status: 'active', nextRunAt: null,
    createdAt: '2026-09-30T00:00:00.000Z', updatedAt: '2026-09-30T00:00:00.000Z', runs,
  });
  const tasks = [
    task('a', [run('old', '2026-09-30T01:00:00.000Z', 'completed'), run('latest', '2026-09-30T03:00:00.000Z', 'running')]),
    { ...task('b', [run('middle', '2026-09-30T02:00:00.000Z', 'failed')]), status: 'paused' as const },
    task('empty', []),
  ];

  expect(automationActivity(tasks).map(({ taskId, taskTitle, run }) => [taskId, taskTitle, run.id, run.threadId, run.status])).toEqual([
    ['a', 'Task a', 'latest', 'thread-latest', 'running'],
    ['b', 'Task b', 'middle', 'thread-middle', 'failed'],
    ['a', 'Task a', 'old', 'thread-old', 'completed'],
  ]);
  expect(tasks[0].runs.map((run) => run.id)).toEqual(['old', 'latest']);
});
