import type { RuntimeDebugTraceEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import { mergeConversationDebugTracePage } from '../../../../src/features/conversation-debug/conversationDebugTraceBuffer.js';

describe('conversation debug trace buffer', () => {
  it('removes records at or below the server retention watermark', () => {
    const tracesBySequence = new Map([
      [1, trace(1)],
      [2, trace(2)],
      [3, trace(3)],
    ]);

    const firstWatermark = mergeConversationDebugTracePage(
      tracesBySequence,
      {
        droppedBeforeSeq: 2,
        nextSeq: 5,
        traces: [trace(2), trace(4)],
      },
    );

    expect(firstWatermark).toBe(2);
    expect([...tracesBySequence.keys()]).toEqual([3, 4]);

    const retainedWatermark = mergeConversationDebugTracePage(
      tracesBySequence,
      {
        nextSeq: 6,
        traces: [trace(5)],
      },
      firstWatermark,
    );
    expect(retainedWatermark).toBe(2);
    expect([...tracesBySequence.keys()]).toEqual([3, 4, 5]);

    const advancedWatermark = mergeConversationDebugTracePage(
      tracesBySequence,
      {
        droppedBeforeSeq: 4,
        nextSeq: 6,
        traces: [],
      },
      retainedWatermark,
    );
    expect(advancedWatermark).toBe(4);
    expect([...tracesBySequence.keys()]).toEqual([5]);
  });
});

function trace(seq: number): RuntimeDebugTraceEvent {
  return {
    afterEventSeq: seq,
    createdAt: '2026-07-23T00:00:00.000Z',
    id: `trace_${seq}`,
    kind: 'model.history.normalized',
    payload: {
      inputMessageCount: 0,
      interruptedToolResultMessageIds: [],
      orphanToolResultMessageIds: [],
      outputMessageCount: 0,
      warnings: [],
      wireToolCallRewrites: [],
    },
    seq,
    threadId: 'thread_1',
  };
}
