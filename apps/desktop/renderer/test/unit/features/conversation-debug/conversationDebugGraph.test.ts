import type { RuntimeDebugTraceEvent, RuntimeEvent } from '@setsuna-desktop/contracts';
import { describe, expect, it } from 'vitest';
import {
  filterConversationDebugGraphByTurn,
  projectConversationDebugGraph,
} from '../../../../src/features/conversation-debug/conversationDebugGraph.js';
import { mergeConversationDebugTraces } from '../../../../src/features/conversation-debug/conversationDebugTraces.js';

describe('conversation debug graph', () => {
  it('folds streaming records into semantic nodes without losing raw events', () => {
    const graph = projectConversationDebugGraph(runtimeEvents());

    expect(graph.events).toHaveLength(9);
    expect(graph.eventNodeIds.size).toBe(9);
    expect(graph.events.every((event) => graph.eventNodeIds.has(event.id))).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'message:assistant_1')).toMatchObject({
      eventIds: ['event_message_created', 'event_message_delta'],
      lane: 'provider',
      status: 'running',
      summary: 'Hello',
    });
    expect(graph.edges).toContainEqual({
      from: 'item:turn_1:assistant_1:item_call_1',
      id: 'causal:item:turn_1:assistant_1:item_call_1->tool:turn_1:assistant_1:call_1',
      kind: 'causal',
      to: 'tool:turn_1:assistant_1:call_1',
    });
    expect(graph.turns.map((turn) => turn.id)).toEqual(['turn_1', 'turn_2']);
  });

  it('merges independently sequenced debug traces and filters them by turn', () => {
    const eventGraph = projectConversationDebugGraph(runtimeEvents());
    const graph = mergeConversationDebugTraces(eventGraph, [historyTrace()]);
    const firstTurn = graph.turns.find((turn) => turn.id === 'turn_1');

    expect(graph.traces).toHaveLength(1);
    expect(graph.records).toHaveLength(10);
    expect(graph.traceNodeIds.get('debug_trace_1')).toBe('trace:debug_trace_1');
    expect(graph.nodes.find((node) => node.id === 'trace:debug_trace_1')).toMatchObject({
      kind: 'history-normalization',
      lane: 'runtime',
      source: 'trace',
      status: 'warning',
    });
    // Debug traces have their own sequence counter and must not widen the RuntimeEvent range.
    expect(firstTurn).toMatchObject({ seqStart: 1, seqEnd: 7 });

    const filtered = filterConversationDebugGraphByTurn(graph, 'turn_1');
    expect(filtered.traces.map((trace) => trace.id)).toEqual(['debug_trace_1']);
    expect(filtered.events.every((event) => event.turnId === 'turn_1')).toBe(true);
    expect(filtered.turns).toHaveLength(1);
  });

  it('keeps reused provider tool IDs isolated by model transaction', () => {
    const graph = projectConversationDebugGraph(reusedToolCallEvents());
    const toolNodes = graph.nodes.filter((node) => node.kind === 'tool');
    const itemNodes = graph.nodes.filter((node) => node.kind === 'stream-item');

    expect(toolNodes).toHaveLength(2);
    expect(itemNodes).toHaveLength(2);
    expect(new Set(toolNodes.map((node) => node.id)).size).toBe(2);
    expect(toolNodes.map((node) => ({
      eventIds: node.eventIds,
      turnId: node.turnId,
    }))).toEqual([
      {
        eventIds: ['turn_1_tool_started', 'turn_1_tool_completed'],
        turnId: 'turn_1',
      },
      {
        eventIds: ['turn_2_tool_started', 'turn_2_tool_completed'],
        turnId: 'turn_2',
      },
    ]);

    const secondTurn = filterConversationDebugGraphByTurn(graph, 'turn_2');
    expect(secondTurn.nodes.filter((node) => node.kind === 'tool')).toMatchObject([
      {
        eventIds: ['turn_2_tool_started', 'turn_2_tool_completed'],
        turnId: 'turn_2',
      },
    ]);
  });

  it('maps failed items and rejected approvals to non-success states', () => {
    const graph = projectConversationDebugGraph([
      debugEvent(1, 'turn_1', 'turn.started', { input: 'Run' }),
      debugEvent(2, 'turn_1', 'item.completed', {
        item: {
          id: 'failed_item',
          kind: 'agent_message',
          status: 'failed',
        },
      }),
      debugEvent(3, 'turn_1', 'approval.resolved', {
        approvalId: 'approval_1',
        decision: 'reject',
      }),
    ]);

    expect(graph.nodes.find((node) => node.eventIds.includes('event_2'))?.status).toBe('error');
    expect(graph.nodes.find((node) => node.eventIds.includes('event_3'))?.status).toBe('cancelled');
  });

  it('orders traces by their formal event anchor instead of comparing E/D sequences', () => {
    const createdAt = '2026-07-23T00:00:00.000Z';
    const eventGraph = projectConversationDebugGraph([
      debugEvent(1, 'turn_1', 'turn.started', { input: 'Run' }, createdAt),
      debugEvent(2, 'turn_1', 'turn.completed', {}, createdAt),
    ]);
    const trace = {
      ...historyTrace(),
      afterEventSeq: 1,
      createdAt,
      seq: 999,
    };
    const graph = mergeConversationDebugTraces(eventGraph, [trace]);

    expect(graph.records.map((record) => record.id)).toEqual([
      'event_1',
      'debug_trace_1',
      'event_2',
    ]);
    expect(graph.nodes.map((node) => node.id)).toEqual([
      'turn-input:turn_1',
      'trace:debug_trace_1',
      'turn-end:event_2',
    ]);
  });

  it('groups regenerated runtime turns into one visible conversation round', () => {
    const graph = projectConversationDebugGraph(
      [
        debugEvent(1, 'turn_original', 'turn.started', { input: 'First' }),
        debugEvent(2, 'turn_regenerated', 'turn.started', { input: 'First' }),
        debugEvent(3, 'turn_regenerated', 'turn.completed', {}),
        debugEvent(4, 'turn_second', 'turn.started', { input: 'Second' }),
        debugEvent(5, 'turn_second', 'turn.completed', {}),
      ],
      new Map([
        ['turn_original', 'turn_regenerated'],
        ['turn_regenerated', 'turn_regenerated'],
        ['turn_second', 'turn_second'],
      ]),
    );

    expect(graph.turns.map((turn) => ({
      id: turn.id,
      runtimeTurnIds: turn.runtimeTurnIds,
    }))).toEqual([
      {
        id: 'turn_regenerated',
        runtimeTurnIds: ['turn_original', 'turn_regenerated'],
      },
      {
        id: 'turn_second',
        runtimeTurnIds: ['turn_second'],
      },
    ]);
    expect(
      filterConversationDebugGraphByTurn(graph, 'turn_regenerated').events.map(
        (event) => event.id,
      ),
    ).toEqual(['event_1', 'event_2', 'event_3']);
  });
});

