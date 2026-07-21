import type { ModelRequest, ModelStreamEvent, RuntimeAnthropicContentBlock, RuntimeStreamItem, RuntimeToolCall } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
  anthropicApiKeyHeader,
  assertOkResponse,
  doneEvent,
  normalizeAnthropicUsage,
  objectValue,
  parseJson,
  parseSse,
  requireFetch,
  stringValue,
  systemAndDeveloperText,
  toAnthropicMessages,
  toAnthropicTools,
  withEndpoint,
  type FetchImpl,
} from './provider-utils.js';
import { anthropicThinkingBody } from './provider-thinking.js';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicMessagesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const system = systemAndDeveloperText(request.messages);
    const maxOutputTokens = request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS;
    const thinking = anthropicThinkingBody(this.provider, { ...request, maxOutputTokens });
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': DEFAULT_ANTHROPIC_VERSION,
        ...anthropicApiKeyHeader(this.provider.apiKey),
      },
      signal: request.signal,
      body: JSON.stringify({
        model: activeModel?.code || request.model,
        messages: toAnthropicMessages(request.messages),
        max_tokens: maxOutputTokens,
        stream: true,
        ...(system ? { system } : {}),
        ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {}),
        ...(request.toolChoice && request.toolChoice !== 'none' ? { tool_choice: toAnthropicToolChoice(request.toolChoice) } : {}),
        ...(thinking ? { thinking } : {}),
      }),
    });
    await assertOkResponse(response, 'Anthropic Messages request failed');

    let usage = undefined;
    let finishReason = undefined;
    const toolCalls = new Map<number, RuntimeToolCall>();
    let toolCallsYielded = false;
    let nativeToolItems = false;
    const blocks = new Map<number, AnthropicBlockState>();
    const completedContentBlocks: RuntimeAnthropicContentBlock[] = [];
    for await (const { event, data } of parseSse(response)) {
      const payload = objectValue(parseJson(data));
      const type = stringValue(payload.type) || event || '';
      if (type === 'message_start') {
        usage = mergeAnthropicUsage(usage, normalizeAnthropicUsage(objectValue(payload.message).usage));
      } else if (type === 'content_block_start') {
        const blockState = anthropicBlockState(payload);
        if (blockState) {
          blocks.set(blockState.index, blockState);
          if (blockState.item.kind === 'tool_call') nativeToolItems = true;
          yield { type: 'item_started' as const, item: cloneRuntimeStreamItem(blockState.item) };
          if (blockState.item.kind === 'tool_call' && blockState.item.toolCall?.arguments) {
            yield {
              type: 'tool_call_delta' as const,
              call: {
                id: blockState.item.toolCall.id,
                name: blockState.item.toolCall.name,
                argumentsDelta: blockState.item.toolCall.arguments,
              },
            };
          }
        }
      } else if (type === 'content_block_delta') {
        const delta = objectValue(payload.delta);
        const index = typeof payload.index === 'number' ? payload.index : undefined;
        const blockState = index === undefined ? null : blocks.get(index) ?? null;
        const text = stringValue(delta.text);
        const thinking = stringValue(delta.thinking);
        const signature = stringValue(delta.signature);
        const partialJson = stringValue(delta.partial_json);
        if (blockState?.item.kind === 'reasoning' && thinking) {
          blockState.content += thinking;
          yield { type: 'reasoning_raw_delta' as const, itemId: blockState.item.id, text: thinking, contentIndex: 0 };
        } else if (thinking) {
          yield { type: 'reasoning_delta' as const, text: thinking };
        }
        if (blockState?.contentBlock.type === 'thinking' && signature) {
          blockState.contentBlock.signature += signature;
        }
        if (blockState?.item.kind === 'agent_message' && text) {
          blockState.content += text;
          yield { type: 'item_delta' as const, itemId: blockState.item.id, delta: text };
        } else if (text) {
          yield { type: 'text_delta' as const, text };
        }
        if (blockState?.item.kind === 'tool_call' && partialJson) {
          const toolCall = blockState.item.toolCall ?? { id: blockState.item.id, name: blockState.item.name ?? '', arguments: '' };
          toolCall.arguments = `${toolCall.arguments}${partialJson}`;
          blockState.item.toolCall = toolCall;
          toolCalls.set(blockState.index, toolCall);
          yield {
            type: 'tool_call_delta' as const,
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: partialJson },
          };
        } else if (!blockState) {
          const toolCall = mergeAnthropicInputDelta(toolCalls, payload);
          if (toolCall) {
            yield {
              type: 'tool_call_delta' as const,
              call: { id: toolCall.id, name: toolCall.name, argumentsDelta: partialJson },
            };
          }
        }
      } else if (type === 'content_block_stop') {
        const index = typeof payload.index === 'number' ? payload.index : undefined;
        const blockState = index === undefined ? null : blocks.get(index) ?? null;
        if (blockState) {
          blocks.delete(blockState.index);
          completedContentBlocks.push(completedAnthropicContentBlock(blockState));
          yield { type: 'item_completed' as const, item: completedAnthropicBlockItem(blockState) };
        }
      } else if (type === 'message_delta') {
        const delta = objectValue(payload.delta);
        usage = mergeAnthropicUsage(usage, normalizeAnthropicUsage(payload.usage));
        finishReason = stringValue(delta.stop_reason) || finishReason;
        if (finishReason === 'tool_use' && !nativeToolItems) {
          const calls = [...toolCalls.values()].filter((call) => call.name);
          if (calls.length) {
            toolCallsYielded = true;
            yield { type: 'tool_calls' as const, toolCalls: calls };
          }
        }
      } else if (type === 'message_stop') {
        break;
      } else if (type === 'error') {
        const error = objectValue(payload.error);
        throw new Error(stringValue(error.message) || 'Anthropic Messages stream failed.');
      }
    }
    if (!toolCallsYielded && !nativeToolItems && toolCalls.size) {
      const calls = [...toolCalls.values()].filter((call) => call.name);
      if (calls.length) yield { type: 'tool_calls' as const, toolCalls: calls };
    }
    if (shouldPreserveAnthropicContentBlocks(completedContentBlocks)) {
      yield {
        type: 'assistant_metadata' as const,
        providerMetadata: { anthropic: { contentBlocks: completedContentBlocks } },
      };
    }
    if (usage) {
      yield {
        type: 'usage' as const,
        usage: {
          ...usage,
          providerId: this.provider.id,
          provider: this.provider.name,
          model: activeModel?.code,
        },
      };
    }
    yield doneEvent(finishReason);
  }
}

