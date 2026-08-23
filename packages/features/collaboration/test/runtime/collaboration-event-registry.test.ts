import type { LegacyRuntimeCollaborationEvent } from '@setsuna-desktop/contracts';
import { createFeatureEvent } from '@setsuna-desktop/feature-core/events';
import { describe, expect, it } from 'vitest';
import {
  collaborationTaskStatusChangedEvent,
  createInitialCollaborationState,
  type CollaborationTask,
} from '../../src/contracts/index.js';
import { createRuntimeCollaborationEventRegistry } from '../../src/runtime/index.js';

describe('collaboration event registry', () => {
  it('replays legacy ledger records and continues with current Feature events', () => {
    const registry = createRuntimeCollaborationEventRegistry();
    const legacy: LegacyRuntimeCollaborationEvent = {
      id: 'event_legacy_created',
      seq: 1,
      threadId: 'thread_parent',
      type: 'collaboration.task_created',
      createdAt: '2026-08-20T00:00:00.000Z',
      payload: { task: task() },
    };
    const created = registry.reduce(createInitialCollaborationState(), legacy);
    const completed = registry.reduce(created, {
      ...createFeatureEvent(
        collaborationTaskStatusChangedEvent,
        {
          id: 'event_feature_completed',
          threadId: 'thread_parent',
          createdAt: '2026-08-20T00:00:02.000Z',
        },
        {
          taskId: 'task_1',
          status: 'completed',
          resultPreview: 'Repository inspected.',
        },
      ),
      seq: 2,
    });

    expect(completed.tasks).toEqual([expect.objectContaining({
      id: 'task_1',
      status: 'completed',
      resultPreview: 'Repository inspected.',
      completedAt: '2026-08-20T00:00:02.000Z',
    })]);
  });
});

function task(): CollaborationTask {
  return {
    id: 'task_1',
    childThreadId: 'thread_child',
    title: 'Repository scan',
    objective: 'Inspect the repository.',
    identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    status: 'running',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}
