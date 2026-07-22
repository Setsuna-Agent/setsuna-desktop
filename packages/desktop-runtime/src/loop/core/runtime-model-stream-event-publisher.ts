import type {
  ModelStreamEvent,
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeModelRequestStepSnapshot,
  RuntimeToolCall,
  RuntimeToolCallDelta,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { MemoryStore } from '../../ports/memory-store.js';
import type { ThreadStore } from '../../ports/thread-store.js';
import { mergeToolArgumentDelta } from './agent-loop-tool-utils.js';
import type { LegacyModelStreamMirrorState } from './model-stream-output.js';

type RuntimeToolCallDeltaLike = Pick<RuntimeToolCallDelta, 'id' | 'name' | 'argumentsDelta'>;

type RuntimeModelStreamEventPublisherOptions = {
  clock: Clock;
  ids: IdGenerator;
  memoryStore?: MemoryStore;
  appendEvent(threadId: string, event: Parameters<ThreadStore['appendEvent']>[1]): Promise<void>;
};

/** 写入模型采样期间产生的对话记录与条目流投影。 */
export class RuntimeModelStreamEventPublisher {
  constructor(private readonly options: RuntimeModelStreamEventPublisherOptions) {}

  async publishMessage(threadId: string, turnId: string, message: RuntimeMessage): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'message.created',
      createdAt: message.createdAt,
      payload: { message },
    });
  }

  /**
   * 发布 assistant 流式文本增量。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 增量所属 turn ID。
   * @param messageId 要追加文本的 assistant 消息 ID。
   * @param text 本次追加的文本片段。
   */
  async publishAssistantDelta(threadId: string, turnId: string, messageId: string, text: string): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'message.delta',
      createdAt: this.options.clock.now().toISOString(),
      payload: { messageId, text },
    });
  }

  async publishSamplingStepSnapshot(threadId: string, turnId: string, snapshot: RuntimeModelRequestStepSnapshot): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'turn.step_snapshot',
      createdAt: this.options.clock.now().toISOString(),
      payload: { snapshot },
    });
  }

  /**
   * 桥接更接近基于条目的流式事件。
   * 旧 provider 仍走 message/tool 事件；新 provider 可以逐步双写 item lifecycle。
   */
  async publishModelStreamProtocolEvent(threadId: string, turnId: string, item: ModelStreamEvent): Promise<boolean> {
    if (item.type === 'item_started') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.started',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: item.item },
      });
      return true;
    }
    if (item.type === 'item_delta') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.delta',
        createdAt: this.options.clock.now().toISOString(),
        payload: { itemId: item.itemId, delta: item.delta },
      });
      return true;
    }
    if (item.type === 'item_completed') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: item.item, content: item.item.content },
      });
      return true;
    }
    if (item.type === 'plan_delta') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'plan.delta',
        createdAt: this.options.clock.now().toISOString(),
        payload: { itemId: item.itemId ?? `${turnId}:plan`, delta: item.text },
      });
      return true;
    }
    if (item.type === 'reasoning_summary_delta') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'reasoning.summary_delta',
        createdAt: this.options.clock.now().toISOString(),
        payload: { itemId: item.itemId ?? `${turnId}:reasoning`, delta: item.text, summaryIndex: item.summaryIndex },
      });
      return true;
    }
    if (item.type === 'reasoning_summary_part_added') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'reasoning.summary_part_added',
        createdAt: this.options.clock.now().toISOString(),
        payload: { itemId: item.itemId ?? `${turnId}:reasoning`, summaryIndex: item.summaryIndex },
      });
      return true;
    }
    if (item.type === 'reasoning_raw_delta') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'reasoning.raw_delta',
        createdAt: this.options.clock.now().toISOString(),
        payload: { itemId: item.itemId ?? `${turnId}:reasoning`, delta: item.text, contentIndex: item.contentIndex },
      });
      return true;
    }
    if (item.type === 'safety_buffering') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'safety.buffering',
        createdAt: this.options.clock.now().toISOString(),
        payload: { buffering: item.buffering },
      });
      return true;
    }
    if (item.type === 'model_verification') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'model.verification',
        createdAt: this.options.clock.now().toISOString(),
        payload: { verification: item.verification },
      });
      return true;
    }
    if (item.type === 'token_count') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'token.count',
        createdAt: this.options.clock.now().toISOString(),
        payload: {
          usage: item.usage,
          modelContextWindow: item.modelContextWindow,
          tokensUntilCompaction: item.tokensUntilCompaction,
        },
      });
      return true;
    }
    if (item.type === 'turn_diff') {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'turn.diff',
        createdAt: this.options.clock.now().toISOString(),
        payload: { unifiedDiff: item.unifiedDiff },
      });
      return true;
    }
    return false;
  }

  async mirrorLegacyAgentDelta(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, messageId: string, delta: string): Promise<void> {
    if (!delta) return;
    if (!state.agentItemStarted) {
      state.agentItemStarted = true;
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.started',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: { id: messageId, kind: 'agent_message', status: 'in_progress', transcriptMessageId: messageId } },
      });
    }
    state.agentText += delta;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'item.delta',
      createdAt: this.options.clock.now().toISOString(),
      payload: { itemId: messageId, delta },
    });
  }

  async mirrorLegacyReasoningDelta(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, messageId: string, delta: string): Promise<void> {
    if (!delta) return;
    const itemId = `${messageId}:reasoning`;
    if (!state.reasoningItemStarted) {
      state.reasoningItemStarted = true;
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.started',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: { id: itemId, kind: 'reasoning', status: 'in_progress', transcriptMessageId: messageId } },
      });
    }
    state.reasoningText += delta;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'reasoning.raw_delta',
      createdAt: this.options.clock.now().toISOString(),
      payload: { itemId, delta, contentIndex: 0 },
    });
  }

  async mirrorLegacyToolCallDelta(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, call: RuntimeToolCallDeltaLike): Promise<void> {
    const id = call.id || `tool_call_${state.toolCalls.size}`;
    const current = state.toolCalls.get(id) ?? { id, name: '', arguments: '' };
    const next = {
      id,
      name: call.name || current.name,
      arguments: mergeToolArgumentDelta(current.arguments, call.argumentsDelta),
    };
    state.toolCalls.set(id, next);
    if (!next.name || current.name) return;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'item.started',
      createdAt: this.options.clock.now().toISOString(),
      payload: { item: { id, kind: 'tool_call', status: 'in_progress', toolCall: next } },
    });
  }

  async mirrorLegacyToolCallsCompleted(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, toolCalls: RuntimeToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      if (!toolCall.id || state.completedToolCallIds.has(toolCall.id)) continue;
      state.completedToolCallIds.add(toolCall.id);
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: { id: toolCall.id, kind: 'tool_call', status: 'completed', toolCall } },
      });
    }
  }

  async mirrorLegacyUsage(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, usage: RuntimeUsage): Promise<void> {
    if (state.tokenCountPublished) return;
    state.tokenCountPublished = true;
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'token.count',
      createdAt: this.options.clock.now().toISOString(),
      payload: { usage },
    });
  }

  async completeLegacyStreamItems(state: LegacyModelStreamMirrorState, threadId: string, turnId: string, messageId: string): Promise<void> {
    if (state.reasoningItemStarted) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: { id: `${messageId}:reasoning`, kind: 'reasoning', content: state.reasoningText, status: 'completed', transcriptMessageId: messageId } },
      });
    }
    if (state.agentItemStarted) {
      await this.options.appendEvent(threadId, {
        id: this.options.ids.id('event'),
        threadId,
        turnId,
        type: 'item.completed',
        createdAt: this.options.clock.now().toISOString(),
        payload: { item: { id: messageId, kind: 'agent_message', content: state.agentText, status: 'completed', transcriptMessageId: messageId } },
      });
    }
  }

  /**
   * 标记消息完成，并可附带 usage 或最终 toolCalls。
   *
   * @param threadId 目标线程 ID。
   * @param turnId 消息所属 turn ID。
   * @param messageId 要完成的消息 ID。
   * @param payload 可选的 usage 和 toolCalls 补充数据。
   */
  async completeMessage(threadId: string, turnId: string, messageId: string, payload: { content?: string; usage?: RuntimeUsage; toolCalls?: RuntimeToolCall[]; memoryCitation?: RuntimeMemoryCitation; planMode?: RuntimeMessage['planMode']; providerMetadata?: RuntimeMessage['providerMetadata'] } = {}): Promise<void> {
    await this.options.appendEvent(threadId, {
      id: this.options.ids.id('event'),
      threadId,
      turnId,
      type: 'message.completed',
      createdAt: this.options.clock.now().toISOString(),
      payload: { messageId, ...payload },
    });
    if (payload.memoryCitation) {
      await this.options.memoryStore?.recordMemoryCitationUsage(payload.memoryCitation).catch(() => undefined);
    }
  }
}
