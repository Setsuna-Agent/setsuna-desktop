import { describe, expect, it, vi } from 'vitest';
import type { RuntimeThread } from '@setsuna-desktop/contracts';
import { startThreadReview } from './startThreadReview.js';

describe('startThreadReview', () => {
  it('creates and selects a project thread before starting a first-turn review', async () => {
    const calls: string[] = [];
    const createdThread = thread('thread_new', 'project_a');
    const client = {
      createThread: vi.fn(async ({ projectId }: { projectId?: string }) => {
        calls.push(`create:${projectId}`);
        return createdThread;
      }),
      startReview: vi.fn(async (threadId: string) => {
        calls.push(`review:${threadId}`);
        return { accepted: true as const, turnId: 'turn_review' };
      }),
    };

    const started = await startThreadReview({
      activeProjectId: 'project_a',
      client,
      currentThread: null,
      onThreadCreated: async (created) => {
        calls.push(`select:${created.id}`);
      },
      target: { type: 'uncommittedChanges' },
    });

    expect(started).toEqual({ accepted: true, turnId: 'turn_review' });
    expect(calls).toEqual(['create:project_a', 'select:thread_new', 'review:thread_new']);
  });

  it('starts review in the existing thread without creating another one', async () => {
    const currentThread = thread('thread_existing', 'project_a');
    const client = {
      createThread: vi.fn(async () => thread('unexpected')),
      startReview: vi.fn(async () => ({ accepted: true as const, turnId: 'turn_review' })),
    };
    const onThreadCreated = vi.fn();

    await startThreadReview({
      activeProjectId: 'project_a',
      client,
      currentThread,
      onThreadCreated,
      target: { type: 'uncommittedChanges' },
    });

    expect(client.createThread).not.toHaveBeenCalled();
    expect(onThreadCreated).not.toHaveBeenCalled();
    expect(client.startReview).toHaveBeenCalledWith('thread_existing', { type: 'uncommittedChanges' });
  });
});

function thread(id: string, projectId?: string): RuntimeThread {
  return {
    id,
    projectId,
    title: '新对话',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    archived: false,
    messageCount: 0,
    lastMessagePreview: '',
    messages: [],
    lastSeq: 0,
  };
}
