import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('deletes thread snapshots, event logs, and index entries', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Delete me' });
    await store.appendEvent(thread.id, {
      id: 'event_msg',
      threadId: thread.id,
      type: 'message.created',
      createdAt: systemClock.now().toISOString(),
      payload: {
        message: {
          id: 'msg_1',
          role: 'user',
          content: 'hello',
          createdAt: systemClock.now().toISOString(),
          status: 'complete',
        },
      },
    });

    await store.deleteThread(thread.id);

    expect(await store.getThread(thread.id)).toBeNull();
    expect((await store.listThreads({ includeArchived: true })).map((item) => item.id)).not.toContain(thread.id);
    expect(await store.listEvents(thread.id)).toEqual([]);
    await expect(readFile(path.join(dataDir, 'threads', `${thread.id}.json`), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(dataDir, 'threads', `${thread.id}.jsonl`), 'utf8')).rejects.toThrow();
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

  it('hydrates legacy snapshots with message completion times from events', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Legacy completion time' });

    await store.appendEvent(thread.id, {
      id: 'event_msg',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-26T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: '<think>plan</think>answer',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'complete',
        },
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_done',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.completed',
      createdAt: '2026-06-26T00:00:04.000Z',
      payload: { messageId: 'msg_assistant' },
    });

    const snapshotPath = path.join(dataDir, 'threads', `${thread.id}.json`);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    delete snapshot.messages[0].completedAt;
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    const hydrated = await store.getThread(thread.id);

    expect(hydrated?.messages[0]).toMatchObject({
      completedAt: '2026-06-26T00:00:04.000Z',
    });
  });

  it('persists streamed tool output in thread snapshots', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Tool output replay' });

    await store.appendEvent(thread.id, {
      id: 'event_msg',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-26T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-26T00:00:00.000Z',
          status: 'streaming',
        },
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_tool_started',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.started',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        argumentsPreview: '{"command":"pnpm test"}',
        source: 'agent',
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_tool_delta_1',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stdout: first\n',
        stream: 'stdout',
        source: 'agent',
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_tool_delta_2',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.output_delta',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        delta: 'stderr: second\n',
        stream: 'stderr',
        source: 'agent',
      },
    });

    const running = await store.getThread(thread.id);
    expect(running?.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      name: 'run_shell_command',
      source: 'agent',
      status: 'running',
      argumentsPreview: '{"command":"pnpm test"}',
      resultPreview: 'stdout: first\nstderr: second\n',
    });

    await store.appendEvent(thread.id, {
      id: 'event_tool_completed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.completed',
      createdAt: '2026-06-26T00:00:04.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'run_shell_command',
        status: 'success',
        content: '$ pnpm test\nstdout: done\nexit: 0',
        durationMs: 100,
        source: 'agent',
      },
    });

    const completed = await store.getThread(thread.id);
    expect(completed?.messages[0].toolRuns?.[0]).toMatchObject({
      id: 'call_1',
      status: 'success',
      resultPreview: '$ pnpm test\nstdout: done\nexit: 0',
      durationMs: 100,
    });
  });
});