function runtimeEvents(): RuntimeEvent[] {
  const base = {
    threadId: 'thread_1',
    turnId: 'turn_1',
  };
  return [
    {
      ...base,
      id: 'event_turn_started',
      seq: 1,
      type: 'turn.started',
      createdAt: '2026-07-23T00:00:01.000Z',
      payload: { input: 'Read the file' },
    },
    {
      ...base,
      id: 'event_message_created',
      seq: 2,
      type: 'message.created',
      createdAt: '2026-07-23T00:00:02.000Z',
      payload: {
        message: {
          id: 'assistant_1',
          turnId: 'turn_1',
          role: 'assistant',
          content: '',
          createdAt: '2026-07-23T00:00:02.000Z',
          status: 'streaming',
        },
      },
    },
    {
      ...base,
      id: 'event_message_delta',
      seq: 3,
      type: 'message.delta',
      createdAt: '2026-07-23T00:00:03.000Z',
      payload: { messageId: 'assistant_1', text: 'Hello' },
    },
    {
      ...base,
      id: 'event_item_started',
      seq: 4,
      type: 'item.started',
      createdAt: '2026-07-23T00:00:04.000Z',
      payload: {
        item: {
          id: 'item_call_1',
          kind: 'tool_call',
          status: 'in_progress',
          toolCall: { id: 'call_1', name: 'workspace_read_file', arguments: '{}' },
        },
      },
    },
    {
      ...base,
      id: 'event_tool_started',
      seq: 5,
      type: 'tool.started',
      createdAt: '2026-07-23T00:00:05.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'workspace_read_file',
        argumentsPreview: '{}',
      },
    },
    {
      ...base,
      id: 'event_tool_completed',
      seq: 6,
      type: 'tool.completed',
      createdAt: '2026-07-23T00:00:06.000Z',
      payload: {
        toolCallId: 'call_1',
        toolName: 'workspace_read_file',
        status: 'success',
        content: 'contents',
      },
    },
    {
      ...base,
      id: 'event_turn_completed',
      seq: 7,
      type: 'turn.completed',
      createdAt: '2026-07-23T00:00:07.000Z',
      payload: {},
    },
    {
      threadId: 'thread_1',
      turnId: 'turn_2',
      id: 'event_turn_2_started',
      seq: 8,
      type: 'turn.started',
      createdAt: '2026-07-23T00:00:08.000Z',
      payload: { input: 'Continue' },
    },
    {
      threadId: 'thread_1',
      turnId: 'turn_2',
      id: 'event_turn_2_completed',
      seq: 9,
      type: 'turn.completed',
      createdAt: '2026-07-23T00:00:09.000Z',
      payload: {},
    },
  ];
}

