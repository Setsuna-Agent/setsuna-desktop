import { expect, it } from 'vitest';
import { automationSnapshotCodec, automationStateCodec } from '../../src/contracts/index.js';

it('reads legacy task documents and keeps archived run identities through the snapshot contract', () => {
  expect(automationStateCodec.parse({ tasks: [], draftThreadId: 'draft' })).toEqual({ tasks: [], archivedRuns: [], draftThreadId: 'draft' });
  const at = '2026-10-16T00:00:00.000Z';
  const archivedRuns = ['completed', 'failed', 'cancelled', 'interrupted'].map((status) => ({
    taskId: 'deleted', taskTitle: 'Deleted task',
    run: { id: `run_${status}`, threadId: 'execution', turnId: `turn_${status}`, status, scheduledFor: at, startedAt: at, finishedAt: at },
  }));
  const snapshot = { tasks: [], archivedRuns, models: [], projects: [] };
  expect(automationSnapshotCodec.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  expect(() => automationStateCodec.parse({ tasks: [], archivedRuns: {} })).toThrow('Archived runs must be an array.');
  expect(() => automationStateCodec.parse({ tasks: [], archivedRuns: [{ ...archivedRuns[0], run: { ...archivedRuns[0].run, status: 'running' } }] }))
    .toThrow('Cannot archive an active automation run.');
});
