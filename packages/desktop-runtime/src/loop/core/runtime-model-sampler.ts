import {
  RUNTIME_DEVELOPER_FEATURES_FLAG,
  type ModelRequest,
  type RuntimeMemoryCitation,
  type RuntimeMessage,
  type RuntimeModelRequestStepSnapshot,
  type RuntimeToolCall,
  type RuntimeToolDefinition,
  type RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { ModelClient } from '../../ports/model-client.js';
import type { RuntimeToolCallExecutor, ToolPreviewAnnouncement } from '../tools/runtime-tool-call-executor.js';
import type { RuntimeToolRouter } from '../tools/tool-router.js';
import { bindProviderMetadataToSemanticMessage } from '../../utils/runtime-message-semantic-fingerprint.js';
import { toolCallFromModelStreamItem, toolsForModelRequest, upsertRuntimeToolCall } from './agent-loop-tool-utils.js';
import {
  createAssistantItemStreamBridge,
  createAssistantOutputAccumulator,
  createLegacyModelStreamMirrorState,
} from './model-stream-output.js';
import type { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import { mergeRuntimeProviderMetadata } from './runtime-provider-metadata.js';

type TurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeSamplingModelContext = {
  developerFeaturesEnabled: boolean;
  messages: RuntimeMessage[];
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
  streamEvents: RuntimeModelStreamEventPublisher;
  toolExecutor: RuntimeToolCallExecutor;
};

/** 执行一次模型采样步骤，并统一旧版与基于条目的流式协议。 */
export class RuntimeModelSampler {
  constructor(private readonly options: RuntimeModelSamplerOptions) {}

  async sample({
    captureProtocolUsage,
    onAssistantStarted,
    planMode,
    planOnly,
    signal,
    step,
    thinkingOptions,
    threadId,
    turnId,
  }: {
    captureProtocolUsage: boolean;
    onAssistantStarted?(messageId: string): void;
    planMode?: RuntimeMessage['planMode'];
    planOnly: boolean;
    signal: AbortSignal;
    step: RuntimeSamplingModelContext;
    thinkingOptions: TurnThinkingOptions;
    threadId: string;
    turnId: string;
  }): Promise<RuntimeSampledAssistant> {
    const assistantMessageId = this.options.ids.id('msg');
    const assistantMessage: RuntimeMessage = {
      id: assistantMessageId,
      turnId,
      role: 'assistant',
      content: '',
      createdAt: this.options.clock.now().toISOString(),
      planMode,
      status: 'streaming',
    };
    onAssistantStarted?.(assistantMessageId);
    await this.options.streamEvents.publishMessage(threadId, turnId, assistantMessage);

    let toolCalls: RuntimeToolCall[] = [];
    let usage: RuntimeUsage | undefined;
    const partialToolCalls = new Map<string, RuntimeToolCall>();
    const announcedToolPreviews = new Map<string, ToolPreviewAnnouncement>();
    const output = createAssistantOutputAccumulator((delta) =>
      this.options.streamEvents.publishAssistantDelta(threadId, turnId, assistantMessageId, delta)
    );
    const streamBridge = createAssistantItemStreamBridge(output, { renderPlanDeltas: planOnly });
    const mirror = createLegacyModelStreamMirrorState();
    const requestToolChoice = planOnly ? 'none' : step.toolChoice;
    const requestTools = planOnly ? undefined : toolsForModelRequest(step.tools, requestToolChoice);
    const requestSnapshot = planOnly ? noToolStepSnapshot(step.snapshot) : step.snapshot;
    const samplingStepEvent = await this.options.streamEvents.publishSamplingStepSnapshot(
      threadId,
      turnId,
      requestSnapshot,
    );
    const modelRequestSnapshot = step.developerFeaturesEnabled
      ? {
          ...requestSnapshot,
          // Debug traces use the committed step event as their cross-stream order anchor.
          threadLastSeq: samplingStepEvent?.seq ?? requestSnapshot.threadLastSeq,
          featureKeys: [...new Set([
            ...requestSnapshot.featureKeys,
            RUNTIME_DEVELOPER_FEATURES_FLAG,
          ])].sort(),
        }
      : requestSnapshot;

    for await (const item of this.options.modelClient.stream({
      model: 'local-runtime-smoke',
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
      if (await this.options.streamEvents.publishModelStreamProtocolEvent(threadId, turnId, item)) {
        if (captureProtocolUsage && item.type === 'token_count') usage = item.usage;
        await streamBridge.consume(item);
        const protocolToolCall = toolCallFromModelStreamItem(item);
        if (protocolToolCall) toolCalls = upsertRuntimeToolCall(toolCalls, protocolToolCall);
        continue;
      }
      if (item.type === 'reasoning_delta') {
        await this.options.streamEvents.mirrorLegacyReasoningDelta(mirror, threadId, turnId, assistantMessageId, item.text);
        await streamBridge.appendReasoning(item.text);
      }
      if (item.type === 'text_delta') {
        await this.options.streamEvents.mirrorLegacyAgentDelta(mirror, threadId, turnId, assistantMessageId, item.text);
        await streamBridge.appendAgent(item.text);
      }
      if (item.type === 'tool_call_delta') {
        await this.options.streamEvents.mirrorLegacyToolCallDelta(mirror, threadId, turnId, item.call);
        await this.options.toolExecutor.publishToolCallDeltaPreview({
          announcedToolPreviews,
          call: item.call,
          partialToolCalls,
          threadId,
          toolRouter: step.toolRouter,
          turnId,
        });
      }
      if (item.type === 'tool_calls') {
        toolCalls = item.toolCalls;
        await this.options.streamEvents.mirrorLegacyToolCallsCompleted(mirror, threadId, turnId, toolCalls);
      }
      if (item.type === 'usage') {
        usage = item.usage;
        await this.options.streamEvents.mirrorLegacyUsage(mirror, threadId, turnId, item.usage);
      }
    }

    await streamBridge.finish();
    await this.options.streamEvents.completeLegacyStreamItems(mirror, threadId, turnId, assistantMessageId);
    const memoryCitation = await output.finish();
    let text = output.text();
    if (planOnly && toolCalls.length) {
      toolCalls = [];
      if (!text.trim()) {
        const fallbackText = 'Plan mode is active. I will wait for confirmation before running tools.';
        text += fallbackText;
        await this.options.streamEvents.publishAssistantDelta(threadId, turnId, assistantMessageId, fallbackText);
      }
    }
    if (!text.trim() && !toolCalls.length) {
      // A transport can terminate cleanly while returning no usable model output (for example,
      // when an OpenAI-compatible base URL points at a website instead of its API). Treating that
      // as success leaves a blank assistant turn and hides the configuration failure from users.
      throw new Error('模型服务返回了空响应，请检查 API Base URL、模型 ID 和供应商协议配置。');
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

function modelRequestMessages(messages: RuntimeMessage[]): RuntimeMessage[] {
  return messages.filter((message) => message.visibility !== 'transcript');
}

function noToolStepSnapshot(snapshot: RuntimeModelRequestStepSnapshot): RuntimeModelRequestStepSnapshot {
  return {
    ...snapshot,
    toolNames: [],
    advertisedToolNames: [],
    toolRuntimes: [],
    toolChoice: 'none',
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Turn cancelled.');
  error.name = 'AbortError';
  throw error;
}
