import type {
  RuntimeDebugTraceEvent,
  RuntimeEvent,
  RuntimeThread,
} from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  createConversationDebugVisibility,
  filterConversationDebugEvents,
  filterConversationDebugTraces,
} from '../../../../src/features/conversation-debug/conversationDebugVisibility.js';

describe('conversation debug visibility', () => {
  it('keeps only records represented by the current thread projection', () => {
    const visibility = createConversationDebugVisibility(currentThread());
    const events = filterConversationDebugEvents(runtimeEvents(), visibility);
    const traces = filterConversationDebugTraces(runtimeTraces(), visibility);

    expect(events.map((event) => event.id)).toEqual([
      'keep_turn_started',
      'keep_user_created',
      'keep_assistant_created',
      'keep_turn_completed',
    ]);
    expect(traces.map((trace) => trace.id)).toEqual([
      'keep_history_trace',
      'keep_replay_trace',
    ]);
  });

  it('keeps only the latest execution when a visible user message was regenerated', () => {
    const thread: RuntimeThread = {
      ...currentThread(),
      lastSeq: 10,
      messages: [
        visibleMessage('user_1', 'turn_original', 'user', 'First question'),
        visibleMessage('assistant_1', 'turn_regenerated', 'assistant', 'Current answer'),
        visibleMessage('user_2', 'turn_second', 'user', 'Second question'),
        visibleMessage('assistant_2', 'turn_second', 'assistant', 'Second answer'),
      ],
      turns: [
        { id: 'turn_original', input: 'First question', items: [], status: 'completed' },
        { id: 'turn_regenerated', input: 'First question', items: [], status: 'completed' },
        { id: 'turn_second', input: 'Second question', items: [], status: 'completed' },
      ],
    };
    const visibility = createConversationDebugVisibility(thread);
    const events = filterConversationDebugEvents([
      event('original_started', 1, 'turn_original', 'turn.started', {
        input: 'First question',
      }),
      event('first_user', 2, 'turn_original', 'message.created', {
        message: thread.messages[0],
      }),
      event('edited_first_user', 3, '', 'message.updated', {
        messageId: 'user_1',
        content: 'First question',
      }),
      event('replaced_reasoning', 4, 'turn_original', 'reasoning.raw_delta', {
        itemId: 'replaced_item',
        delta: 'obsolete',
      }),
      event('original_completed', 5, 'turn_original', 'turn.completed', {}),
      event('regenerated_started', 6, 'turn_regenerated', 'turn.started', {
        input: 'First question',
      }),
      event('current_answer', 7, 'turn_regenerated', 'message.created', {
        message: thread.messages[1],
      }),
      event('regenerated_completed', 8, 'turn_regenerated', 'turn.completed', {}),
      event('second_started', 9, 'turn_second', 'turn.started', {
        input: 'Second question',
      }),
      event('second_user', 10, 'turn_second', 'message.created', {
        message: thread.messages[2],
      }),
    ], visibility);

    expect([...visibility.turnGroupIds]).toEqual([
      ['turn_original', 'turn_regenerated'],
      ['turn_regenerated', 'turn_regenerated'],
      ['turn_second', 'turn_second'],
    ]);
    expect([...visibility.supersededTurnIds]).toEqual(['turn_original']);
    expect(events.map((item) => item.id)).toEqual([
      'regenerated_started',
      'current_answer',
      'regenerated_completed',
      'second_started',
      'second_user',
    ]);
  });
});

function visibleMessage(
  id: string,
  turnId: string,
  role: 'assistant' | 'user',
  content: string,
): RuntimeThread['messages'][number] {
  return {
    id,
    turnId,
    role,
    content,
    createdAt: '2026-07-23T00:00:00.000Z',
    status: 'complete',
  };
}

function currentThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'Visible conversation',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:12.000Z',
    archived: false,
    messageCount: 2,
    lastMessagePreview: 'Visible answer',
    lastSeq: 12,
    messages: [
      {
        id: 'message_user_keep',
        turnId: 'turn_keep',
        role: 'user',
        content: 'Visible question',
        createdAt: '2026-07-23T00:00:01.000Z',
      },
      {
        id: 'message_assistant_keep',
        turnId: 'turn_keep',
        role: 'assistant',
        content: 'Visible answer',
        createdAt: '2026-07-23T00:00:02.000Z',
        status: 'complete',
      },
    ],
    turns: [{
      id: 'turn_keep',
      input: 'Visible question',
      items: [],
      status: 'completed',
    }],
  };
}

