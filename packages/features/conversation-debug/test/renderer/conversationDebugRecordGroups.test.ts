import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { RuntimeDebugTraceEvent } from '../../src/contracts/index.js';
import { describe, expect, it } from 'vitest';
import {
  groupConversationDebugRecords,
  isConversationDebugRecordGroup,
} from '../../src/renderer/conversationDebugRecordGroups.js';

describe('conversation debug record groups', () => {
  it('collapses consecutive deltas for one stream without crossing lifecycle boundaries', () => {
    const records = [
      messageDelta(1, 'message_1'),
      messageDelta(2, 'message_1'),
      turnCompleted(3),
      messageDelta(4, 'message_1'),
      messageDelta(5, 'message_2'),
    ];

    const grouped = groupConversationDebugRecords(records);

    expect(grouped).toHaveLength(4);
    expect(isConversationDebugRecordGroup(grouped[0]!)).toBe(true);
    expect(isConversationDebugRecordGroup(grouped[0]!) && grouped[0].records.map((record) => record.id))
      .toEqual(['event_1', 'event_2']);
    expect(grouped.slice(1).map((item) => item.id)).toEqual(['event_3', 'event_4', 'event_5']);
  });

  it('collapses replay details across model requests in the same turn', () => {
    const grouped = groupConversationDebugRecords([
      replayTrace(1, 'span_1'),
      replayTrace(2, 'span_2'),
    ]);

    expect(grouped).toHaveLength(1);
    expect(isConversationDebugRecordGroup(grouped[0]!)).toBe(true);
    expect(isConversationDebugRecordGroup(grouped[0]!) && grouped[0].records).toHaveLength(2);
  });
});

function messageDelta(seq: number, messageId: string): RuntimeEvent {
  return {
    createdAt: `2026-08-25T00:00:0${seq}.000Z`,
    id: `event_${seq}`,
    payload: { messageId, text: 'x' },
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'message.delta',
  };
}

function turnCompleted(seq: number): RuntimeEvent {
  return {
    createdAt: `2026-08-25T00:00:0${seq}.000Z`,
    id: `event_${seq}`,
    payload: {},
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type: 'turn.completed',
  };
}

function replayTrace(seq: number, spanId: string): RuntimeDebugTraceEvent {
  return {
    afterEventSeq: 10,
    createdAt: `2026-08-25T00:00:0${seq}.000Z`,
    id: `trace_${seq}`,
    kind: 'provider.replay.decision',
    payload: {
      messageId: `message_${seq}`,
      model: 'model',
      nativeItemCount: 0,
      providerId: 'provider',
      providerKind: 'openai-responses',
      reason: 'metadata_missing',
      strategy: 'semantic',
    },
    seq,
    spanId,
    threadId: 'thread_1',
    turnId: 'turn_1',
  };
}
