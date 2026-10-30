import { applyRuntimeEventToThread, type RuntimeMessage, type StoredThreadEvent } from '@setsuna-desktop/contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../src/adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../../../src/adapters/id/random-id-generator.js';
import { SqliteThreadStore } from '../../../src/adapters/store/sqlite-thread-store.js';
import { ContextCompactionCommitter } from '../../../src/loop/context/context-compaction-commit.js';
import { createRuntimeContextCompactionCandidate, estimateRuntimeMessageTokens, materializeRuntimeContextCompaction } from '../../../src/loop/context/context-compaction.js';
import { ContextTokenCalibration } from '../../../src/loop/context/context-token-calibration.js';
import { RuntimeEventWriter } from '../../../src/loop/lifecycle/runtime-event-writer.js';
import { systemClock } from '../../../src/ports/clock.js';
import type { PendingContextCompactionEvent } from '../../../src/ports/thread-store.js';

const stores: SqliteThreadStore[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('conditional context checkpoint installation', () => {
  it('rejects history edited during request preparation before capturing a newer version', async () => {
    const { store, thread, windows } = await fixture();
    await store.updateMessage(thread.id, 'task', { content: 'A new instruction' });
    await expect(windows.capture(thread.id, thread.messages)).rejects.toThrow('Context changed before compaction');
  });

  it('preserves appended corrections and tool transactions through commit, event replay and restart', async () => {
    const { store, directory, thread, append, windows, published } = await fixture();
    const expected = await windows.capture(thread.id, thread.messages);
    const event = compaction(thread.id, thread.messages);
    await append(message('correction', 'user', 'Keep the Windows implementation too.'));
    await append({ ...message('call', 'assistant', ''), phase: 'commentary', toolCalls: [{ id: 'call_new', name: 'read_file', arguments: '{}' }] });
    await append({ ...message('result', 'tool', 'Windows evidence'), toolCallId: 'call_new', toolName: 'read_file' });
    await expect(windows.commit(thread.id, expected, event, new AbortController().signal)).resolves.toMatchObject({
      payload: { sourceMessageIds: expected.messageIds },
    });
    const installed = await store.getThread(thread.id);
    expect(installed!.messages.filter((entry) => entry.visibility !== 'transcript').map((entry) => entry.id))
      .toEqual([...event.payload.messages.filter((entry) => entry.visibility !== 'transcript').map((entry) => entry.id), 'correction', 'call', 'result']);
    expect(published.filter((entry) => entry.type === 'thread.context_compacted')).toHaveLength(1);
    const events = await store.listEvents(thread.id);
    expect(events.reduce(applyRuntimeEventToThread, thread).messages).toEqual(installed!.messages);
    await store.close();
    const reopened = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator());
    stores.push(reopened);
    await reopened.recover();
    expect((await reopened.getThread(thread.id))!.messages).toEqual(installed!.messages);
  });

  it.each(['edit', 'delete', 'rollback', 'replace', 'cancel', 'overflow'] as const)('rejects a candidate after %s without poisoning later event writes', async (change) => {
    const { store, thread, append, windows, published } = await fixture();
    const expected = await windows.capture(thread.id, thread.messages);
    const event = compaction(thread.id, thread.messages);
    const controller = new AbortController();
    if (change === 'edit') await store.updateMessage(thread.id, 'task', { content: 'Corrected task constraint' });
    if (change === 'delete') await store.deleteMessages(thread.id, { messageIds: ['evidence'] });
    if (change === 'rollback') {
      await append(message('temporary', 'user', 'Discard this branch'));
      await store.truncateMessagesAfter(thread.id, 'latest');
    }
    if (change === 'replace') await windows.commit(thread.id, expected, { ...event, id: 'first_checkpoint' }, controller.signal);
    if (change === 'cancel') controller.abort(new Error('Cancelled'));
    if (change === 'overflow') await append(message('large_correction', 'user', 'x'.repeat(1_000_000)));
    const before = await store.getThread(thread.id);
    if (change === 'cancel') await expect(windows.commit(thread.id, expected, event, controller.signal)).rejects.toThrow('Cancelled');
    else await expect(windows.commit(thread.id, expected, event, controller.signal)).resolves.toBeNull();
    expect((await store.getThread(thread.id))!.messages).toEqual(before!.messages);
    expect(published.filter((entry) => entry.id === event.id)).toHaveLength(0);
    await append(message('after_rejection', 'user', 'Continue with current history'));
    expect((await store.getThread(thread.id))!.messages.at(-1)?.id).toBe('after_rejection');
  });

  it('persists a measured usage baseline, applies append deltas after restart and invalidates edited evidence', async () => {
    const { store, directory, thread, writer } = await fixture();
    const model = { model: 'test', providerId: 'provider' };
    const calibration = new ContextTokenCalibration();
    const raw = estimateRuntimeMessageTokens(thread.messages);
    calibration.record(model, thread.messages, [], { inputTokens: raw - 300, cachedInputTokens: 900, totalTokens: 90_000 });
    await writer.append(thread.id, {
      id: 'calibration', threadId: thread.id, createdAt: now,
      type: 'thread.context_usage_calibrated', payload: { baseline: calibration.snapshot()! },
    });
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
    const database = new DatabaseSync(path.join(directory, 'threads.sqlite'), { readOnly: true });
    try {
      const row = database.prepare('SELECT snapshot_seq, last_seq FROM threads WHERE id = ?').get(thread.id)!;
      expect(Number(row.snapshot_seq)).toBeLessThan(Number(row.last_seq));
      expect((await store.listEvents(thread.id)).reduce(applyRuntimeEventToThread, thread).contextUsageBaseline).toEqual(calibration.snapshot());
    } finally { database.close(); }
    await store.close();
    const reopened = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator());
    stores.push(reopened);
    await reopened.recover();
    const recovered = (await reopened.getThread(thread.id))!;
    const resumed = new ContextTokenCalibration(recovered.contextUsageBaseline);
    expect(resumed.adjustment(model, [...recovered.messages, message('extra', 'user', 'Continue')])).toBe(-300);
    await reopened.updateMessage(thread.id, 'task', { content: 'Different task constraint' });
    expect(resumed.adjustment(model, (await reopened.getThread(thread.id))!.messages)).toBe(0);
  });
});

