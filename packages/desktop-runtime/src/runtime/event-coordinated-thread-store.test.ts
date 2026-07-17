import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../adapters/event/in-memory-event-bus.js';
import { RandomIdGenerator } from '../adapters/id/random-id-generator.js';
import { JsonThreadStore } from '../adapters/store/json-thread-store.js';
import { RuntimeEventWriter } from '../loop/runtime-event-writer.js';
import { systemClock } from '../ports/clock.js';
import { EventCoordinatedThreadStore } from './event-coordinated-thread-store.js';

describe('event-coordinated thread store', () => {
  it('flushes buffered deltas before assigning seq to a direct mutation', async () => {
    const inner = new JsonThreadStore(await mkdtemp(path.join(tmpdir(), 'setsuna-coordinated-store-test-')), systemClock, new RandomIdGenerator());
    const writer = new RuntimeEventWriter(inner, new InMemoryEventBus(), 10_000);
    const store = new EventCoordinatedThreadStore(inner, writer);
    const thread = await store.createThread({ title: 'Original title' });
    const createdAt = systemClock.now().toISOString();
    await writer.append(thread.id, {
      id: 'event_message',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.created',
      createdAt,
      payload: {
        message: {
          id: 'msg_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt,
          status: 'streaming',
        },
      },
    });
    await writer.append(thread.id, {
      id: 'event_delta',
      threadId: thread.id,
      turnId: 'turn_1',
      type: 'message.delta',
      createdAt,
      payload: { messageId: 'msg_1', text: 'before metadata' },
    });

    await store.updateThread(thread.id, { title: 'Updated title' });

    const events = await store.listEvents(thread.id);
    expect(events.slice(-2).map((event) => event.type)).toEqual(['message.delta', 'thread.updated']);
    await expect(store.getThread(thread.id)).resolves.toMatchObject({
      title: 'Updated title',
      messages: [expect.objectContaining({ content: 'before metadata' })],
    });
  });

  it('cleans up generated image assets removed by destructive thread mutations', async () => {
    const inner = new JsonThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-coordinated-store-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const writer = new RuntimeEventWriter(inner, new InMemoryEventBus(), 10_000);
    const deleteAsset = vi.fn(async () => undefined);
    const store = new EventCoordinatedThreadStore(inner, writer, {
      clone: vi.fn(async () => ({ assetId: 'unused_clone' })),
      create: vi.fn(async () => ({ assetId: 'unused' })),
      delete: deleteAsset,
      recover: vi.fn(async () => undefined),
    });
    const thread = await store.createThread({ title: 'Generated images' });
    const createdAt = systemClock.now().toISOString();

    await appendGeneratedImageMessage(writer, thread.id, 'msg_keep', 'generated_keep', createdAt);
    await appendGeneratedImageMessage(writer, thread.id, 'msg_remove', 'generated_remove', createdAt);
    await store.truncateMessagesAfter(thread.id, 'msg_keep');
    expect(deleteAsset).toHaveBeenCalledWith('generated_remove');
    expect(deleteAsset).not.toHaveBeenCalledWith('generated_keep');

    await store.clearThreadMessages(thread.id);
    expect(deleteAsset).toHaveBeenCalledWith('generated_keep');

    const deletedThread = await store.createThread({ title: 'Deleted thread' });
    await appendGeneratedImageMessage(writer, deletedThread.id, 'msg_delete', 'generated_delete', createdAt);
    await store.deleteThread(deletedThread.id);
    expect(deleteAsset).toHaveBeenCalledWith('generated_delete');

    deleteAsset.mockClear();
    const sourceThread = await store.createThread({ title: 'Fork source' });
    const forkedThread = await store.createThread({ title: 'Fork copy', forkedFromId: sourceThread.id });
    await appendGeneratedImageMessage(writer, sourceThread.id, 'msg_source', 'generated_shared', createdAt);
    await appendGeneratedImageMessage(writer, forkedThread.id, 'msg_fork', 'generated_shared', createdAt);
    await store.deleteThread(sourceThread.id);
    expect(deleteAsset).not.toHaveBeenCalledWith('generated_shared');
    await store.deleteThread(forkedThread.id);
    expect(deleteAsset).toHaveBeenCalledWith('generated_shared');

    deleteAsset.mockClear();
    const legacyThread = await store.createThread({ title: 'Legacy generated image' });
    await appendLegacyImageMessage(writer, legacyThread.id, createdAt);
    await store.clearThreadMessages(legacyThread.id);
    expect(deleteAsset).toHaveBeenCalledWith('legacy_generated_asset');
  });

  it('does not report a committed mutation as failed when the image reference scan fails', async () => {
    const inner = new JsonThreadStore(
      await mkdtemp(path.join(tmpdir(), 'setsuna-coordinated-store-test-')),
      systemClock,
      new RandomIdGenerator(),
    );
    const writer = new RuntimeEventWriter(inner, new InMemoryEventBus(), 10_000);
    const deleteAsset = vi.fn(async () => undefined);
    const store = new EventCoordinatedThreadStore(inner, writer, {
      clone: vi.fn(async () => ({ assetId: 'unused_clone' })),
      create: vi.fn(async () => ({ assetId: 'unused' })),
      delete: deleteAsset,
      recover: vi.fn(async () => undefined),
    });
    const thread = await store.createThread({ title: 'Generated images' });
    await appendGeneratedImageMessage(
      writer,
      thread.id,
      'msg_scan_failure',
      'generated_scan_failure',
      systemClock.now().toISOString(),
    );
    vi.spyOn(inner, 'listThreads').mockRejectedValue(new Error('scan failed'));

    await expect(store.clearThreadMessages(thread.id)).resolves.toMatchObject({ messages: [] });
    await expect(store.getThread(thread.id)).resolves.toMatchObject({ messages: [] });
    expect(deleteAsset).not.toHaveBeenCalled();
  });
});

async function appendGeneratedImageMessage(
  writer: RuntimeEventWriter,
  threadId: string,
  messageId: string,
  assetId: string,
  createdAt: string,
): Promise<void> {
  await writer.append(threadId, {
    id: `event_${messageId}`,
    threadId,
    turnId: `turn_${messageId}`,
    type: 'message.created',
    createdAt,
    payload: {
      message: {
        id: messageId,
        turnId: `turn_${messageId}`,
        role: 'assistant',
        content: '',
        createdAt,
        status: 'complete',
        attachments: [{
          id: `attachment_${messageId}`,
          name: `${messageId}.png`,
          type: 'image/png',
          size: 68,
          source: 'generated',
          assetId,
          modelVisible: false,
        }],
      },
    },
  });
}

async function appendLegacyImageMessage(
  writer: RuntimeEventWriter,
  threadId: string,
  createdAt: string,
): Promise<void> {
  await writer.append(threadId, {
    id: 'event_legacy_image',
    threadId,
    turnId: 'turn_legacy_image',
    type: 'message.created',
    createdAt,
    payload: {
      message: {
        id: 'msg_legacy_image',
        turnId: 'turn_legacy_image',
        role: 'assistant',
        content: '',
        createdAt,
        status: 'complete',
        attachments: [{
          id: 'attachment_legacy_image',
          name: 'legacy.png',
          type: 'image/png',
          size: 68,
          url: 'data:image/png;base64,AA==',
          localAssetId: 'legacy_generated_asset',
          modelVisible: false,
        }],
      },
    },
  });
}
