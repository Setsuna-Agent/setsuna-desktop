import {
  normalizeRuntimeMessageProviderMetadata,
  sanitizeRuntimeJsonValue,
  type ModelStreamEvent,
  type RuntimeAssistantMessagePhase,
  type RuntimeProviderReplayBlock,
  type RuntimeStreamItem,
} from '@setsuna-desktop/contracts';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import type { ModelProviderRuntimeConfig } from '../contracts/index.js';
import { LegacyThinkTagStreamDecoder, type LegacyThinkTagStreamChunk } from './legacy-think-tag-stream.js';
import type { PiReplayContext } from './pi-context.js';

type OpenItem = {
  id: string;
  kind: 'agent_message' | 'reasoning' | 'tool_call';
  content: string;
};

type PiStreamState = {
  dedicatedReasoningObserved: boolean;
  invocationId: string;
  legacyThinkDecoders: Map<number, LegacyThinkTagStreamDecoder>;
  openItems: Map<string, OpenItem>;
  pendingTextCompletions: Map<number, RuntimeAssistantMessagePhase | undefined>;
};

export type ProviderTransportFailure = {
  status?: number;
  code?: string;
};

export async function* bridgePiStream(
  events: AsyncIterable<AssistantMessageEvent>,
  provider: ModelProviderRuntimeConfig,
  replayContext: PiReplayContext,
  transportFailure?: Readonly<ProviderTransportFailure>,
): AsyncGenerator<ModelStreamEvent> {
  const state = createStreamState();
  const decodeLegacyThinkTags = provider.provider === 'openai-compatible';
  let terminal: AssistantMessage | undefined;

  for await (const event of events) {
    if (event.type === 'start') continue;
    if (event.type === 'text_start') {
      yield* startItem(state, event.contentIndex, 'agent_message');
      continue;
    }
    if (event.type === 'text_delta') {
      if (decodeLegacyThinkTags && !state.dedicatedReasoningObserved) {
        const decoder = state.legacyThinkDecoders.get(event.contentIndex) ?? new LegacyThinkTagStreamDecoder();
        state.legacyThinkDecoders.set(event.contentIndex, decoder);
        yield* appendLegacyChunks(state, event.contentIndex, decoder.push(event.delta));
      } else {
        yield* appendItemDelta(state, event.contentIndex, 'agent_message', event.delta);
      }
      continue;
    }
    if (event.type === 'text_end') {
      const phase = textPhase(event.partial.content[event.contentIndex]);
      const decoder = state.legacyThinkDecoders.get(event.contentIndex);
      if (
        decodeLegacyThinkTags
        && !state.dedicatedReasoningObserved
        && decoder?.hasUndecidedLegacyEnvelope()
      ) {
        // A compatible provider can emit its dedicated reasoning block after ending visible text.
        // Keep the buffered envelope reversible until the terminal message establishes the protocol.
        state.pendingTextCompletions.set(event.contentIndex, phase);
      } else {
        if (decodeLegacyThinkTags && !state.dedicatedReasoningObserved && decoder) {
          yield* finishLegacyText(state, event.contentIndex, decoder);
        }
        yield* completeItem(
          state,
          event.contentIndex,
          'agent_message',
          decodeLegacyThinkTags && !state.dedicatedReasoningObserved ? undefined : event.content,
          phase,
        );
      }
      continue;
    }
    if (event.type === 'thinking_start') {
      yield* observeDedicatedReasoning(state);
      yield* startItem(state, event.contentIndex, 'reasoning');
      continue;
    }
    if (event.type === 'thinking_delta') {
      yield* observeDedicatedReasoning(state);
      yield* appendItemDelta(state, event.contentIndex, 'reasoning', event.delta);
      continue;
    }
    if (event.type === 'thinking_end') {
      yield* observeDedicatedReasoning(state);
      yield* completeItem(state, event.contentIndex, 'reasoning', event.content);
      continue;
    }
    if (event.type === 'toolcall_start') {
      yield* startItem(state, event.contentIndex, 'tool_call');
      continue;
    }
    if (event.type === 'toolcall_delta') {
      const block = event.partial.content[event.contentIndex];
      if (block?.type === 'toolCall') {
        yield {
          type: 'tool_call_delta',
          call: { id: callId(block.id), name: block.name, argumentsDelta: event.delta },
        };
      }
      continue;
    }
    if (event.type === 'toolcall_end') {
      const call = toRuntimeToolCall(event.toolCall);
      const item = yield* completeItem(
        state,
        event.contentIndex,
        'tool_call',
        JSON.stringify(event.toolCall.arguments),
      );
      if (item) {
        yield {
          type: 'item_completed',
          item: {
            ...runtimeItem(item, 'completed'),
            name: call.name,
            toolCall: call,
          },
        };
      }
      continue;
    }
    if (event.type === 'error') {
      throw providerStreamError(event.reason, event.error.errorMessage, transportFailure);
    }
    terminal = event.message;
  }

  if (!terminal) throw new Error('Pi provider stream ended without a terminal assistant message.');
  if (decodeLegacyThinkTags && !state.dedicatedReasoningObserved) {
    for (const [contentIndex, decoder] of state.legacyThinkDecoders) {
      yield* finishLegacyText(state, contentIndex, decoder);
    }
  }
  for (const [contentIndex, phase] of state.pendingTextCompletions) {
    yield* completeItem(state, contentIndex, 'agent_message', undefined, phase);
  }
  for (const [key, item] of state.openItems) {
    yield { type: 'item_completed', item: runtimeItem(item, 'completed') };
    state.openItems.delete(key);
  }

  const normalizedTerminal = decodeLegacyThinkTags && !state.dedicatedReasoningObserved
    ? normalizeLegacyAssistant(terminal)
    : terminal;
  const providerMetadata = providerMetadataForAssistant(normalizedTerminal, replayContext);
  if (providerMetadata) yield { type: 'assistant_metadata', providerMetadata };
  const toolCalls = normalizedTerminal.content
    .filter((block): block is ToolCall => block.type === 'toolCall')
    .map(toRuntimeToolCall);
  if (toolCalls.length) yield { type: 'tool_calls', toolCalls };
  yield {
    type: 'usage',
    usage: {
      providerId: provider.id,
      provider: provider.name,
      model: terminal.responseModel || terminal.model,
      inputTokens: terminal.usage.input + terminal.usage.cacheRead + terminal.usage.cacheWrite,
      cachedInputTokens: terminal.usage.cacheRead,
      outputTokens: terminal.usage.output,
      totalTokens: terminal.usage.totalTokens,
    },
  };
  yield { type: 'done', finishReason: terminal.stopReason };
}