const now = '2026-10-30T00:00:00Z';
function message(id: string, role: RuntimeMessage['role'], content: string): RuntimeMessage {
  return { id, role, content, createdAt: now, status: 'complete', ...(role === 'assistant' ? { phase: 'final_answer' } : {}) };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'setsuna-compaction-commit-'));
  directories.push(directory);
  const store = new SqliteThreadStore(directory, systemClock, new RandomIdGenerator(), { checkpointDelayMs: 60_000 });
  stores.push(store);
  const initial = await store.createThread({ title: 'Checkpoint transaction' });
  const bus = new InMemoryEventBus();
  const writer = new RuntimeEventWriter(store, bus);
  const published: StoredThreadEvent[] = [];
  bus.subscribe(initial.id, (event) => published.push(event));
  const append = (entry: RuntimeMessage) => writer.append(initial.id, {
    id: `created_${entry.id}`, threadId: initial.id, type: 'message.created', createdAt: now, payload: { message: entry },
  });
  await append(message('task', 'user', 'Keep all task constraints'));
  await append(message('evidence', 'assistant', 'Verified evidence. '.repeat(800)));
  await append(message('latest', 'assistant', 'Next action'));
  return { store, directory, writer, append, published, thread: (await store.getThread(initial.id))!, windows: new ContextCompactionCommitter(store, writer) };
}

function compaction(threadId: string, messages: RuntimeMessage[]): PendingContextCompactionEvent {
  const candidate = createRuntimeContextCompactionCandidate({ messages, force: true, keepRecentMessages: 1 })!;
  return {
    id: 'checkpoint', threadId, type: 'thread.context_compacted', createdAt: now,
    payload: materializeRuntimeContextCompaction({ candidate, createdAt: now, id: 'handoff', summary: 'Verified work and next action.' }),
  };
}