function runtimeEvents(): RuntimeEvent[] {
  return [
    event('keep_turn_started', 1, 'turn_keep', 'turn.started', {
      input: 'Visible question',
    }),
    event('keep_user_created', 2, 'turn_keep', 'message.created', {
      message: {
        id: 'message_user_keep',
        turnId: 'turn_keep',
        role: 'user',
        content: 'Visible question',
        createdAt: '2026-07-23T00:00:01.000Z',
      },
    }),
    event('removed_message_created', 3, 'turn_keep', 'message.created', {
      message: {
        id: 'message_assistant_removed',
        turnId: 'turn_keep',
        role: 'assistant',
        content: 'Deleted answer',
        createdAt: '2026-07-23T00:00:02.000Z',
      },
    }),
    event('removed_item_started', 4, 'turn_keep', 'item.started', {
      item: {
        id: 'item_removed',
        kind: 'tool_call',
        status: 'in_progress',
        transcriptMessageId: 'message_assistant_removed',
        toolCall: { id: 'tool_removed', name: 'read_file', arguments: '{}' },
      },
    }),
    event('removed_tool_started', 5, 'turn_keep', 'tool.started', {
      argumentsPreview: '{}',
      toolCallId: 'tool_removed',
      toolName: 'read_file',
    }),
    event('keep_assistant_created', 6, 'turn_keep', 'message.created', {
      message: {
        id: 'message_assistant_keep',
        turnId: 'turn_keep',
        role: 'assistant',
        content: 'Visible answer',
        createdAt: '2026-07-23T00:00:06.000Z',
      },
    }),
    event('keep_turn_completed', 7, 'turn_keep', 'turn.completed', {}),
    event('removed_turn_started', 8, 'turn_removed', 'turn.started', {
      input: 'Truncated question',
    }),
    event('removed_turn_message', 9, 'turn_removed', 'message.created', {
      message: {
        id: 'message_removed_turn',
        turnId: 'turn_removed',
        role: 'user',
        content: 'Truncated question',
        createdAt: '2026-07-23T00:00:09.000Z',
      },
    }),
    {
      id: 'truncate_mutation',
      seq: 10,
      threadId: 'thread_1',
      type: 'messages.truncated',
      createdAt: '2026-07-23T00:00:10.000Z',
      payload: {
        messageId: 'message_user_keep',
        removedMessageIds: ['message_assistant_removed', 'message_removed_turn'],
      },
    },
  ];
}

function runtimeTraces(): RuntimeDebugTraceEvent[] {
  return [
    {
      afterEventSeq: 3,
      id: 'keep_history_trace',
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_keep',
      kind: 'model.history.normalized',
      createdAt: '2026-07-23T00:00:03.000Z',
      payload: {
        inputMessageCount: 2,
        interruptedToolResultMessageIds: [],
        orphanToolResultMessageIds: [],
        outputMessageCount: 2,
        warnings: [],
        wireToolCallRewrites: [],
      },
    },
    replayTrace('keep_replay_trace', 2, 'turn_keep', 'message_assistant_keep'),
    replayTrace('removed_replay_trace', 3, 'turn_keep', 'message_assistant_removed'),
    {
      afterEventSeq: 10,
      id: 'removed_turn_trace',
      seq: 4,
      threadId: 'thread_1',
      turnId: 'turn_removed',
      kind: 'model.history.normalized',
      createdAt: '2026-07-23T00:00:11.000Z',
      payload: {
        inputMessageCount: 2,
        interruptedToolResultMessageIds: [],
        orphanToolResultMessageIds: [],
        outputMessageCount: 2,
        warnings: [],
        wireToolCallRewrites: [],
      },
    },
  ];
}

function replayTrace(
  id: string,
  seq: number,
  turnId: string,
  messageId: string,
): RuntimeDebugTraceEvent {
  return {
    afterEventSeq: seq,
    id,
    seq,
    threadId: 'thread_1',
    turnId,
    kind: 'provider.replay.decision',
    createdAt: `2026-07-23T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload: {
      messageId,
      model: 'test-model',
      nativeItemCount: 0,
      providerId: 'openai',
      providerKind: 'openai-responses',
      reason: 'metadata_missing',
      strategy: 'semantic',
    },
  };
}

function event<TType extends RuntimeEvent['type']>(
  id: string,
  seq: number,
  turnId: string,
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
): Extract<RuntimeEvent, { type: TType }> {
  return {
    id,
    seq,
    threadId: 'thread_1',
    turnId,
    type,
    createdAt: `2026-07-23T00:00:${String(seq).padStart(2, '0')}.000Z`,
    payload,
  } as Extract<RuntimeEvent, { type: TType }>;
}
