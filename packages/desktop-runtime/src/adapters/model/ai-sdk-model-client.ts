import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  jsonSchema,
  streamText,
  type FinishReason,
  type AssistantContent,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
  type ToolChoice,
  type ToolSet,
  type UserContent,
} from 'ai';
import type { ModelRequest, ModelStreamEvent, RuntimeMessage, RuntimeStreamItem, RuntimeToolCall, RuntimeToolDefinition } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  doneEvent,
  requireFetch,
  stringValue,
  type FetchImpl,
} from './provider-utils.js';
import { openAiCompatibleAiSdkProviderOptions } from './provider-thinking.js';

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type AiSdkStreamItemState = {
  agentItemId: string | null;
  agentText: string;
  reasoningItemId: string | null;
  reasoningText: string;
  toolItemsStarted: Set<string>;
  toolItemsCompleted: Set<string>;
};

type ProviderOptionJson = string | number | boolean | null | ProviderOptionJson[] | { [key: string]: ProviderOptionJson };

export class AiSdkOpenAiCompatibleModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const activeModel = this.provider.activeModel;
    const modelId = activeModel?.code || request.model;
    const providerName = this.provider.name || this.provider.id;
    const provider = createOpenAICompatible({
      name: providerName,
      baseURL: normalizeOpenAiCompatibleBaseUrl(this.provider.baseUrl),
      ...(this.provider.apiKey ? { apiKey: this.provider.apiKey } : {}),
      fetch: (input, init) => requireFetch(this.fetchImpl)(input instanceof URL ? input : String(input), init),
      includeUsage: true,
    });
    const thinkingProviderOptions = toThinkingProviderOptions(providerName, openAiCompatibleAiSdkProviderOptions(this.provider, request));
    const result = streamText({
      model: provider.chatModel(modelId),
      instructions: toAiSdkInstructions(request.messages),
      messages: toAiSdkMessages(request.messages),
      tools: toAiSdkTools(request.tools),
      toolChoice: toAiSdkToolChoice(request.toolChoice),
      maxOutputTokens: request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
      ...(thinkingProviderOptions ? { providerOptions: thinkingProviderOptions } : {}),
      abortSignal: request.signal,
      maxRetries: 0,
    });

    const toolCalls = new Map<string, PendingToolCall>();
    const toolInputsStreamed = new Set<string>();
    let toolCallsYielded = false;
    let finishReason: FinishReason | undefined;
    let usage: LanguageModelUsage | undefined;
    const streamItems = createAiSdkStreamItemState();

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        yield* aiSdkAgentItemDelta(streamItems, part.text);
      } else if (part.type === 'reasoning-delta') {
        yield* aiSdkReasoningItemDelta(streamItems, part.text);
      } else if (part.type === 'tool-input-start') {
        const toolCall = upsertToolCall(toolCalls, part.id, { name: part.toolName });
        yield* aiSdkToolItemStarted(streamItems, toolCall);
      } else if (part.type === 'tool-input-delta') {
        const toolCall = upsertToolCall(toolCalls, part.id, { argumentsDelta: part.delta });
        toolInputsStreamed.add(part.id);
        yield {
          type: 'tool_call_delta',
          call: { id: toolCall.id, name: toolCall.name, argumentsDelta: part.delta },
        };
      } else if (part.type === 'tool-call') {
        const input = stringifyToolInput(part.input);
        const toolCall = upsertToolCall(toolCalls, part.toolCallId, {
          name: part.toolName,
          arguments: input,
        });
        yield* aiSdkToolItemStarted(streamItems, toolCall);
        if (!toolInputsStreamed.has(part.toolCallId)) {
          yield {
            type: 'tool_call_delta',
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: input },
          };
        }
        yield* aiSdkToolItemCompleted(streamItems, toolCall);
      } else if (part.type === 'finish-step') {
        finishReason = part.finishReason;
        usage = part.usage;
        if (part.finishReason === 'tool-calls' && shouldYieldAiSdkToolCallsFallback(streamItems, toolCalls)) {
          toolCallsYielded = true;
          yield { type: 'tool_calls', toolCalls: completeToolCalls(toolCalls) };
        }
      } else if (part.type === 'finish') {
        finishReason = part.finishReason;
        usage = part.totalUsage;
      } else if (part.type === 'error') {
        throw toError(part.error);
      } else {
        ignoreStreamPart(part);
      }
    }

    yield* completeAiSdkTextItems(streamItems);
    if (!toolCallsYielded && shouldYieldAiSdkToolCallsFallback(streamItems, toolCalls)) {
      yield { type: 'tool_calls', toolCalls: completeToolCalls(toolCalls) };
    }
    if (usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          provider: this.provider.provider,
          model: modelId,
        },
      };
    }
    yield doneEvent(finishReason);
  }
}

function normalizeOpenAiCompatibleBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

function toThinkingProviderOptions(providerName: string, thinkingOptions: Record<string, unknown>): Record<string, Record<string, ProviderOptionJson>> | undefined {
  const providerOptionsName = providerName.split('.')[0]?.trim();
  if (!providerOptionsName || !Object.keys(thinkingOptions).length) return undefined;
  const jsonOptions = toProviderOptionRecord(thinkingOptions);
  if (!Object.keys(jsonOptions).length) return undefined;
  return { [providerOptionsName]: jsonOptions };
}

function toProviderOptionRecord(value: Record<string, unknown>): Record<string, ProviderOptionJson> {
  const entries = Object.entries(value)
    .map(([key, item]) => [key, toProviderOptionJson(item)] as const)
    .filter((entry): entry is readonly [string, ProviderOptionJson] => entry[1] !== undefined);
  return Object.fromEntries(entries);
}

function toProviderOptionJson(value: unknown): ProviderOptionJson | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(toProviderOptionJson).filter((item): item is ProviderOptionJson => item !== undefined);
  if (value && typeof value === 'object') return toProviderOptionRecord(value as Record<string, unknown>);
  return undefined;
}

function toAiSdkMessages(messages: RuntimeMessage[]): ModelMessage[] {
  const output: ModelMessage[] = [];
  for (const message of messages) {
    if (message.visibility === 'transcript') continue;
    if (message.role === 'system') {
      continue;
    } else if (message.role === 'user') {
      output.push({ role: 'user', content: toAiSdkUserContent(message) });
    } else if (message.role === 'assistant') {
      output.push({ role: 'assistant', content: toAiSdkAssistantContent(message) });
    } else if (message.role === 'tool' && message.toolCallId) {
      output.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: message.toolCallId,
            toolName: message.toolName || 'tool',
            output: { type: 'text', value: message.content },
          },
        ],
      });
    }
  }
  return output;
}

function toAiSdkInstructions(messages: RuntimeMessage[]): string | undefined {
  const instructions = messages
    .filter((message) => message.visibility !== 'transcript' && message.role === 'system' && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n\n');
  return instructions || undefined;
}

function toAiSdkUserContent(message: RuntimeMessage): UserContent {
  if (!message.attachments?.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
    ...message.attachments.map((attachment) => {
      const data = parseDataUrl(attachment.url);
      return {
        type: 'file' as const,
        filename: attachment.name || undefined,
        mediaType: attachment.type || 'application/octet-stream',
        data: data ? { type: 'data' as const, data: data.base64 } : { type: 'url' as const, url: new URL(attachment.url) },
      };
    }),
  ];
}

function toAiSdkAssistantContent(message: RuntimeMessage): AssistantContent {
  if (!message.toolCalls?.length) return message.content;
  return [
    ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
    ...message.toolCalls.map((toolCall) => ({
      type: 'tool-call' as const,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: parseToolInput(toolCall.arguments),
    })),
  ];
}

function toAiSdkTools(tools: RuntimeToolDefinition[] | undefined): ToolSet | undefined {
  if (!tools?.length) return undefined;
  const output: ToolSet = {};
  for (const item of tools) {
    output[item.name] = {
      description: item.description,
      inputSchema: jsonSchema(item.inputSchema as Parameters<typeof jsonSchema>[0]),
    };
  }
  return output;
}

function toAiSdkToolChoice(toolChoice: ModelRequest['toolChoice']): ToolChoice<ToolSet> | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto' || toolChoice === 'none') return toolChoice;
  return { type: 'tool', toolName: toolChoice.name };
}

