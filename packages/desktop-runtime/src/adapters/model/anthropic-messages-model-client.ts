import type { ModelRequest, RuntimeToolCall } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  assertOkResponse,
  doneEvent,
  normalizeAnthropicUsage,
  objectValue,
  parseJson,
  parseSse,
  requireFetch,
  stringValue,
  systemText,
  toAnthropicMessages,
  toAnthropicTools,
  withEndpoint,
  type FetchImpl,
} from './provider-utils.js';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export class AnthropicMessagesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest) {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const system = systemText(request.messages);
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.provider.apiKey,
        'anthropic-version': DEFAULT_ANTHROPIC_VERSION,
      },
      signal: request.signal,
      body: JSON.stringify({
        model: activeModel?.code || request.model,
        messages: toAnthropicMessages(request.messages),
        max_tokens: request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        ...(system ? { system } : {}),
        ...(request.tools?.length ? { tools: toAnthropicTools(request.tools) } : {}),
        ...(request.toolChoice && request.toolChoice !== 'none' ? { tool_choice: { type: 'auto' } } : {}),
      }),
    });
    await assertOkResponse(response, 'Anthropic Messages request failed');

    let usage = undefined;
    let finishReason = undefined;
    const toolCalls = new Map<number, RuntimeToolCall>();
    let toolCallsYielded = false;
    for await (const { event, data } of parseSse(response)) {
      const payload = objectValue(parseJson(data));
      const type = stringValue(payload.type) || event || '';
      if (type === 'content_block_start') {
        const toolCall = mergeAnthropicBlockStart(toolCalls, payload);
        if (toolCall) {
          yield {
            type: 'tool_call_delta' as const,
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: toolCall.arguments },
          };
        }
      } else if (type === 'content_block_delta') {
        const delta = objectValue(payload.delta);
        const text = stringValue(delta.text);
        if (text) yield { type: 'text_delta' as const, text };
        const toolCall = mergeAnthropicInputDelta(toolCalls, payload);
        if (toolCall) {
          yield {
            type: 'tool_call_delta' as const,
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: stringValue(delta.partial_json) },
          };
        }
      } else if (type === 'message_delta') {
        const delta = objectValue(payload.delta);
        usage = normalizeAnthropicUsage(payload.usage);
        finishReason = stringValue(delta.stop_reason) || finishReason;
        if (finishReason === 'tool_use') {
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
    if (!toolCallsYielded && toolCalls.size) {
      const calls = [...toolCalls.values()].filter((call) => call.name);
      if (calls.length) yield { type: 'tool_calls' as const, toolCalls: calls };
    }
    if (usage) yield { type: 'usage' as const, usage: { ...usage, provider: this.provider.provider, model: activeModel?.code } };
    yield doneEvent(finishReason);
  }
}

function mergeAnthropicBlockStart(toolCalls: Map<number, RuntimeToolCall>, payload: Record<string, unknown>): RuntimeToolCall | null {
  const block = objectValue(payload.content_block);
  if (stringValue(block.type) !== 'tool_use') return null;
  const index = typeof payload.index === 'number' ? payload.index : toolCalls.size;
  const input = block.input === undefined ? '' : JSON.stringify(block.input);
  const next = {
    id: stringValue(block.id) || `toolu_${index}`,
    name: stringValue(block.name),
    arguments: input === '{}' ? '' : input,
  };
  toolCalls.set(index, next);
  return next;
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