function historyTrace(): RuntimeDebugTraceEvent {
  return {
    afterEventSeq: 4,
    id: 'debug_trace_1',
    seq: 999,
    threadId: 'thread_1',
    turnId: 'turn_1',
    kind: 'model.history.normalized',
    createdAt: '2026-07-23T00:00:04.500Z',
    payload: {
      inputMessageCount: 4,
      interruptedToolResultMessageIds: [],
      orphanToolResultMessageIds: ['tool_orphan'],
      outputMessageCount: 4,
      warnings: ['legacy_orphan_tool_result_omitted'],
      wireToolCallRewrites: [],
    },
  };
}

function reusedToolCallEvents(): RuntimeEvent[] {
  return [
    debugEvent(1, 'turn_1', 'turn.started', { input: 'First' }),
    debugEvent(2, 'turn_1', 'message.created', {
      message: {
        id: 'assistant_1',
        turnId: 'turn_1',
        role: 'assistant',
        content: '',
        createdAt: '2026-07-23T00:00:02.000Z',
        status: 'streaming',
      },
    }),
    debugEvent(3, 'turn_1', 'item.started', {
      item: {
        id: 'reused_item',
        kind: 'tool_call',
        status: 'in_progress',
        toolCall: { id: 'reused_call', name: 'read', arguments: '{}' },
      },
    }),
    {
      ...debugEvent(4, 'turn_1', 'tool.started', {
        toolCallId: 'reused_call',
        toolName: 'read',
        argumentsPreview: '{}',
      }),
      id: 'turn_1_tool_started',
    },
    {
      ...debugEvent(5, 'turn_1', 'tool.completed', {
        toolCallId: 'reused_call',
        toolName: 'read',
        status: 'success',
        content: 'first',
      }),
      id: 'turn_1_tool_completed',
    },
    debugEvent(6, 'turn_1', 'turn.completed', {}),
    debugEvent(7, 'turn_2', 'turn.started', { input: 'Second' }),
    debugEvent(8, 'turn_2', 'message.created', {
      message: {
        id: 'assistant_2',
        turnId: 'turn_2',
        role: 'assistant',
        content: '',
        createdAt: '2026-07-23T00:00:08.000Z',
        status: 'streaming',
      },
    }),
    debugEvent(9, 'turn_2', 'item.started', {
      item: {
        id: 'reused_item',
        kind: 'tool_call',
        status: 'in_progress',
        toolCall: { id: 'reused_call', name: 'read', arguments: '{}' },
      },
    }),
    {
      ...debugEvent(10, 'turn_2', 'tool.started', {
        toolCallId: 'reused_call',
        toolName: 'read',
        argumentsPreview: '{}',
      }),
      id: 'turn_2_tool_started',
    },
    {
      ...debugEvent(11, 'turn_2', 'tool.completed', {
        toolCallId: 'reused_call',
        toolName: 'read',
        status: 'success',
        content: 'second',
      }),
      id: 'turn_2_tool_completed',
    },
    debugEvent(12, 'turn_2', 'turn.completed', {}),
  ];
}

function debugEvent<TType extends RuntimeEvent['type']>(
  seq: number,
  turnId: string,
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
  createdAt = `2026-07-23T00:00:${String(seq).padStart(2, '0')}.000Z`,
): Extract<RuntimeEvent, { type: TType }> {
  return {
    createdAt,
    id: `event_${seq}`,
    payload,
    seq,
    threadId: 'thread_1',
    turnId,
    type,
  } as Extract<RuntimeEvent, { type: TType }>;
}