function upsertToolCall(toolCalls: Map<string, PendingToolCall>, id: string, next: { name?: string; arguments?: string; argumentsDelta?: string }): PendingToolCall {
  const existing = toolCalls.get(id) ?? { id, name: '', arguments: '' };
  const toolCall = {
    id,
    name: next.name || existing.name,
    arguments: next.arguments ?? `${existing.arguments}${next.argumentsDelta ?? ''}`,
  };
  toolCalls.set(id, toolCall);
  return toolCall;
}

function completeToolCalls(toolCalls: Map<string, PendingToolCall>): RuntimeToolCall[] {
  return [...toolCalls.values()].filter((toolCall) => toolCall.name);
}

function createAiSdkStreamItemState(): AiSdkStreamItemState {
  return {
    agentItemId: null,
    agentText: '',
    reasoningItemId: null,
    reasoningText: '',
    toolItemsStarted: new Set(),
    toolItemsCompleted: new Set(),
  };
}

function* aiSdkAgentItemDelta(state: AiSdkStreamItemState, delta: string): Generator<ModelStreamEvent> {
  if (!delta) return;
  if (!state.agentItemId) {
    state.agentItemId = 'ai_sdk_agent_message_0';
    yield {
      type: 'item_started',
      item: { id: state.agentItemId, kind: 'agent_message', content: '', status: 'in_progress' },
    };
  }
  state.agentText += delta;
  yield { type: 'item_delta', itemId: state.agentItemId, delta };
}

function* aiSdkReasoningItemDelta(state: AiSdkStreamItemState, delta: string): Generator<ModelStreamEvent> {
  if (!delta) return;
  if (!state.reasoningItemId) {
    state.reasoningItemId = 'ai_sdk_reasoning_0';
    yield {
      type: 'item_started',
      item: { id: state.reasoningItemId, kind: 'reasoning', content: '', status: 'in_progress' },
    };
  }
  state.reasoningText += delta;
  yield { type: 'reasoning_raw_delta', itemId: state.reasoningItemId, text: delta, contentIndex: 0 };
}

function* aiSdkToolItemStarted(state: AiSdkStreamItemState, toolCall: PendingToolCall): Generator<ModelStreamEvent> {
  if (!toolCall.id || state.toolItemsStarted.has(toolCall.id)) return;
  state.toolItemsStarted.add(toolCall.id);
  yield {
    type: 'item_started',
    item: { id: toolCall.id, kind: 'tool_call', status: 'in_progress', toolCall: { ...toolCall } },
  };
}

function* aiSdkToolItemCompleted(state: AiSdkStreamItemState, toolCall: PendingToolCall): Generator<ModelStreamEvent> {
  if (!toolCall.id || !toolCall.name || state.toolItemsCompleted.has(toolCall.id)) return;
  state.toolItemsCompleted.add(toolCall.id);
  yield {
    type: 'item_completed',
    item: { id: toolCall.id, kind: 'tool_call', status: 'completed', toolCall: { ...toolCall } },
  };
}

function* completeAiSdkTextItems(state: AiSdkStreamItemState): Generator<ModelStreamEvent> {
  if (state.reasoningItemId) {
    yield {
      type: 'item_completed',
      item: { id: state.reasoningItemId, kind: 'reasoning', content: state.reasoningText, status: 'completed' },
    };
  }
  if (state.agentItemId) {
    yield {
      type: 'item_completed',
      item: { id: state.agentItemId, kind: 'agent_message', content: state.agentText, status: 'completed' },
    };
  }
}

function shouldYieldAiSdkToolCallsFallback(state: AiSdkStreamItemState, toolCalls: Map<string, PendingToolCall>): boolean {
  return completeToolCalls(toolCalls).some((toolCall) => !state.toolItemsCompleted.has(toolCall.id));
}

function stringifyToolInput(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}

function parseToolInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return {};
  }
}

function parseDataUrl(value: string): { mediaType: string; base64: string } | null {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], base64: match[2] };
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(stringValue(error) || 'AI SDK stream failed.');
}

function ignoreStreamPart(_part: Exclude<TextStreamPart<ToolSet>, { type: 'text-delta' | 'reasoning-delta' | 'tool-input-start' | 'tool-input-delta' | 'tool-call' | 'finish-step' | 'finish' | 'error' }>): void {}
