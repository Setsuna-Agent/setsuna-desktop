import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import { describe, expect, it, vi } from 'vitest';
import { copyRuntimeMessagesToThread } from '../../src/server/runtime-thread-events.js';
import type { RuntimeFactory } from '../../src/server/types.js';

describe('runtime thread event copying', () => {
  it('gives forked generated images independent assets and drops legacy cache references', async () => {
    const clone = vi.fn(async () => ({ assetId: 'generated_clone' }));
    const deleteAsset = vi.fn(async () => undefined);
    const appendEvent = vi.fn(async (_threadId: string, _event: unknown) => undefined);
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => undefined) },
      generatedImageStore: { clone, delete: deleteAsset },
      threadStore: { appendEvent },
    } as unknown as RuntimeFactory;

    const source = sourceMessage();
    await copyRuntimeMessagesToThread(runtime, 'thread_fork', [source]);

    expect(clone).toHaveBeenCalledWith('generated_source');
    const copiedEvent = appendEvent.mock.calls[0]?.[1] as { payload: { message: RuntimeMessage } };
    const copied = copiedEvent.payload.message;
    source.providerMetadata!.openAiResponses!.items[0]!.id = 'mutated_after_fork';
    expect(copied.attachments?.[0]).toMatchObject({ source: 'generated', assetId: 'generated_clone' });
    expect(copied.attachments?.[1]).toMatchObject({ url: 'data:image/png;base64,AA==' });
    expect(copied.attachments?.[1]).not.toHaveProperty('localAssetId');
    expect(copied.providerMetadata?.openAiResponses?.items[0]).toMatchObject({
      type: 'message',
      id: 'response_message_1',
    });
    expect(deleteAsset).not.toHaveBeenCalled();
  });

  it('rolls back cloned assets when the fork message cannot be committed', async () => {
    const deleteAsset = vi.fn(async () => undefined);
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => undefined) },
      generatedImageStore: {
        clone: vi.fn(async () => ({ assetId: 'generated_clone' })),
        delete: deleteAsset,
      },
      threadStore: {
        appendEvent: vi.fn(async () => { throw new Error('commit failed'); }),
        getThread: vi.fn(async () => ({ messages: [] })),
      },
    } as unknown as RuntimeFactory;

    await expect(copyRuntimeMessagesToThread(runtime, 'thread_fork', [sourceMessage()]))
      .rejects.toThrow('commit failed');
    expect(deleteAsset).toHaveBeenCalledWith('generated_clone');
    expect(deleteAsset).not.toHaveBeenCalledWith('generated_source');
  });

  it('rolls back cloned assets when pending fork events cannot be flushed', async () => {
    const deleteAsset = vi.fn(async () => undefined);
    const appendEvent = vi.fn(async () => undefined);
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => { throw new Error('flush failed'); }) },
      generatedImageStore: {
        clone: vi.fn(async () => ({ assetId: 'generated_clone' })),
        delete: deleteAsset,
      },
      threadStore: { appendEvent },
    } as unknown as RuntimeFactory;

    await expect(copyRuntimeMessagesToThread(runtime, 'thread_fork', [sourceMessage()]))
      .rejects.toThrow('flush failed');
    expect(deleteAsset).toHaveBeenCalledWith('generated_clone');
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it('keeps assets referenced by earlier fork messages when a later append fails', async () => {
    const deleteAsset = vi.fn(async () => undefined);
    const committedMessages: RuntimeMessage[] = [];
    const appendEvent = vi.fn(async (_threadId: string, event: { payload: { message: RuntimeMessage } }) => {
      if (committedMessages.length) throw new Error('second append failed');
      committedMessages.push(event.payload.message);
    });
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => undefined) },
      generatedImageStore: {
        clone: vi.fn(async (assetId: string) => ({ assetId: `${assetId}_clone` })),
        delete: deleteAsset,
      },
      threadStore: {
        appendEvent,
        getThread: vi.fn(async () => ({ messages: committedMessages })),
      },
    } as unknown as RuntimeFactory;
    const first = sourceMessage();
    const second = sourceMessage();
    second.id = 'msg_second';
    const secondGenerated = second.attachments?.[0];
    if (secondGenerated?.source === 'generated') secondGenerated.assetId = 'generated_second';

    await expect(copyRuntimeMessagesToThread(runtime, 'thread_fork', [first, second]))
      .rejects.toThrow('second append failed');
    expect(deleteAsset).toHaveBeenCalledWith('generated_second_clone');
    expect(deleteAsset).not.toHaveBeenCalledWith('generated_source_clone');
  });

  it('keeps an asset when a rejected append is already visible in the thread snapshot', async () => {
    const deleteAsset = vi.fn(async () => undefined);
    const persistedMessages: RuntimeMessage[] = [];
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => undefined) },
      generatedImageStore: {
        clone: vi.fn(async () => ({ assetId: 'generated_clone' })),
        delete: deleteAsset,
      },
      threadStore: {
        appendEvent: vi.fn(async (_threadId: string, event: { payload: { message: RuntimeMessage } }) => {
          persistedMessages.push(event.payload.message);
          throw new Error('snapshot write failed');
        }),
        getThread: vi.fn(async () => ({ messages: persistedMessages })),
      },
    } as unknown as RuntimeFactory;

    await expect(copyRuntimeMessagesToThread(runtime, 'thread_fork', [sourceMessage()]))
      .rejects.toThrow('snapshot write failed');
    expect(deleteAsset).not.toHaveBeenCalledWith('generated_clone');
  });

  it('keeps all clones when a rejected append cannot be checked for committed references', async () => {
    const deleteAsset = vi.fn(async () => undefined);
    const runtime = {
      eventWriter: { flushThread: vi.fn(async () => undefined) },
      generatedImageStore: {
        clone: vi.fn(async () => ({ assetId: 'generated_clone' })),
        delete: deleteAsset,
      },
      threadStore: {
        appendEvent: vi.fn(async () => { throw new Error('append result is uncertain'); }),
        getThread: vi.fn(async () => { throw new Error('snapshot unavailable'); }),
      },
    } as unknown as RuntimeFactory;

    await expect(copyRuntimeMessagesToThread(runtime, 'thread_fork', [sourceMessage()]))
      .rejects.toThrow('append result is uncertain');
    expect(deleteAsset).not.toHaveBeenCalled();
  });
});

function sourceMessage(): RuntimeMessage {
  return {
    id: 'msg_source',
    role: 'assistant',
    content: '',
    createdAt: '2026-07-17T00:00:00.000Z',
    providerMetadata: {
      schemaVersion: 2,
      source: {
        providerId: 'provider-1',
        providerKind: 'openai-responses',
        model: 'gpt-test',
        endpointFingerprint: 'a'.repeat(64),
      },
      openAiResponses: {
        kind: 'response',
        responseId: 'resp_1',
        items: [{
          type: 'message',
          id: 'response_message_1',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Fork-safe answer' }],
        }],
      },
    },
    attachments: [
      {
        id: 'generated_attachment',
        source: 'generated',
        assetId: 'generated_source',
        name: 'generated.png',
        type: 'image/png',
        size: 68,
        modelVisible: false,
      },
      {
        id: 'legacy_attachment',
        name: 'legacy.png',
        type: 'image/png',
        size: 4,
        url: 'data:image/png;base64,AA==',
        localAssetId: 'legacy_source_cache',
        modelVisible: false,
      },
    ],
  };
}
