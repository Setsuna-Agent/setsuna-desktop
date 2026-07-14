import type {
  ModelRequest,
  RuntimeMemoryCitation,
  RuntimeMessage,
  RuntimeModelRequestStepSnapshot,
  RuntimeToolCall,
  RuntimeToolDefinition,
  RuntimeUsage,
} from '@setsuna-desktop/contracts';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { ModelClient } from '../ports/model-client.js';
import { createAssistantItemStreamBridge, createAssistantOutputAccumulator, createLegacyModelStreamMirrorState } from './model-stream-output.js';
import { toolCallFromModelStreamItem, toolsForModelRequest, upsertRuntimeToolCall } from './agent-loop-tool-utils.js';
import type { RuntimeModelStreamEventPublisher } from './runtime-model-stream-event-publisher.js';
import type { RuntimeToolCallExecutor, ToolPreviewAnnouncement } from './runtime-tool-call-executor.js';
import type { RuntimeToolRouter } from './tool-router.js';

type TurnThinkingOptions = Pick<ModelRequest, 'thinking' | 'reasoningEffort'>;

export type RuntimeSamplingModelContext = {
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

/** Runs one model sampling step and normalizes legacy and item-based stream protocols. */
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
    await this.options.streamEvents.publishSamplingStepSnapshot(threadId, turnId, requestSnapshot);

    for await (const item of this.options.modelClient.stream({
      model: 'local-runtime-smoke',
      messages: modelRequestMessages(step.messages),
      tools: requestTools,
      toolChoice: requestToolChoice,
      stepSnapshot: requestSnapshot,
      ...thinkingOptions,
      signal,
    })) {
      throwIfAborted(signal);
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
    routerToolNames: [],
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