/** Anthropic 在 message_start 报告输入用量，在 message_delta 报告输出用量。 */
function mergeAnthropicUsage(
  previous: ReturnType<typeof normalizeAnthropicUsage>,
  next: ReturnType<typeof normalizeAnthropicUsage>,
): ReturnType<typeof normalizeAnthropicUsage> {
  if (!next) return previous;
  const inputTokens = next.inputTokens ?? previous?.inputTokens;
  const cachedInputTokens = next.cachedInputTokens ?? previous?.cachedInputTokens;
  const outputTokens = next.outputTokens ?? previous?.outputTokens;
  return {
    ...previous,
    ...next,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined,
  };
}

function toAnthropicToolChoice(toolChoice: Exclude<ModelRequest['toolChoice'], undefined | 'none'>) {
  if (toolChoice === 'auto') return { type: 'auto' };
  return { type: 'tool', name: toolChoice.name };
}

type AnthropicBlockState = {
  contentBlock: RuntimeAnthropicContentBlock;
  content: string;
  index: number;
  item: RuntimeStreamItem;
};

function anthropicBlockState(payload: Record<string, unknown>): AnthropicBlockState | null {
  const block = objectValue(payload.content_block);
  const type = stringValue(block.type);
  const index = typeof payload.index === 'number' ? payload.index : 0;
  if (type === 'text') {
    const content = stringValue(block.text);
    return {
      content,
      contentBlock: { type: 'text', text: content },
      index,
      item: { id: `content_${index}`, kind: 'agent_message', content, status: 'in_progress' },
    };
  }
  if (type === 'thinking') {
    const content = stringValue(block.thinking);
    return {
      content,
      contentBlock: {
        type: 'thinking',
        thinking: content,
        signature: stringValue(block.signature),
      },
      index,
      item: { id: `reasoning_${index}`, kind: 'reasoning', content, status: 'in_progress' },
    };
  }
  if (type === 'redacted_thinking') {
    return {
      content: '',
      contentBlock: { type: 'redacted_thinking', data: stringValue(block.data) },
      index,
      item: { id: `reasoning_${index}`, kind: 'reasoning', content: '', status: 'in_progress' },
    };
  }
  if (type === 'tool_use') {
    const input = block.input === undefined ? '' : JSON.stringify(block.input);
    const toolCall = {
      id: stringValue(block.id) || `toolu_${index}`,
      name: stringValue(block.name),
      arguments: input === '{}' ? '' : input,
    };
    return {
      content: '',
      contentBlock: {
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: block.input ?? {},
      },
      index,
      item: { id: toolCall.id, kind: 'tool_call', name: toolCall.name, status: 'in_progress', toolCall },
    };
  }
  return null;
}

function completedAnthropicContentBlock(blockState: AnthropicBlockState): RuntimeAnthropicContentBlock {
  const block = blockState.contentBlock;
  if (block.type === 'thinking') return { ...block, thinking: blockState.content };
  if (block.type === 'text') return { ...block, text: blockState.content };
  if (block.type === 'tool_use') {
    return {
      ...block,
      input: parseAnthropicToolInput(blockState.item.toolCall?.arguments ?? ''),
    };
  }
  return { ...block };
}

function parseAnthropicToolInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) return {};
  try {
    return JSON.parse(argumentsText) as unknown;
  } catch {
    return {};
  }
}

function shouldPreserveAnthropicContentBlocks(blocks: RuntimeAnthropicContentBlock[]): boolean {
  return blocks.some((block) => block.type === 'tool_use')
    && blocks.some((block) => block.type === 'thinking' || block.type === 'redacted_thinking');
}

function completedAnthropicBlockItem(blockState: AnthropicBlockState): RuntimeStreamItem {
  const item = blockState.item;
  if (item.kind === 'tool_call') {
    return cloneRuntimeStreamItem({
      ...item,
      status: 'completed',
      toolCall: item.toolCall,
    });
  }
  return cloneRuntimeStreamItem({
    ...item,
    content: blockState.content,
    status: 'completed',
  });
}

function cloneRuntimeStreamItem(item: RuntimeStreamItem): RuntimeStreamItem {
  return {
    ...item,
    ...(item.toolCall ? { toolCall: { ...item.toolCall } } : {}),
  };
}

function mergeAnthropicInputDelta(toolCalls: Map<number, RuntimeToolCall>, payload: Record<string, unknown>): RuntimeToolCall | null {
  const index = typeof payload.index === 'number' ? payload.index : toolCalls.size;
  const delta = objectValue(payload.delta);
  const partialJson = stringValue(delta.partial_json);
  if (!partialJson) return null;
  const existing = toolCalls.get(index) ?? { id: `toolu_${index}`, name: '', arguments: '' };
  const next = {
    ...existing,
    arguments: `${existing.arguments}${partialJson}`,
  };
  toolCalls.set(index, next);
  return next;
}