function createStreamState(): PiStreamState {
  return {
    dedicatedReasoningObserved: false,
    invocationId: randomUUID(),
    legacyThinkDecoders: new Map(),
    openItems: new Map(),
    pendingTextCompletions: new Map(),
  };
}

function* observeDedicatedReasoning(state: PiStreamState): Generator<ModelStreamEvent> {
  if (state.dedicatedReasoningObserved) return;
  state.dedicatedReasoningObserved = true;
  for (const [contentIndex, decoder] of state.legacyThinkDecoders) {
    yield* appendLegacyChunks(state, contentIndex, decoder.finishAsContent());
  }
  state.legacyThinkDecoders.clear();
  for (const [contentIndex, phase] of state.pendingTextCompletions) {
    yield* completeItem(state, contentIndex, 'agent_message', undefined, phase);
  }
  state.pendingTextCompletions.clear();
}

function* finishLegacyText(
  state: PiStreamState,
  contentIndex: number,
  decoder: LegacyThinkTagStreamDecoder,
): Generator<ModelStreamEvent> {
  yield* appendLegacyChunks(state, contentIndex, decoder.finish());
  yield* completeItem(state, contentIndex, 'reasoning');
  state.legacyThinkDecoders.delete(contentIndex);
}

function* appendLegacyChunks(
  state: PiStreamState,
  contentIndex: number,
  chunks: readonly LegacyThinkTagStreamChunk[],
): Generator<ModelStreamEvent> {
  for (const chunk of chunks) {
    yield* appendItemDelta(
      state,
      contentIndex,
      chunk.type === 'reasoning' ? 'reasoning' : 'agent_message',
      chunk.text,
    );
  }
}

function* startItem(
  state: PiStreamState,
  contentIndex: number,
  kind: OpenItem['kind'],
): Generator<ModelStreamEvent, OpenItem> {
  const key = itemKey(contentIndex, kind);
  const current = state.openItems.get(key);
  if (current) return current;
  const item: OpenItem = {
    id: `pi_${state.invocationId}_${kind}_${contentIndex}`,
    kind,
    content: '',
  };
  state.openItems.set(key, item);
  yield { type: 'item_started', item: runtimeItem(item, 'in_progress') };
  return item;
}

function* appendItemDelta(
  state: PiStreamState,
  contentIndex: number,
  kind: OpenItem['kind'],
  delta: string,
): Generator<ModelStreamEvent> {
  if (!delta) return;
  const item = yield* startItem(state, contentIndex, kind);
  item.content += delta;
  yield { type: 'item_delta', itemId: item.id, delta };
}

