import { describe, expect, it } from 'vitest';
import type { RuntimeEvent } from '../src/events.js';
import { applyRuntimeEventToThread } from '../src/thread-events.js';
import type { RuntimeThread } from '../src/threads.js';

describe('thread event queued-input projection', () => {
  it('keeps pending inputs outside the transcript and consumes them with message creation', () => {
    const thread: RuntimeThread = {
      id: 'thread_queue',
      title: 'Queue projection',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z',
      archived: false,
      messageCount: 0,
      lastMessagePreview: '',
      lastSeq: 0,
      messages: [],
    };
    const queued = [
      {
        id: 'event_queue_1',
        seq: 1,
        threadId: thread.id,
        type: 'turn.input_queued',
        createdAt: '2026-07-27T00:00:01.000Z',
        payload: {
          input: {
            id: 'queued_1',
            clientId: 'client_queued_1',
            input: 'Original first input',
            skillIds: ['skill_1'],
            createdAt: '2026-07-27T00:00:01.000Z',
          },
        },
      },
      {
        id: 'event_queue_2',
        seq: 2,
        threadId: thread.id,
        type: 'turn.input_queued',
        createdAt: '2026-07-27T00:00:02.000Z',
        payload: {
          input: {
            id: 'queued_2',
            input: 'Second input',
            createdAt: '2026-07-27T00:00:02.000Z',
          },
        },
      },
    ] satisfies RuntimeEvent[];

    const pending = queued.reduce(applyRuntimeEventToThread, thread);
    expect(pending.messages).toEqual([]);
    expect(pending.queuedTurnInputs?.map((input) => input.input)).toEqual([
      'Original first input',
      'Second input',
    ]);

    const edited = applyRuntimeEventToThread(pending, {
      id: 'event_update_1',
      seq: 3,
      threadId: thread.id,
      type: 'turn.input_updated',
      createdAt: '2026-07-27T00:00:03.000Z',
      payload: {
        input: {
          id: 'queued_1',
          clientId: 'client_queued_1',
          input: 'Edited first input',
          attachments: [{
            id: 'attachment_1',
            name: 'edited.pdf',
            type: 'application/pdf',
            size: 128,
            source: 'runtime',
            assetId: 'asset_1',
          }],
          skillIds: ['skill_1'],
          createdAt: '2026-07-27T00:00:01.000Z',
          updatedAt: '2026-07-27T00:00:03.000Z',
        },
      },
    });
    expect(edited.queuedTurnInputs?.[0]).toMatchObject({
      input: 'Edited first input',
      attachments: [expect.objectContaining({ id: 'attachment_1' })],
      skillIds: ['skill_1'],
      updatedAt: '2026-07-27T00:00:03.000Z',
    });

    const consumed = applyRuntimeEventToThread(edited, {
      id: 'event_message_1',
      seq: 4,
      threadId: thread.id,
      turnId: 'turn_2',
      type: 'message.created',
      createdAt: '2026-07-27T00:00:04.000Z',
      payload: {
        queuedInputId: 'queued_1',
        message: {
          id: 'message_1',
          clientId: 'client_queued_1',
          turnId: 'turn_2',
          role: 'user',
          content: 'Edited first input',
          createdAt: '2026-07-27T00:00:04.000Z',
          status: 'complete',
        },
      },
    });
    expect(consumed.queuedTurnInputs?.map((input) => input.id)).toEqual(['queued_2']);
    expect(consumed.messages).toMatchObject([{
      clientId: 'client_queued_1',
      content: 'Edited first input',
      turnId: 'turn_2',
    }]);

    const deleted = applyRuntimeEventToThread(consumed, {
      id: 'event_delete_2',
      seq: 5,
      threadId: thread.id,
      type: 'turn.input_deleted',
      createdAt: '2026-07-27T00:00:05.000Z',
      payload: { inputId: 'queued_2' },
    });
    expect(deleted.queuedTurnInputs).toEqual([]);
  });
});
