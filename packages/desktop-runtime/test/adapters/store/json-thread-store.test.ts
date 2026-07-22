import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../../../src/adapters/store/json-thread-store.js';
import { systemClock } from '../../../src/ports/clock.js';

describe('json thread store', () => {
  it('rejects path-like thread ids at the storage boundary', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());

    await expect(store.getThread('../escaped')).rejects.toThrow('Thread id is invalid');
    await expect(store.getThread('..\\escaped')).rejects.toThrow('Thread id is invalid');
    await expect(store.getThread('/absolute')).rejects.toThrow('Thread id is invalid');
  });

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
    expect(global.memoryMode).toBe('enabled');
  });

  it('stores spawned child relationships and filters by parent or ancestor', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());

    const parent = await store.createThread({ title: 'Parent' });
    const child = await store.createThread({ title: 'Child', parentThreadId: parent.id });
    const grandchild = await store.createThread({ title: 'Grandchild', parentThreadId: child.id });

    expect(child).toMatchObject({ parentThreadId: parent.id });
    expect((await store.listThreads({ includeArchived: true, parentThreadId: parent.id })).map((thread) => thread.id)).toEqual([child.id]);
    expect((await store.listThreads({ includeArchived: true, ancestorThreadId: parent.id })).map((thread) => thread.id).sort()).toEqual([child.id, grandchild.id].sort());
  });

  it('keeps the thread index complete across concurrent thread writes', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());

    const threads = await Promise.all(
      Array.from({ length: 12 }, (_, index) => store.createThread({ title: `Concurrent chat ${index}` })),
    );
    await Promise.all(
      threads.map((thread, index) =>
        store.appendEvent(thread.id, {
          id: `event_msg_${index}`,
          threadId: thread.id,
          type: 'message.created',
          createdAt: systemClock.now().toISOString(),
          payload: {
            message: {
              id: `msg_${index}`,
              role: 'user',
              content: `hello ${index}`,
              createdAt: systemClock.now().toISOString(),
              status: 'complete',
            },
          },
        }),
      ),
    );

    const indexedIds = new Set((await store.listThreads({ includeArchived: true })).map((thread) => thread.id));

    expect(indexedIds).toEqual(new Set(threads.map((thread) => thread.id)));
  });

  it('replays uncheckpointed events and rebuilds the index during recovery', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const firstStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await firstStore.createThread({ title: 'Recover me' });
    const event = {
      id: 'event_after_checkpoint',
      seq: thread.lastSeq + 1,
      threadId: thread.id,
      type: 'message.created' as const,
      createdAt: '2026-07-10T00:00:00.000Z',
      payload: {
        message: {
          id: 'msg_recovered',
          role: 'user' as const,
          content: 'persisted only in the log',
          createdAt: '2026-07-10T00:00:00.000Z',
          status: 'complete' as const,
        },
      },
    };
    await appendFile(path.join(dataDir, 'threads', `${thread.id}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
    await rm(path.join(dataDir, 'threads', 'index.json'));

    const recoveredStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await recoveredStore.recover();

    await expect(recoveredStore.getThread(thread.id)).resolves.toMatchObject({
      lastSeq: event.seq,
      messages: [expect.objectContaining({ id: 'msg_recovered', content: 'persisted only in the log' })],
    });
    await expect(recoveredStore.listThreads({ includeArchived: true })).resolves.toEqual([
      expect.objectContaining({ id: thread.id, lastMessagePreview: 'persisted only in the log' }),
    ]);
  });

  it('repairs an incomplete final event line without hiding middle corruption', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Tail repair' });
    const eventsPath = path.join(dataDir, 'threads', `${thread.id}.jsonl`);
    await appendFile(eventsPath, '{"id":"partial"', 'utf8');

    const recoveredStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await recoveredStore.recover();
    expect(await readFile(eventsPath, 'utf8')).toBe(`${JSON.stringify((await recoveredStore.listEvents(thread.id))[0])}\n`);

    await appendFile(eventsPath, '{broken}\n', 'utf8');
    const corruptStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(corruptStore.recover()).rejects.toThrow('Invalid runtime event JSON');
  });

  it('rejects gaps in the append-only event sequence', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Sequence gap' });
    await appendFile(path.join(dataDir, 'threads', `${thread.id}.jsonl`), `${JSON.stringify({
      id: 'event_gap',
      seq: thread.lastSeq + 2,
      threadId: thread.id,
      type: 'thread.updated',
      createdAt: '2026-07-10T00:00:00.000Z',
      payload: { patch: { title: 'must not apply' } },
    })}\n`, 'utf8');

    const recoveredStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(recoveredStore.recover()).rejects.toThrow('Invalid runtime event sequence');
  });

  it('updates thread metadata through the serialized event log', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Original' });

    const updated = await store.updateThread(thread.id, { title: '  Renamed  ', archived: true });

    expect(updated).toMatchObject({ title: 'Renamed', archived: true, lastSeq: thread.lastSeq + 1 });
    expect((await store.listEvents(thread.id)).at(-1)).toMatchObject({
      type: 'thread.updated',
      payload: { title: 'Renamed', archived: true },
    });
  });

  it('updates thread memory mode through the serialized event log', async () => {
    const store = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-')), systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Memory mode' });

    const updated = await store.updateThreadMemoryMode(thread.id, 'polluted', 'external_context:mcp__search__fetch');
    const listed = await store.listThreads({ includeArchived: true });

    expect(updated).toMatchObject({ memoryMode: 'polluted', lastSeq: thread.lastSeq + 1 });
    expect(listed.find((item) => item.id === thread.id)).toMatchObject({ memoryMode: 'polluted' });
    expect((await store.listEvents(thread.id)).at(-1)).toMatchObject({
      type: 'thread.memory_mode_updated',
      payload: { mode: 'polluted', reason: 'external_context:mcp__search__fetch' },
    });
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

  it('repairs and persists context compaction state left running by an older failed snapshot', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Interrupted compaction' });
    await store.appendEvent(thread.id, {
      id: 'event_turn_started',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-26T00:00:00.000Z',
      payload: { input: 'inspect repository' },
    });
    await store.appendEvent(thread.id, {
      id: 'event_assistant',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        message: {
          id: 'msg_assistant',
          turnId: 'turn_1',
          role: 'assistant',
          content: 'Inspecting the repository.',
          createdAt: '2026-06-26T00:00:01.000Z',
          status: 'streaming',
        },
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_compacting',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'thread.context_compacting',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: { maxContextTokensK: 256, usedTokens: 217817 },
    });
    await store.appendEvent(thread.id, {
      id: 'event_failed',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'runtime.error',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { code: 'turn_failed', message: 'Context compaction model request failed.' },
    });

    const snapshotPath = path.join(dataDir, 'threads', `${thread.id}.json`);
    const legacySnapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    legacySnapshot.contextCompaction = {
      status: 'running',
      startedAt: '2026-06-26T00:00:02.000Z',
      maxContextTokensK: 256,
      usedTokens: 217817,
    };
    await writeFile(snapshotPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`, 'utf8');

    const recoveredStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const recovered = await recoveredStore.getThread(thread.id);
    const persisted = JSON.parse(await readFile(snapshotPath, 'utf8'));

    expect(recovered?.contextCompaction).toBeUndefined();
    expect(recovered?.turns?.[0]).toMatchObject({ status: 'failed' });
    expect(persisted.contextCompaction).toBeUndefined();
  });

  it('normalizes legacy turn cancellations that were stored as rejected tool runs', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'setsuna-thread-store-test-'));
    const store = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    const thread = await store.createThread({ title: 'Legacy cancelled tool' });
    await store.appendEvent(thread.id, {
      id: 'event_turn',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.started',
      createdAt: '2026-06-26T00:00:00.000Z',
      payload: { input: 'write file' },
    });
    await store.appendEvent(thread.id, {
      id: 'event_message',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt: '2026-06-26T00:00:01.000Z',
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-06-26T00:00:01.000Z',
          status: 'streaming',
        },
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_preview',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'tool.preview',
      createdAt: '2026-06-26T00:00:02.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'write_file',
        argumentsPreview: '{"file_path":"src/generated.ts"',
        argumentsLength: 34,
      },
    });
    await store.appendEvent(thread.id, {
      id: 'event_cancel',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'turn.cancelled',
      createdAt: '2026-06-26T00:00:03.000Z',
      payload: { reason: 'Turn cancelled.' },
    });

    const snapshotPath = path.join(dataDir, 'threads', `${thread.id}.json`);
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
    snapshot.messages[0].toolRuns[0].status = 'rejected';
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    const recoveredStore = new JsonThreadStore(dataDir, systemClock, new RandomIdGenerator());
    await expect(recoveredStore.getThread(thread.id)).resolves.toMatchObject({
      messages: [expect.objectContaining({
        toolRuns: [expect.objectContaining({ id: 'call_1', status: 'cancelled' })],
      })],
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