function* completeItem(
  state: PiStreamState,
  contentIndex: number,
  kind: OpenItem['kind'],
  content?: string,
  phase?: RuntimeAssistantMessagePhase,
): Generator<ModelStreamEvent, OpenItem | undefined> {
  const key = itemKey(contentIndex, kind);
  const existing = state.openItems.get(key);
  if (!existing && content === undefined) return undefined;
  const item = existing ?? (yield* startItem(state, contentIndex, kind));
  if (content !== undefined) item.content = content;
  state.openItems.delete(key);
  if (kind !== 'tool_call') {
    yield { type: 'item_completed', item: runtimeItem(item, 'completed', phase) };
    return undefined;
  }
  return item;
}

function normalizeLegacyAssistant(message: AssistantMessage): AssistantMessage {
  if (message.content.some((block) => block.type === 'thinking')) return message;
  const content: AssistantMessage['content'] = [];
  let changed = false;
  for (const block of message.content) {
    if (block.type !== 'text') {
      content.push(block);
      continue;
    }
    const decoder = new LegacyThinkTagStreamDecoder();
    const chunks = [...decoder.push(block.text), ...decoder.finish()];
    if (!chunks.some((chunk) => chunk.type === 'reasoning')) {
      content.push(block);
      continue;
    }
    changed = true;
    for (const chunk of chunks) {
      if (chunk.type === 'reasoning') content.push({ type: 'thinking', thinking: chunk.text });
      else content.push({ type: 'text', text: chunk.text });
    }
  }
  return changed ? { ...message, content } : message;
}

function providerMetadataForAssistant(
  message: AssistantMessage,
  context: PiReplayContext,
) {
  const blocks = message.content.flatMap((block): RuntimeProviderReplayBlock[] => {
    if (block.type === 'text') {
      return [{
        type: 'text',
        text: block.text,
        ...(block.textSignature ? { signature: block.textSignature } : {}),
      }];
    }
    if (block.type === 'thinking') {
      return [{
        type: 'thinking',
        text: block.thinking,
        ...(block.thinkingSignature ? { signature: block.thinkingSignature } : {}),
        ...(block.redacted ? { redacted: true } : {}),
      }];
    }
    const [id, itemId] = splitCallId(block.id);
    return [{
      type: 'tool_call',
      id,
      name: block.name,
      arguments: sanitizeRuntimeJsonValue(block.arguments) ?? {},
      ...(itemId ? { itemId } : {}),
      ...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
      ...(block.namespace ? { namespace: block.namespace } : {}),
    }];
  });
  return normalizeRuntimeMessageProviderMetadata({
    schemaVersion: 3,
    source: {
      providerId: context.providerId,
      providerKind: context.providerKind,
      model: context.model,
      endpointFingerprint: context.endpointFingerprint,
    },
    assistantReplay: {
      ...(message.responseId ? { responseId: message.responseId } : {}),
      blocks,
    },
  });
}

function runtimeItem(
  item: OpenItem,
  status: RuntimeStreamItem['status'],
  phase?: RuntimeAssistantMessagePhase,
): RuntimeStreamItem {
  return {
    id: item.id,
    kind: item.kind,
    content: item.content,
    status,
    ...(phase ? { phase } : {}),
  };
}

function itemKey(contentIndex: number, kind: OpenItem['kind']): string {
  return `${kind}:${contentIndex}`;
}

function textPhase(block: TextContent | ThinkingContent | ToolCall | undefined): RuntimeAssistantMessagePhase | undefined {
  if (block?.type !== 'text' || !block.textSignature?.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(block.textSignature) as Record<string, unknown>;
    return parsed.phase === 'commentary' || parsed.phase === 'final_answer' ? parsed.phase : undefined;
  } catch {
    return undefined;
  }
}

function toRuntimeToolCall(toolCall: ToolCall) {
  return {
    id: callId(toolCall.id),
    name: toolCall.name,
    arguments: JSON.stringify(toolCall.arguments),
  };
}

function callId(value: string): string {
  return splitCallId(value)[0];
}

function splitCallId(value: string): [string, string | undefined] {
  const separator = value.indexOf('|');
  return separator < 0
    ? [value, undefined]
    : [value.slice(0, separator), value.slice(separator + 1) || undefined];
}

function providerStreamError(
  reason: 'error' | 'aborted',
  message: string | undefined,
  transportFailure?: Readonly<ProviderTransportFailure>,
): Error {
  const error = new Error(message || (reason === 'aborted' ? 'Model request was aborted.' : 'Model request failed.')) as Error & {
    status?: number;
    code?: string;
  };
  if (reason === 'aborted') error.name = 'AbortError';
  if (reason === 'error' && transportFailure?.status !== undefined) error.status = transportFailure.status;
  if (reason === 'error' && transportFailure?.code) error.code = transportFailure.code;
  return error;
}
