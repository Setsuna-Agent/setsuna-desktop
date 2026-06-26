import type { ModelRequest, RuntimeToolCall } from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient } from '../../ports/model-client.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  assertOkResponse,
  doneEvent,
  normalizeOpenAiUsage,
  objectValue,
  parseJson,
  parseSse,
  requireFetch,
  stringValue,
  systemText,
  toOpenAiResponsesInput,
  toOpenAiResponsesTools,
  withEndpoint,
  type FetchImpl,
} from './provider-utils.js';
import { openAiResponsesReasoningBody } from './provider-thinking.js';

export class OpenAiResponsesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest) {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const instructions = systemText(request.messages);
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/responses'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.provider.apiKey}`,
      },
      signal: request.signal,
      body: JSON.stringify({
        model: activeModel?.code || request.model,
        input: toOpenAiResponsesInput(request.messages),
        stream: true,
        max_output_tokens: request.maxOutputTokens ?? activeModel?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(instructions ? { instructions } : {}),
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        ...(request.tools?.length ? { tools: toOpenAiResponsesTools(request.tools) } : {}),
        ...(request.toolChoice ? { tool_choice: request.toolChoice } : {}),
        ...openAiResponsesReasoningBody(this.provider, request),
      }),
    });
    await assertOkResponse(response, 'OpenAI Responses request failed');

    let usage = undefined;
    let finishReason = undefined;
    const toolCalls = new Map<string, RuntimeToolCall>();
    let toolCallsYielded = false;
    for await (const { event, data } of parseSse(response)) {
      if (data === '[DONE]') break;
      const payload = objectValue(parseJson(data));
      const type = stringValue(payload.type) || event || '';
      if (type === 'response.output_text.delta') {
        const text = stringValue(payload.delta);
        if (text) yield { type: 'text_delta' as const, text };
      } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        const text = stringValue(payload.delta);
        if (text) yield { type: 'reasoning_delta' as const, text };
      } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const toolCall = mergeResponsesOutputItem(toolCalls, payload);
        if (toolCall) {
          yield {
            type: 'tool_call_delta' as const,
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: toolCall.arguments },
          };
        }
        if (type === 'response.output_item.done') {
          const calls = [...toolCalls.values()].filter((call) => call.name);
          if (calls.length) {
            toolCallsYielded = true;
            yield { type: 'tool_calls' as const, toolCalls: calls };
          }
        }
      } else if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
        const toolCall = mergeResponsesArguments(toolCalls, payload);
        if (toolCall) {
          yield {
            type: 'tool_call_delta' as const,
            call: { id: toolCall.id, name: toolCall.name, argumentsDelta: stringValue(payload.delta) },
          };
        }
      } else if (type === 'response.completed') {
        const responsePayload = objectValue(payload.response);
        usage = normalizeOpenAiUsage(responsePayload.usage);
        finishReason = stringValue(responsePayload.status) || 'stop';
      } else if (type === 'response.failed' || type === 'error') {
        throw new Error(openAiResponsesErrorMessage(payload));
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

function mergeResponsesOutputItem(toolCalls: Map<string, RuntimeToolCall>, payload: Record<string, unknown>): RuntimeToolCall | null {
  const item = objectValue(payload.item);
  if (stringValue(item.type) !== 'function_call') return null;
  const id = stringValue(item.call_id) || stringValue(item.id) || `call_${toolCalls.size}`;
  const existing = toolCalls.get(id) ?? { id, name: '', arguments: '' };
  const next = {
    id,
    name: stringValue(item.name) || existing.name,
    arguments: stringValue(item.arguments) || existing.arguments,
  };
  toolCalls.set(id, next);
  return next;
}

function mergeResponsesArguments(toolCalls: Map<string, RuntimeToolCall>, payload: Record<string, unknown>): RuntimeToolCall | null {
  const id = stringValue(payload.call_id) || stringValue(payload.item_id) || `call_${toolCalls.size}`;
  const existing = toolCalls.get(id) ?? { id, name: '', arguments: '' };
  const next = {
    ...existing,
    arguments: `${existing.arguments}${stringValue(payload.delta)}`,
  };
  toolCalls.set(id, next);
  return next;
}

function openAiResponsesErrorMessage(payload: Record<string, unknown>): string {
  const error = objectValue(payload.error);
  return stringValue(error.message) || stringValue(payload.message) || 'OpenAI Responses stream failed.';
}
