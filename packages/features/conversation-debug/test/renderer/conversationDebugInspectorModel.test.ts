import type { RuntimeEvent } from '@setsuna-desktop/contracts';
import type { RendererTranslate } from '@setsuna-desktop/feature-core/renderer';
import { describe, expect, it } from 'vitest';
import type {
  ConversationDebugNode,
  ConversationDebugNodeKind,
} from '../../src/renderer/conversationDebugGraph.js';
import { createConversationDebugInspectorModel } from '../../src/renderer/conversationDebugInspectorModel.js';

describe('conversation debug inspector model', () => {
  it('surfaces every useful turn field without requiring the raw payload', () => {
    const event: RuntimeEvent = {
      createdAt: '2026-08-25T08:00:00.000Z',
      id: 'event_turn_started',
      payload: {
        input: '检查加载性能',
        modelBinding: {
          modelCode: 'deepseek-v4-flash',
          modelId: 'deepseek-v4-flash',
          providerId: 'local-test',
        },
        taskKind: 'regular',
      },
      seq: 42,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'turn.started',
    };

    const model = createConversationDebugInspectorModel({
      locale: 'zh-CN',
      node: nodeFor([event], 'turn-input'),
      records: [event],
      t: translate,
    });
    const fields = model.sections.flatMap((section) => section.fields);

    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sequence', value: 'E#42' }),
      expect.objectContaining({ path: 'input', value: '检查加载性能' }),
      expect.objectContaining({ path: 'taskKind', value: 'regular' }),
      expect.objectContaining({ path: 'modelBinding.providerId', value: 'local-test' }),
      expect.objectContaining({ path: 'modelBinding.modelId', value: 'deepseek-v4-flash' }),
      expect.objectContaining({ path: 'modelBinding.modelCode', value: 'deepseek-v4-flash' }),
    ]));
  });

  it('promotes runtime failures and redacts secrets in diagnostic text', () => {
    const event: RuntimeEvent = {
      createdAt: '2026-08-25T08:00:01.000Z',
      id: 'event_runtime_error',
      payload: {
        code: 'MODEL_STREAM_FAILED',
        message: 'request failed with Bearer top-secret-token',
      },
      seq: 43,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'runtime.error',
    };

    const model = createConversationDebugInspectorModel({
      locale: 'zh-CN',
      node: nodeFor([event], 'error'),
      records: [event],
      t: translate,
    });

    expect(model.notices).toContainEqual(expect.objectContaining({
      code: 'MODEL_STREAM_FAILED',
      message: 'request failed with Bearer [redacted]',
      title: 'Runtime 错误',
      tone: 'error',
    }));
    expect(model.sections.flatMap((section) => section.fields)).toContainEqual(
      expect.objectContaining({
        path: 'message',
        value: 'request failed with Bearer [redacted]',
      }),
    );
  });

  it('marks nested structured values for JSON highlighting', () => {
    const event: RuntimeEvent = {
      createdAt: '2026-08-25T08:00:01.000Z',
      id: 'event_message_completed',
      payload: {
        messageId: 'assistant_1',
        providerMetadata: {
          anthropic: {
            contentBlocks: [{
              thinking: '检查项目结构',
              type: 'thinking',
            }],
          },
        },
      },
      seq: 43,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
    };

    const model = createConversationDebugInspectorModel({
      locale: 'zh-CN',
      node: nodeFor([event], 'message'),
      records: [event],
      t: translate,
    });

    expect(model.sections.flatMap((section) => section.fields)).toContainEqual(
      expect.objectContaining({
        language: 'json',
        path: 'providerMetadata.anthropic.contentBlocks',
        wide: true,
      }),
    );
  });

  it('replaces the bounded event preview with the complete tool arguments', () => {
    const fullArguments = JSON.stringify({
      cmd: `vitest ${'packages/features/conversation-debug/'.repeat(80)}`,
    });
    const completedMessage: RuntimeEvent = {
      createdAt: '2026-08-25T08:00:00.000Z',
      id: 'event_message_completed',
      payload: {
        messageId: 'assistant_1',
        toolCalls: [{
          arguments: fullArguments,
          id: 'call_1',
          name: 'exec_command',
        }],
      },
      seq: 1,
      threadId: 'thread_1',
      turnId: 'turn_1',
      type: 'message.completed',
    };
    const event = toolEvent(2, 'tool.started', {
      argumentsPreview: fullArguments.slice(0, 1_200),
      toolCallId: 'call_1',
      toolName: 'exec_command',
    });
    const laterArguments = JSON.stringify({ cmd: 'pnpm lint' });
    const laterCompletedMessage: RuntimeEvent = {
      ...completedMessage,
      createdAt: '2026-08-25T08:00:02.000Z',
      id: 'event_later_message_completed',
      payload: {
        messageId: 'assistant_2',
        toolCalls: [{
          arguments: laterArguments,
          id: 'call_1',
          name: 'exec_command',
        }],
      },
      seq: 3,
    };
    const node = {
      ...nodeFor([event], 'tool'),
      relatedToolInstanceId: 'turn_1:assistant_1:call_1',
    };

    const model = createConversationDebugInspectorModel({
      contextRecords: [completedMessage, event, laterCompletedMessage],
      locale: 'zh-CN',
      node,
      records: [event],
      t: translate,
    });

    expect(model.sections.flatMap((section) => section.fields)).toContainEqual(
      expect.objectContaining({
        language: 'json',
        path: 'fullArguments',
        value: fullArguments,
      }),
    );
    expect(model.sections.flatMap((section) => section.fields)).not.toContainEqual(
      expect.objectContaining({ value: laterArguments }),
    );
    expect(model.sections.flatMap((section) => section.fields)).not.toContainEqual(
      expect.objectContaining({ path: 'argumentsPreview' }),
    );
  });

  it('compresses streaming deltas while retaining a bounded stderr preview', () => {
    const events: RuntimeEvent[] = [
      toolEvent(1, 'tool.started', {
        argumentsPreview: '{"path":"README.md"}',
        toolCallId: 'call_1',
        toolName: 'workspace_read_file',
      }),
      toolEvent(2, 'tool.output_delta', {
        delta: 'first failure\n',
        stream: 'stderr',
        toolCallId: 'call_1',
        toolName: 'workspace_read_file',
      }),
      toolEvent(3, 'tool.output_delta', {
        delta: 'second failure',
        stream: 'stderr',
        toolCallId: 'call_1',
        toolName: 'workspace_read_file',
      }),
    ];
    const model = createConversationDebugInspectorModel({
      locale: 'zh-CN',
      node: nodeFor(events, 'tool'),
      records: events,
      t: translate,
    });
    const fields = model.sections.flatMap((section) => section.fields);

    expect(fields).toContainEqual(expect.objectContaining({
      path: 'tool.output_delta.stderr',
      value: '2 条增量 · 28 个字符',
    }));
    expect(fields).toContainEqual(expect.objectContaining({
      path: 'tool.output_delta.stderr.preview',
      value: 'first failure\nsecond failure',
    }));
  });
});

