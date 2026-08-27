import {
  type ModelRequest,
  type ModelStreamEvent,
  type RuntimeMemoryCitation,
  type RuntimeMessage,
  type RuntimeMessageStreamPart,
  type RuntimeModelRequestStepSnapshot,
  type RuntimeToolCall,
  type RuntimeToolDefinition,
  type RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { MemoryControl } from '@setsuna-desktop/feature-memory/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { RuntimeToolCallExecutor, ToolPreviewAnnouncement } from '../tools/runtime-tool-call-executor.js';
import { TOOL_SEARCH_TOOL_NAME, type RuntimeToolRouter } from '../tools/tool-router.js';
import { bindProviderMetadataToSemanticMessage } from '../../utils/runtime-message-semantic-fingerprint.js';
import { toolCallFromModelStreamItem, toolsForModelRequest, upsertRuntimeToolCall } from './agent-loop-tool-utils.js';
import {
  createAssistantItemStreamBridge,
  createAssistantOutputAccumulator,
  createLegacyModelStreamMirrorState,
} from './model-stream-output.js';
import type { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import {
  mergeRuntimeProviderMetadata,
  retainRuntimeProviderToolCalls,
} from './runtime-provider-metadata.js';

type TurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeSamplingModelContext = {
  messages: RuntimeMessage[];
  modelRequest: Pick<ModelRequest, 'model' | 'providerId'>;
  snapshot: RuntimeModelRequestStepSnapshot;
  toolChoice: ModelRequest['toolChoice'];
  toolRouter: RuntimeToolRouter | null;
  tools?: RuntimeToolDefinition[];
};

export type RuntimeSampledAssistant = {
  assistantMessage: RuntimeMessage;
  assistantMessageId: string;
  memoryCitation?: RuntimeMemoryCitation;
  text: string;
  toolCalls: RuntimeToolCall[];
  usage?: RuntimeUsage;
};

type RuntimeModelSamplerOptions = {
  clock: Clock;
  ids: IdGenerator;
  modelClient: ModelClient;
  memoryControl(): MemoryControl;
  streamEvents: RuntimeModelStreamEventPublisher;
  toolExecutor: RuntimeToolCallExecutor;
};

/** 执行一次模型采样步骤，并统一旧版与基于条目的流式协议。 */
export class RuntimeModelSampler {
  constructor(private readonly options: RuntimeModelSamplerOptions) {}

  async sample({
    captureProtocolUsage,
    onAssistantStarted,
    signal,
    step,
    thinkingOptions,
    threadId,
    turnId,
  }: {
    captureProtocolUsage: boolean;
    onAssistantStarted?(messageId: string): void;
    signal: AbortSignal;
    step: RuntimeSamplingModelContext;
    thinkingOptions: TurnThinkingOptions;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeSampledAssistant> {
    const assistantMessageId = this.options.ids.id('msg');
    const assistantStreamParts: RuntimeMessageStreamPart[] = [];
    const assistantMessage: RuntimeMessage = {
      id: assistantMessageId,
      turnId,
      role: 'assistant',
      content: '',
      createdAt: this.options.clock.now().toISOString(),
      status: 'streaming',
      streamParts: assistantStreamParts,
    };
    onAssistantStarted?.(assistantMessageId);
    // The published event must own an immutable snapshot: assistantStreamParts keeps mutating
    // as deltas stream in, and a queued or replayed subscriber would otherwise observe future
    // parts ahead of their persisted message.delta events.
    await this.options.streamEvents.publishMessage(threadId, turnId, {
      ...assistantMessage,
      streamParts: [...assistantStreamParts],
    });
    this.options.streamEvents.prepareAssistantItem(threadId, turnId, assistantMessageId);

    let toolCalls: RuntimeToolCall[] = [];
    let usage: RuntimeUsage | undefined;
    const partialToolCalls = new Map<string, RuntimeToolCall>();
    const announcedToolPreviews = new Map<string, ToolPreviewAnnouncement>();
    const providerAgentItemIds = new Set<string>();
    const toolSearchFilter = createToolSearchStreamFilter();
    const output = createAssistantOutputAccumulator(async (delta) => {
      appendAssistantStreamPart(assistantStreamParts, 'content', delta);
      await this.options.streamEvents.publishAssistantDelta(threadId, turnId, assistantMessageId, delta);
    }, this.options.memoryControl().createCitationOutputFilter());
    let reasoningReceived = false;
    const streamBridge = createAssistantItemStreamBridge(
      output,
      async (delta) => {
        reasoningReceived = true;
        appendAssistantStreamPart(assistantStreamParts, 'reasoning', delta);
        await this.options.streamEvents.publishAssistantReasoningDelta(
          threadId,
          turnId,
          assistantMessageId,
          delta,
        );
      },
    );
    const mirror = createLegacyModelStreamMirrorState();
    const requestToolChoice = step.toolChoice;
    const requestTools = toolsForModelRequest(step.tools, requestToolChoice);
    const requestSnapshot = step.snapshot;
    const samplingStepEvent = await this.options.streamEvents.publishSamplingStepSnapshot(
      threadId,
      turnId,
      requestSnapshot,
    );
    const modelRequestSnapshot = {
      ...requestSnapshot,
      // A trace may be enabled after context construction. Always pass the committed event
      // as the transient cross-stream anchor so a late trace cannot precede its step snapshot.
      threadLastSeq: samplingStepEvent?.seq ?? requestSnapshot.threadLastSeq,
    };

    for await (const item of this.options.modelClient.stream({
      ...step.modelRequest,
      messages: modelRequestMessages(step.messages),
      tools: requestTools,
      toolChoice: requestToolChoice,
      stepSnapshot: modelRequestSnapshot,
      ...thinkingOptions,
      signal,
    })) {
      throwIfAborted(signal);
      if (item.type === 'assistant_metadata') {
        assistantMessage.providerMetadata = mergeRuntimeProviderMetadata(
          assistantMessage.providerMetadata,
          item.providerMetadata,
        );
        continue;
      }
      if (isProviderAgentMessageEvent(item, providerAgentItemIds)) {
        if (item.type === 'item_delta') {
          await this.options.streamEvents.publishAssistantItemDelta(
            threadId,
            turnId,
            assistantMessageId,
            item.delta,
            item.itemId,
          );
        } else if (item.type === 'item_completed') {
          await this.options.streamEvents.reconcileAssistantItemContent(
            threadId,
            turnId,
            assistantMessageId,
            item.item.id,
            item.item.content,
          );
        }
        // RuntimeMessage owns the canonical transcript item. Provider text items still feed
        // the accumulator, but publishing both would duplicate App Server agentMessage items.
        await streamBridge.consume(item);
        continue;
      }
      for (const filteredItem of filterModelStreamEvents(item, toolSearchFilter)) {
        if (await this.options.streamEvents.publishModelStreamProtocolEvent(threadId, turnId, filteredItem)) {
          if (captureProtocolUsage && filteredItem.type === 'token_count') usage = filteredItem.usage;
          await streamBridge.consume(filteredItem);
          const protocolToolCall = toolCallFromModelStreamItem(filteredItem);
          if (protocolToolCall) toolCalls = upsertRuntimeToolCall(toolCalls, protocolToolCall);
          continue;
        }
        if (filteredItem.type === 'reasoning_delta') {
          await this.options.streamEvents.mirrorLegacyReasoningDelta(mirror, threadId, turnId, assistantMessageId, filteredItem.text);
          await streamBridge.appendReasoning(filteredItem.text);
        }
        if (filteredItem.type === 'text_delta') {
          await this.options.streamEvents.publishAssistantItemDelta(threadId, turnId, assistantMessageId, filteredItem.text);
          await streamBridge.appendAgent(filteredItem.text);
        }
        if (filteredItem.type === 'tool_call_delta') {
          await this.options.streamEvents.mirrorLegacyToolCallDelta(mirror, threadId, turnId, filteredItem.call);
          await this.options.toolExecutor.publishToolCallDeltaPreview({
            announcedToolPreviews,
            call: filteredItem.call,
            partialToolCalls,
            threadId,
            toolRouter: step.toolRouter,
            turnId,
          });
        }
        if (filteredItem.type === 'tool_calls') {
          toolCalls = retainToolCalls(filteredItem.toolCalls, toolSearchFilter);
          await this.options.streamEvents.mirrorLegacyToolCallsCompleted(mirror, threadId, turnId, toolCalls);
        }
        if (filteredItem.type === 'usage') {
          usage = filteredItem.usage;
          await this.options.streamEvents.mirrorLegacyUsage(mirror, threadId, turnId, filteredItem.usage);
        }
      }
    }

    await streamBridge.finish();
    await this.options.streamEvents.completeLegacyStreamItems(mirror, threadId, turnId, assistantMessageId);
    const memoryCitation = await output.finish();
    let text = output.text();
    if (toolSearchFilter.discardedCallIds.size) {
      assistantMessage.providerMetadata = retainRuntimeProviderToolCalls(
        assistantMessage.providerMetadata,
        new Set(toolCalls.map((toolCall) => toolCall.id)),
      );
    }
    if (!text.trim() && !toolCalls.length) {
      // Reasoning travels on its own stream channel, so an empty content channel is an explicit
      // provider-boundary failure instead of a tag-parsing decision.
      throw new Error(reasoningReceived
        ? '模型服务只返回了思考内容，未返回可显示的答复。请检查供应商的 reasoning/content 字段映射或模型协议配置。'
        : '模型服务返回了空响应，请检查 API Base URL、模型 ID 和供应商协议配置。');
    }
    assistantMessage.providerMetadata = bindProviderMetadataToSemanticMessage(
      assistantMessage.providerMetadata,
      { ...assistantMessage, content: text, toolCalls },
    );

    return {
      assistantMessage,
      assistantMessageId,
      memoryCitation,
      text,
      toolCalls,
      usage,
    };
  }
}

type ToolSearchStreamFilter = {
  retainedCallId?: string;
  discardedCallIds: Set<string>;
  discardedItemIds: Set<string>;
  pendingToolCallItems: Map<string, ModelStreamEvent[]>;
};

function createToolSearchStreamFilter(): ToolSearchStreamFilter {
  return {
    discardedCallIds: new Set(),
    discardedItemIds: new Set(),
    pendingToolCallItems: new Map(),
  };
}

/** A single discovery pass is enough per sampling step; the model can refine it next round. */
function retainToolCall(toolCall: RuntimeToolCall, filter: ToolSearchStreamFilter): boolean {
  if (filter.discardedCallIds.has(toolCall.id)) return false;
  if (toolCall.name !== TOOL_SEARCH_TOOL_NAME) return true;
  if (!filter.retainedCallId) {
    filter.retainedCallId = toolCall.id;
    return true;
  }
  if (filter.retainedCallId === toolCall.id) return true;
  filter.discardedCallIds.add(toolCall.id);
  return false;
}

function retainToolCalls(
  toolCalls: RuntimeToolCall[],
  filter: ToolSearchStreamFilter,
): RuntimeToolCall[] {
  return toolCalls.filter((toolCall) => retainToolCall(toolCall, filter));
}

/**
 * Defers unnamed tool-call lifecycle items until completion, when the call name is known, then
 * filters duplicate discovery calls before any part of their lifecycle crosses the event boundary.
 */
function filterModelStreamEvents(
  event: ModelStreamEvent,
  filter: ToolSearchStreamFilter,
): ModelStreamEvent[] {
  if (event.type === 'item_started' && event.item.kind === 'tool_call') {
    const toolCall = toolCallFromModelStreamItem(event);
    if (!toolCall) {
      filter.pendingToolCallItems.set(event.item.id, [event]);
      return [];
    }
    if (retainToolCall(toolCall, filter)) return [event];
    filter.discardedItemIds.add(event.item.id);
    return [];
  }
  if (event.type === 'item_delta') {
    const pending = filter.pendingToolCallItems.get(event.itemId);
    if (pending) {
      pending.push(event);
      return [];
    }
    return filter.discardedItemIds.has(event.itemId) ? [] : [event];
  }
  if (event.type === 'item_completed' && event.item.kind === 'tool_call') {
    const pending = filter.pendingToolCallItems.get(event.item.id) ?? [];
    filter.pendingToolCallItems.delete(event.item.id);
    const toolCall = toolCallFromModelStreamItem(event);
    if (!toolCall || retainToolCall(toolCall, filter)) return [...pending, event];
    filter.discardedItemIds.add(event.item.id);
    return [];
  }
  if (event.type === 'tool_call_delta') {
    return retainToolCall({
      id: event.call.id,
      name: event.call.name,
      arguments: event.call.argumentsDelta,
    }, filter) ? [event] : [];
  }
  return [event];
}

function appendAssistantStreamPart(
  parts: RuntimeMessageStreamPart[],
  type: RuntimeMessageStreamPart['type'],
  content: string,
): void {
  if (!content) return;
  const previous = parts.at(-1);
  if (previous?.type === type) {
    previous.content += content;
  } else {
    parts.push({ type, content });
  }
}

function isProviderAgentMessageEvent(
  event: ModelStreamEvent,
  agentItemIds: Set<string>,
): boolean {
  if (
    (event.type === 'item_started' || event.type === 'item_completed')
    && event.item.kind === 'agent_message'
  ) {
    agentItemIds.add(event.item.id);
    return true;
  }
  return event.type === 'item_delta' && agentItemIds.has(event.itemId);
}

function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.');
  error.name = 'AbortError';
  throw error;
}
