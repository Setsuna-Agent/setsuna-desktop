import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../../ports/clock.js';
import { RandomIdGenerator } from '../id/random-id-generator.js';
import { JsonThreadStore } from './json-thread-store.js';

describe('json thread store', () => {
  it('stores global and project-scoped threads locally', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());

    const global = await store.createThread({ title: 'Global chat' });
    const project = await store.createThread({ title: 'Project chat', projectId: 'project_1' });

    const all = await store.listThreads();
    const globalOnly = await store.listThreads({ scope: 'global' });
    const projectOnly = await store.listThreads({ projectId: 'project_1' });
    const anyProject = await store.listThreads({ scope: 'project' });

    expect(project).toMatchObject({ projectId: 'project_1', title: 'Project chat' });
    expect(all.map((thread) => thread.id).sort()).toEqual([global.id, project.id].sort());
    expect(globalOnly).toMatchObject([{ id: global.id }]);
    expect(projectOnly).toMatchObject([{ id: project.id, projectId: 'project_1' }]);
    expect(anyProject).toMatchObject([{ id: project.id, projectId: 'project_1' }]);
  });

  it('updates, deletes, and truncates messages through events', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Message edits' });
    const createdAt = systemClock.now().toISOString();

    for (const message of [
      { id: 'msg_user_1', role: 'user' as const, content: 'original' },
      { id: 'msg_assistant_1', role: 'assistant' as const, content: 'old answer' },
      { id: 'msg_user_2', role: 'user' as const, content: 'later' },
      { id: 'msg_assistant_2', role: 'assistant' as const, content: 'later answer' },
    ]) {
      await store.appendEvent(thread.id, {
        id: `event_${message.id}`,
        threadId: thread.id,
        type: 'message.created',
        createdAt,
        payload: {
          message: {
            ...message,
            createdAt,
            status: 'complete',
          },
        },
      });
    }

    const edited = await store.updateMessage(thread.id, 'msg_user_1', { content: 'edited' });
    expect(edited.messages[0]).toMatchObject({ id: 'msg_user_1', content: 'edited' });

    const deleted = await store.deleteMessages(thread.id, { messageIds: ['msg_assistant_2'] });
    expect(deleted.messages.map((message) => message.id)).not.toContain('msg_assistant_2');

    const truncated = await store.truncateMessagesAfter(thread.id, 'msg_user_1');
    expect(truncated.messages.map((message) => message.id)).toEqual(['msg_user_1']);
    expect(truncated.lastMessagePreview).toBe('edited');
  });
});