const translate: RendererTranslate = (key, params) => {
  const messages: Partial<Record<string, string>> = {
    'feature.conversationDebug.inspector.notice.runtimeError': 'Runtime 错误',
    'feature.conversationDebug.inspector.recordBreakdown': '正式事件 {events} · 内部轨迹 {traces}',
    'feature.conversationDebug.inspector.streamingSummary': '{count} 条增量 · {characters} 个字符',
  };
  return (messages[key] ?? key).replace(/\{([^}]+)\}/gu, (_match, name: string) => (
    String(params?.[name] ?? '')
  ));
};

function nodeFor(
  events: RuntimeEvent[],
  kind: ConversationDebugNodeKind,
): ConversationDebugNode {
  return {
    eventIds: events.map((event) => event.id),
    events,
    eventTypes: [...new Set(events.map((event) => event.type))],
    id: `${kind}:node_1`,
    kind,
    lane: kind === 'tool' ? 'tool' : 'runtime',
    relatedToolCallId: kind === 'tool' ? 'call_1' : undefined,
    seqEnd: events.at(-1)!.seq,
    seqStart: events[0]!.seq,
    source: 'event',
    startedAt: events[0]!.createdAt,
    status: kind === 'error' ? 'error' : 'running',
    summary: '',
    traceIds: [],
    traces: [],
    turnId: 'turn_1',
  };
}

function toolEvent<TType extends Extract<
  RuntimeEvent['type'],
  'tool.started' | 'tool.output_delta'
>>(
  seq: number,
  type: TType,
  payload: Extract<RuntimeEvent, { type: TType }>['payload'],
): Extract<RuntimeEvent, { type: TType }> {
  return {
    createdAt: `2026-08-25T08:00:0${seq}.000Z`,
    id: `event_${seq}`,
    payload,
    seq,
    threadId: 'thread_1',
    turnId: 'turn_1',
    type,
  } as Extract<RuntimeEvent, { type: TType }>;
}
