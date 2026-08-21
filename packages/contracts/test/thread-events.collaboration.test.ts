import { describe, expect, it } from 'vitest';
import type { RuntimeCollaborationTask } from '../src/provider.js';
import type { RuntimeThread } from '../src/threads.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeEvent } from '../src/events.js';

describe('collaboration task projection', () => {
  it('appends a task from collaboration.task_created and updates it from status changes', () => {
    const thread = baseThread();
    const task = collaborationTask('task_1', 'queued');

    const created = applyRuntimeEventToThread(thread, event('collaboration.task_created', { task }, 1));
    expect(created.collaborationTasks).toHaveLength(1);
    expect(created.collaborationTasks?.[0]).toMatchObject({
      id: 'task_1',
      status: 'queued',
      identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    });

    const running = applyRuntimeEventToThread(created, event('collaboration.task_status_changed', {
      taskId: 'task_1',
      status: 'running',
      activeTurnId: 'turn_child',
    }, 2));
    expect(running.collaborationTasks?.[0]).toMatchObject({
      status: 'running',
      activeTurnId: 'turn_child',
      updatedAt: '2026-07-30T00:00:02.000Z',
    });
    expect(running.collaborationTasks?.[0]?.completedAt).toBeUndefined();

    const completed = applyRuntimeEventToThread(running, event('collaboration.task_status_changed', {
      taskId: 'task_1',
      status: 'completed',
      activeTurnId: 'turn_child',
      resultPreview: 'Research finished.',
    }, 3));
    expect(completed.collaborationTasks?.[0]).toMatchObject({
      status: 'completed',
      resultPreview: 'Research finished.',
      completedAt: '2026-07-30T00:00:03.000Z',
    });
  });

  it('does not duplicate a task id and ignores status events for unknown tasks', () => {
    const thread = baseThread();
    const task = collaborationTask('task_1', 'queued');
    const created = applyRuntimeEventToThread(thread, event('collaboration.task_created', { task }, 1));
    const duplicate = applyRuntimeEventToThread(created, event('collaboration.task_created', { task }, 2));
    expect(duplicate.collaborationTasks).toHaveLength(1);

    const unknown = applyRuntimeEventToThread(duplicate, event('collaboration.task_status_changed', {
      taskId: 'task_missing',
      status: 'running',
    }, 3));
    expect(unknown.collaborationTasks).toHaveLength(1);
  });

  it('projects stale terminal status without clearing a newer completedAt', () => {
    const thread = baseThread();
    const task = collaborationTask('task_1', 'running');
    const created = applyRuntimeEventToThread(thread, event('collaboration.task_created', { task }, 1));
    const completed = applyRuntimeEventToThread(created, event('collaboration.task_status_changed', {
      taskId: 'task_1',
      status: 'completed',
      activeTurnId: 'turn_1',
    }, 2));
    expect(completed.collaborationTasks?.[0]?.completedAt).toBe('2026-07-30T00:00:02.000Z');

    // A later interrupted event on the same task keeps the original completion marker.
    const interrupted = applyRuntimeEventToThread(completed, event('collaboration.task_status_changed', {
      taskId: 'task_1',
      status: 'interrupted',
    }, 3));
    expect(interrupted.collaborationTasks?.[0]).toMatchObject({
      status: 'interrupted',
      completedAt: '2026-07-30T00:00:02.000Z',
    });
  });

  it('clones the task identity so the reducer never shares mutable records', () => {
    const thread = baseThread();
    const task = collaborationTask('task_1', 'queued');
    const created = applyRuntimeEventToThread(thread, event('collaboration.task_created', { task }, 1));
    task.identity.displayName = 'mutated';
    expect(created.collaborationTasks?.[0]?.identity.displayName).toBe('Scout');
  });
});

function event<TType extends RuntimeEvent['type']>(
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
  seq: number,
): RuntimeEvent {
  return {
    id: `event_${type}_${seq}`,
    seq,
    threadId: 'thread_1',
    type,
    createdAt: `2026-07-30T00:00:0${seq}.000Z`,
    payload,
  } as RuntimeEvent;
}

function collaborationTask(id: string, status: RuntimeCollaborationTask['status']): RuntimeCollaborationTask {
  return {
    id,
    childThreadId: 'thread_child',
    title: 'Research repo',
    objective: 'Inspect the repository.',
    identity: { displayName: 'Scout', avatarSeed: 'seed_1' },
    status,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

function baseThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Thread',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    archived: false,
    messageCount: 1,
    lastMessagePreview: 'Hello',
    lastSeq: 0,
    messages: [{
      id: 'message_1',
      turnId: 'turn_1',
      role: 'assistant',
      content: 'Hello',
      createdAt: '2026-07-30T00:00:00.000Z',
      status: 'complete',
    }],
  };
}
