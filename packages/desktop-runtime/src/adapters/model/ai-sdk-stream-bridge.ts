import type {
  ModelStreamEvent,
  RuntimeStreamItem,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type {
  FinishReason,
  LanguageModelUsage,
  TextStreamPart,
  ToolSet,
} from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import { LegacyThinkTagStreamDecoder } from './legacy-think-tag-stream.js';
import { doneEvent } from './provider-stream.js';
import { stringValue } from './provider-values.js';

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type TextItemState = {
  content: string;
  runtimeId: string;
  completed: boolean;
};

type AiSdkStreamState = {
  textItems: Map<string, TextItemState>;
  reasoningItems: Map<string, TextItemState>;
  textOrdinal: number;
  reasoningOrdinal: number;
  toolCalls: Map<string, PendingToolCall>;
  toolInputsStreamed: Set<string>;
  toolItemsStarted: Set<string>;
  toolItemsCompleted: Set<string>;
  ignoredToolIds: Set<string>;
  legacyThinkDecoders: Map<string, LegacyThinkTagStreamDecoder>;
};

export type AiSdkStreamBridgeOptions = {
  provider: Pick<RuntimeProviderConfig, 'id' | 'name'>;
  model: string;
  sideEvents?: AsyncIterable<ModelStreamEvent>;
  textItemId?: (sourceId: string, ordinal: number) => string;
  reasoningItemId?: (sourceId: string, ordinal: number) => string;
  toolCallArguments?: (toolCallId: string) => string | undefined;
  includeToolName?: boolean;
  legacyThinkTags?: boolean;
  useRawFinishReason?: boolean;
  handleReasoning?: boolean;
  onPart?: (part: TextStreamPart<ToolSet>) => void;
  eventsForPart?: (part: TextStreamPart<ToolSet>) => Iterable<ModelStreamEvent>;
  beforeTerminalEvents?: () => Iterable<ModelStreamEvent>;
};

export async function* bridgeAiSdkStream(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
  options: AiSdkStreamBridgeOptions,
): AsyncGenerator<ModelStreamEvent> {
  const state = createStreamState();
  let finishReason: FinishReason | undefined;
  let rawFinishReason: string | undefined;
  let usage: LanguageModelUsage | undefined;

  for await (const input of interleaveAiSdkStream(stream, options.sideEvents)) {
    if (input.kind === 'event') {
      yield input.event;
      continue;
    }
    const part = input.part;
    options.onPart?.(part);
    if (options.eventsForPart) yield* options.eventsForPart(part);
    if (part.type === 'text-start') {
      yield* startTextItem(state, part.id, options);
    } else if (part.type === 'text-delta') {
      if (options.legacyThinkTags) yield* legacyTextItemDelta(state, part.id, part.text, options);
      else yield* textItemDelta(state, part.id, part.text, options);
    } else if (part.type === 'text-end') {
      if (options.legacyThinkTags) yield* finishLegacyTextItem(state, part.id, options);
      yield* completeTextItem(state.textItems, part.id, 'agent_message');
    } else if (part.type === 'reasoning-start') {
      if (options.handleReasoning !== false) yield* startReasoningItem(state, part.id, options);
    } else if (part.type === 'reasoning-delta') {
      if (options.handleReasoning !== false) {
        yield* reasoningItemDelta(state, part.id, part.text, options);
      }
    } else if (part.type === 'reasoning-end') {
      if (options.handleReasoning !== false) {
        yield* completeTextItem(state.reasoningItems, part.id, 'reasoning');
      }
    } else if (part.type === 'tool-input-start') {
      if (part.providerExecuted) {
        state.ignoredToolIds.add(part.id);
        continue;
      }
      const toolCall = upsertToolCall(state.toolCalls, part.id, { name: part.toolName });
      yield* toolItemStarted(state, toolCall, options.includeToolName === true);
    } else if (part.type === 'tool-input-delta') {
      if (state.ignoredToolIds.has(part.id)) continue;
      const toolCall = upsertToolCall(state.toolCalls, part.id, { argumentsDelta: part.delta });
      state.toolInputsStreamed.add(part.id);
      yield {
        type: 'tool_call_delta',
        call: { id: toolCall.id, name: toolCall.name, argumentsDelta: part.delta },
      };
    } else if (part.type === 'tool-call') {
      if (part.providerExecuted || state.ignoredToolIds.has(part.toolCallId)) continue;
      const input = options.toolCallArguments?.(part.toolCallId)
        ?? stringifyToolInput(part.input);
      const toolCall = upsertToolCall(state.toolCalls, part.toolCallId, {
        name: part.toolName,
        arguments: input,
      });
      yield* toolItemStarted(state, toolCall, options.includeToolName === true);
      if (!state.toolInputsStreamed.has(part.toolCallId)) {
        yield {
          type: 'tool_call_delta',
          call: { id: toolCall.id, name: toolCall.name, argumentsDelta: input },
        };
      }
      yield* toolItemCompleted(state, toolCall, options.includeToolName === true);
    } else if (part.type === 'finish-step') {
      finishReason = part.finishReason;
      rawFinishReason = part.rawFinishReason;
      usage = part.usage;
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
      rawFinishReason = part.rawFinishReason;
      usage = part.totalUsage;
    } else if (part.type === 'error') {
      throw toError(part.error);
    } else {
      ignoreStreamPart(part);
    }
  }

  if (options.legacyThinkTags) yield* finishOpenLegacyTextItems(state, options);
  yield* completeOpenTextItems(state);
  const fallbackCalls = completeToolCalls(state.toolCalls)
    .filter((toolCall) => !state.toolItemsCompleted.has(toolCall.id));
  if (fallbackCalls.length) yield { type: 'tool_calls', toolCalls: fallbackCalls };
  if (options.beforeTerminalEvents) yield* options.beforeTerminalEvents();
  if (usage) yield usageEvent(usage, options);
  yield doneEvent(options.useRawFinishReason ? rawFinishReason ?? finishReason : finishReason);
}

async function* interleaveAiSdkStream(
  stream: AsyncIterable<TextStreamPart<ToolSet>>,
  sideEvents?: AsyncIterable<ModelStreamEvent>,
): AsyncGenerator<
  | { kind: 'part'; part: TextStreamPart<ToolSet> }
  | { kind: 'event'; event: ModelStreamEvent }
> {
  if (!sideEvents) {
    for await (const part of stream) yield { kind: 'part', part };
    return;
  }

  const partIterator = stream[Symbol.asyncIterator]();
  const eventIterator = sideEvents[Symbol.asyncIterator]();
  let partDone = false;
  let eventDone = false;
  let nextPart = taggedNext(partIterator, 'part');
  let nextEvent = taggedNext(eventIterator, 'event');

  try {
    while (!partDone || !eventDone) {
      const candidates = [
        ...(!eventDone ? [nextEvent] : []),
        ...(!partDone ? [nextPart] : []),
      ];
      const next = await Promise.race(candidates);
      if (next.kind === 'part') {
        if (next.result.done) {
          partDone = true;
        } else {
          yield { kind: 'part', part: next.result.value };
          nextPart = taggedNext(partIterator, 'part');
        }
      } else if (next.result.done) {
        eventDone = true;
      } else {
        yield { kind: 'event', event: next.result.value };
        nextEvent = taggedNext(eventIterator, 'event');
      }
    }
  } finally {
    if (!partDone) await partIterator.return?.();
    if (!eventDone) await eventIterator.return?.();
  }
}

function taggedNext<T, TKind extends 'part' | 'event'>(
  iterator: AsyncIterator<T>,
  kind: TKind,
): Promise<{ kind: TKind; result: IteratorResult<T> }> {
  return iterator.next().then((result) => ({ kind, result }));
}

function createStreamState(): AiSdkStreamState {
  return {
    textItems: new Map(),
    reasoningItems: new Map(),
    textOrdinal: 0,
    reasoningOrdinal: 0,
    toolCalls: new Map(),
    toolInputsStreamed: new Set(),
    toolItemsStarted: new Set(),
    toolItemsCompleted: new Set(),
    ignoredToolIds: new Set(),
    legacyThinkDecoders: new Map(),
  };
}

function* legacyTextItemDelta(
  state: AiSdkStreamState,
  sourceId: string,
  delta: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  const decoder = state.legacyThinkDecoders.get(sourceId) ?? new LegacyThinkTagStreamDecoder();
  state.legacyThinkDecoders.set(sourceId, decoder);
  yield* appendLegacyTextChunks(state, sourceId, decoder.push(delta), options);
}

function* finishLegacyTextItem(
  state: AiSdkStreamState,
  sourceId: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  const decoder = state.legacyThinkDecoders.get(sourceId);
  if (!decoder) return;
  const chunks = decoder.finish();
  yield* appendLegacyTextChunks(state, sourceId, chunks, options);
  yield* completeTextItem(state.reasoningItems, legacyReasoningSourceId(sourceId), 'reasoning');
  state.legacyThinkDecoders.delete(sourceId);
}

function* finishOpenLegacyTextItems(
  state: AiSdkStreamState,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  for (const sourceId of [...state.legacyThinkDecoders.keys()]) {
    yield* finishLegacyTextItem(state, sourceId, options);
  }
}

function* appendLegacyTextChunks(
  state: AiSdkStreamState,
  sourceId: string,
  chunks: ReturnType<LegacyThinkTagStreamDecoder['push']>,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  for (const chunk of chunks) {
    if (chunk.type === 'content') yield* textItemDelta(state, sourceId, chunk.text, options);
    else yield* reasoningItemDelta(state, legacyReasoningSourceId(sourceId), chunk.text, options);
  }
}

function legacyReasoningSourceId(sourceId: string): string {
  return `${sourceId}:legacy-think`;
}

function* startTextItem(
  state: AiSdkStreamState,
  sourceId: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  if (state.textItems.has(sourceId)) return;
  const ordinal = state.textOrdinal++;
  const runtimeId = options.textItemId?.(sourceId, ordinal) ?? `ai_sdk_agent_message_${ordinal}`;
  state.textItems.set(sourceId, { content: '', runtimeId, completed: false });
  yield {
    type: 'item_started',
    item: { id: runtimeId, kind: 'agent_message', content: '', status: 'in_progress' },
  };
}

function* textItemDelta(
  state: AiSdkStreamState,
  sourceId: string,
  delta: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  if (!delta) return;
  yield* startTextItem(state, sourceId, options);
  const item = state.textItems.get(sourceId);
  if (!item) return;
  item.content += delta;
  yield { type: 'item_delta', itemId: item.runtimeId, delta };
}

function* startReasoningItem(
  state: AiSdkStreamState,
  sourceId: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  if (state.reasoningItems.has(sourceId)) return;
  const ordinal = state.reasoningOrdinal++;
  const runtimeId = options.reasoningItemId?.(sourceId, ordinal) ?? `ai_sdk_reasoning_${ordinal}`;
  state.reasoningItems.set(sourceId, { content: '', runtimeId, completed: false });
  yield {
    type: 'item_started',
    item: { id: runtimeId, kind: 'reasoning', content: '', status: 'in_progress' },
  };
}

function* reasoningItemDelta(
  state: AiSdkStreamState,
  sourceId: string,
  delta: string,
  options: AiSdkStreamBridgeOptions,
): Generator<ModelStreamEvent> {
  yield* startReasoningItem(state, sourceId, options);
  const item = state.reasoningItems.get(sourceId);
  if (!item || !delta) return;
  item.content += delta;
  yield { type: 'reasoning_raw_delta', itemId: item.runtimeId, text: delta, contentIndex: 0 };
}

function* completeTextItem(
  items: Map<string, TextItemState>,
  sourceId: string,
  kind: 'agent_message' | 'reasoning',
): Generator<ModelStreamEvent> {
  const item = items.get(sourceId);
  if (!item || item.completed) return;
  item.completed = true;
  yield {
    type: 'item_completed',
    item: { id: item.runtimeId, kind, content: item.content, status: 'completed' },
  };
}

function* completeOpenTextItems(state: AiSdkStreamState): Generator<ModelStreamEvent> {
  for (const sourceId of state.reasoningItems.keys()) {
    yield* completeTextItem(state.reasoningItems, sourceId, 'reasoning');
  }
  for (const sourceId of state.textItems.keys()) {
    yield* completeTextItem(state.textItems, sourceId, 'agent_message');
  }
}

function upsertToolCall(
  toolCalls: Map<string, PendingToolCall>,
  id: string,
  next: { name?: string; arguments?: string; argumentsDelta?: string },
): PendingToolCall {
  const existing = toolCalls.get(id) ?? { id, name: '', arguments: '' };
  const toolCall = {
    id,
    name: next.name || existing.name,
    arguments: next.arguments ?? `${existing.arguments}${next.argumentsDelta ?? ''}`,
  };
  toolCalls.set(id, toolCall);
  return toolCall;
}

function* toolItemStarted(
  state: AiSdkStreamState,
  toolCall: PendingToolCall,
  includeName: boolean,
): Generator<ModelStreamEvent> {
  if (!toolCall.id || state.toolItemsStarted.has(toolCall.id)) return;
  state.toolItemsStarted.add(toolCall.id);
  yield {
    type: 'item_started',
    item: toolStreamItem(toolCall, 'in_progress', includeName),
  };
}

function* toolItemCompleted(
  state: AiSdkStreamState,
  toolCall: PendingToolCall,
  includeName: boolean,
): Generator<ModelStreamEvent> {
  if (!toolCall.id || !toolCall.name || state.toolItemsCompleted.has(toolCall.id)) return;
  state.toolItemsCompleted.add(toolCall.id);
  yield {
    type: 'item_completed',
    item: toolStreamItem(toolCall, 'completed', includeName),
  };
}

function toolStreamItem(
  toolCall: PendingToolCall,
  status: NonNullable<RuntimeStreamItem['status']>,
  includeName: boolean,
): RuntimeStreamItem {
  return {
    id: toolCall.id,
    kind: 'tool_call',
    ...(includeName ? { name: toolCall.name } : {}),
    status,
    toolCall: { ...toolCall },
  };
}

function completeToolCalls(toolCalls: Map<string, PendingToolCall>): RuntimeToolCall[] {
  return [...toolCalls.values()].filter((toolCall) => toolCall.name);
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}

function usageEvent(
  usage: LanguageModelUsage,
  options: AiSdkStreamBridgeOptions,
): ModelStreamEvent {
  return {
    type: 'usage',
    usage: {
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      providerId: options.provider.id,
      provider: options.provider.name,
      model: options.model,
    },
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(stringValue(error) || 'AI SDK stream failed.');
}

function ignoreStreamPart(
  _part: Exclude<TextStreamPart<ToolSet>, {
    type:
      | 'text-start'
      | 'text-delta'
      | 'text-end'
      | 'reasoning-start'
      | 'reasoning-delta'
      | 'reasoning-end'
      | 'tool-input-start'
      | 'tool-input-delta'
      | 'tool-call'
      | 'finish-step'
      | 'finish'
      | 'error';
  }>,
): void {}
