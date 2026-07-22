import type {
  ModelRequest,
  ModelStreamEvent,
  RuntimeModelVerification,
  RuntimeSafetyBuffering,
  RuntimeStreamItem,
  RuntimeToolCall,
} from '@setsuna-desktop/contracts';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import type { ModelClient, ModelCompactionRequest, ModelCompactionResult } from '../../ports/model-client.js';
import { openAiResponsesReasoningBody } from './provider-thinking.js';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  assertOkResponse,
  bearerAuthHeader,
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

export class OpenAiResponsesModelClient implements ModelClient {
  constructor(
    private readonly provider: RuntimeProviderConfig,
    private readonly fetchImpl: FetchImpl = globalThis.fetch,
  ) {}

  async *stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent> {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const instructions = systemText(request.messages);
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/responses'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearerAuthHeader(this.provider.apiKey),
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
        ...(request.toolChoice ? { tool_choice: toOpenAiResponsesToolChoice(request.toolChoice) } : {}),
        ...openAiResponsesReasoningBody(this.provider, request),
      }),
    });
    await assertOkResponse(response, 'OpenAI Responses request failed');

    let usage = undefined;
    let finishReason = undefined;
    const requestedModel = activeModel?.code || request.model;
    let lastServerModel = '';
    const toolCalls = new Map<string, RuntimeToolCall>();
    const toolCallIdByItemId = new Map<string, string>();
    let toolCallsYielded = false;
    let nativeToolCallsCompleted = false;
    const nativeToolItemIds = new Set<string>();
    const completedItemIds = new Set<string>();
    const reasoningTextByItemId = new Map<string, string>();
    let currentAgentItemId = '';
    let currentReasoningItemId = '';
    for await (const { event, data } of parseSse(response)) {
      if (data === '[DONE]') break;
      const payload = objectValue(parseJson(data));
      const type = stringValue(payload.type) || event || '';
      const serverModel = responsesServerModel(payload);
      if (serverModel && serverModel !== lastServerModel) {
        lastServerModel = serverModel;
        if (serverModel !== requestedModel) {
          yield {
            type: 'model_verification' as const,
            verification: {
              model: requestedModel,
              provider: this.provider.provider,
              serverModel,
              warnings: ['server_model_mismatch'],
            },
          };
        }
      }
      for (const verification of responsesMetadataVerifications(payload, this.provider.provider, requestedModel)) {
        yield { type: 'model_verification' as const, verification };
      }
      const safetyBuffering = responsesSafetyBuffering(payload, requestedModel);
      if (safetyBuffering) yield { type: 'safety_buffering' as const, buffering: safetyBuffering };
      if (type === 'response.output_text.delta') {
        const text = stringValue(payload.delta);
        if (text) {
          const itemId = stringValue(payload.item_id) || currentAgentItemId;
          if (itemId) {
            yield { type: 'item_delta' as const, itemId, delta: text };
          } else {
            yield { type: 'text_delta' as const, text };
          }
        }
      } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        const text = stringValue(payload.delta);
        if (text) {
          const itemId = stringValue(payload.item_id) || currentReasoningItemId || undefined;
          if (itemId) reasoningTextByItemId.set(itemId, `${reasoningTextByItemId.get(itemId) ?? ''}${text}`);
          if (type === 'response.reasoning_summary_text.delta') {
            yield { type: 'reasoning_summary_delta' as const, itemId, text, summaryIndex: numberValue(payload.summary_index) ?? 0 };
          } else {
            yield { type: 'reasoning_raw_delta' as const, itemId, text, contentIndex: numberValue(payload.content_index) ?? 0 };
          }
        }
      } else if (type === 'response.reasoning_summary_part.added') {
        yield {
          type: 'reasoning_summary_part_added' as const,
          itemId: stringValue(payload.item_id) || currentReasoningItemId || undefined,
          summaryIndex: numberValue(payload.summary_index) ?? 0,
        };
      } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        const streamItem = responsesStreamItem(payload, type);
        if (streamItem) {
          if (streamItem.kind === 'agent_message') currentAgentItemId = streamItem.id;
          if (streamItem.kind === 'reasoning') currentReasoningItemId = streamItem.id;
          if (streamItem.kind === 'tool_call') nativeToolItemIds.add(streamItem.id);
          if (type === 'response.output_item.added') {
            yield { type: 'item_started' as const, item: streamItem };
          } else if (!completedItemIds.has(streamItem.id)) {
            completedItemIds.add(streamItem.id);
            yield { type: 'item_completed' as const, item: streamItem };
          }
        }
        const toolCall = mergeResponsesOutputItem(toolCalls, toolCallIdByItemId, payload);
        if (toolCall) {
          if (type === 'response.output_item.done') {
            nativeToolCallsCompleted = true;
            const calls = [...toolCalls.values()].filter((call) => call.name);
            toolCallsYielded = true;
            if (!streamItem) yield { type: 'tool_calls' as const, toolCalls: calls };
          }
        }
      } else if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
        const toolCall = mergeResponsesArguments(toolCalls, toolCallIdByItemId, payload);
        if (type === 'response.function_call_arguments.done') {
          if (toolCall?.name && !nativeToolCallsCompleted && !nativeToolItemIds.has(toolCall.id)) {
            toolCallsYielded = true;
            yield { type: 'tool_calls' as const, toolCalls: [toolCall] };
          }
        } else if (!nativeToolCallsCompleted) {
          if (toolCall) {
            yield {
              type: 'tool_call_delta' as const,
              call: { id: toolCall.id, name: toolCall.name, argumentsDelta: stringValue(payload.delta) },
            };
          }
        }
      } else if (type === 'response.output_text.done') {
        const itemId = stringValue(payload.item_id) || currentAgentItemId;
        const text = stringValue(payload.text);
        if (itemId && !completedItemIds.has(itemId)) {
          completedItemIds.add(itemId);
          yield {
            type: 'item_completed' as const,
            item: { id: itemId, kind: 'agent_message', content: text, status: 'completed' },
          };
        }
      } else if (type === 'response.reasoning_summary_text.done' || type === 'response.reasoning_text.done') {
        const itemId = stringValue(payload.item_id) || currentReasoningItemId;
        if (itemId && !completedItemIds.has(itemId)) {
          const text = stringValue(payload.text) || reasoningTextByItemId.get(itemId) || '';
          completedItemIds.add(itemId);
          yield {
            type: 'item_completed' as const,
            item: { id: itemId, kind: 'reasoning', content: text, status: 'completed' },
          };
        }
      } else if (type === 'response.completed' || type === 'response.incomplete') {
        const responsePayload = objectValue(payload.response);
        usage = normalizeOpenAiUsage(responsePayload.usage);
        finishReason = type === 'response.incomplete'
          ? stringValue(objectValue(responsePayload.incomplete_details).reason) || stringValue(responsePayload.status) || 'incomplete'
          : stringValue(responsePayload.status) || 'stop';
      } else if (type === 'response.failed' || type === 'error') {
        throw new Error(openAiResponsesErrorMessage(payload));
      }
    }
    if (!toolCallsYielded && !nativeToolCallsCompleted && toolCalls.size) {
      const calls = [...toolCalls.values()].filter((call) => call.name);
      if (calls.length) yield { type: 'tool_calls' as const, toolCalls: calls };
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

  async compactConversation(request: ModelCompactionRequest): Promise<ModelCompactionResult> {
    const fetcher = requireFetch(this.fetchImpl);
    const activeModel = this.provider.activeModel;
    const instructions = systemText(request.messages);
    const response = await fetcher(withEndpoint(this.provider.baseUrl, '/responses/compact'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearerAuthHeader(this.provider.apiKey),
      },
      signal: request.signal,
      body: JSON.stringify({
        model: activeModel?.code || request.model,
        input: [
          ...toOpenAiResponsesInput(request.messages),
          { type: 'compaction_trigger' },
        ],
        ...(instructions ? { instructions } : {}),
        ...(request.tools?.length ? { tools: toOpenAiResponsesTools(request.tools) } : {}),
        ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
      }),
    });
    await assertOkResponse(response, 'OpenAI Responses compact request failed');

    const payload = objectValue(await response.json().catch(() => null));
    const summary = responsesCompactionSummary(payload);
    if (!summary) throw new Error('OpenAI Responses compact response did not include a readable summary.');
    const responsePayload = objectValue(payload.response);
    const usage = normalizeOpenAiUsage(payload.usage ?? responsePayload.usage);
    return {
      summary,
      ...(usage ? {
        usage: {
          ...usage,
          providerId: this.provider.id,
          provider: this.provider.name,
          model: activeModel?.code,
        },
      } : {}),
    };
  }
}

function toOpenAiResponsesToolChoice(toolChoice: ModelRequest['toolChoice']) {
  if (!toolChoice || toolChoice === 'auto' || toolChoice === 'none') return toolChoice;
  return { type: 'function', name: toolChoice.name };
}

function responsesStreamItem(payload: Record<string, unknown>, eventType: string): RuntimeStreamItem | null {
  const item = objectValue(payload.item);
  const type = stringValue(item.type);
  const status = eventType === 'response.output_item.done' ? 'completed' : 'in_progress';
  if (type === 'message') {
    const id = stringValue(item.id) || responseOutputItemFallbackId(payload, 'message');
    return {
      id,
      kind: 'agent_message',
      content: responsesMessageText(item),
      status,
    };
  }
  if (type === 'reasoning') {
    const id = stringValue(item.id) || responseOutputItemFallbackId(payload, 'reasoning');
    return {
      id,
      kind: 'reasoning',
      content: responsesReasoningText(item),
      status,
    };
  }
  if (type === 'function_call') {
    const toolCall = responsesToolCall(item, payload);
    return {
      id: toolCall.id,
      kind: 'tool_call',
      status,
      toolCall,
    };
  }
  if (type === 'collab_tool_call' || type === 'collabToolCall') {
    const collabToolCall = responsesCollabToolCall(item);
    if (!collabToolCall) return null;
    return {
      id: stringValue(item.id) || responseOutputItemFallbackId(payload, 'collab'),
      kind: 'collab_tool_call',
      status: responsesItemStatus(item, status),
      collabToolCall,
    };
  }
  return null;
}

function responseOutputItemFallbackId(payload: Record<string, unknown>, prefix: string): string {
  const outputIndex = typeof payload.output_index === 'number' ? payload.output_index : undefined;
  return outputIndex === undefined ? `${prefix}_item` : `${prefix}_${outputIndex}`;
}

function responsesToolCall(item: Record<string, unknown>, payload: Record<string, unknown>): RuntimeToolCall {
  const id = stringValue(item.call_id) || stringValue(item.id) || responseOutputItemFallbackId(payload, 'call');
  return {
    id,
    name: stringValue(item.name),
    arguments: stringValue(item.arguments),
  };
}

function responsesCollabToolCall(item: Record<string, unknown>): RuntimeStreamItem['collabToolCall'] | null {
  const tool = stringValue(item.tool);
  if (!isCollabToolName(tool)) return null;
  const senderThreadId = stringValue(item.senderThreadId) || stringValue(item.sender_thread_id);
  if (!senderThreadId) return null;
  return {
    tool,
    senderThreadId,
    receiverThreadId: stringValue(item.receiverThreadId) || stringValue(item.receiver_thread_id) || undefined,
    newThreadId: stringValue(item.newThreadId) || stringValue(item.new_thread_id) || undefined,
    prompt: stringValue(item.prompt) || undefined,
    agentStatus: stringValue(item.agentStatus) || stringValue(item.agent_status) || undefined,
  };
}

function responsesServerModel(payload: Record<string, unknown>): string {
  const response = objectValue(payload.response);
  return headerModelValue(response.headers) || headerModelValue(payload.headers);
}

function headerModelValue(value: unknown): string {
  const headers = objectValue(value);
  for (const [name, headerValue] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (normalizedName === 'openai-model' || normalizedName === 'x-openai-model') {
      return stringOrFirstString(headerValue);
    }
  }
  return '';
}

function responsesMetadataVerifications(payload: Record<string, unknown>, provider: string, model: string): RuntimeModelVerification[] {
  if (stringValue(payload.type) !== 'response.metadata') return [];
  const metadata = objectValue(payload.metadata);
  const recommendations = stringArrayValue(metadata.openai_verification_recommendation);
  if (!recommendations.length) return [];
  return [{ model, provider, warnings: recommendations }];
}

function responsesSafetyBuffering(payload: Record<string, unknown>, model: string): RuntimeSafetyBuffering | null {
  const value = objectValue(payload.safety_buffering);
  if (!Object.keys(value).length) return null;
  return {
    model,
    fasterModel: stringValue(value.retry_model) || stringValue(value.faster_model) || stringValue(value.fasterModel) || undefined,
    reasons: stringArrayValue(value.reasons),
    showBufferingUi: true,
    useCases: stringArrayValue(value.use_cases ?? value.useCases),
  };
}

function stringArrayValue(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function stringOrFirstString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return stringValue(value[0]);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function responsesItemStatus(item: Record<string, unknown>, fallback: RuntimeStreamItem['status']): RuntimeStreamItem['status'] {
  const status = stringValue(item.status);
  if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'in_progress') return status;
  return fallback;
}

function isCollabToolName(value: string): value is NonNullable<RuntimeStreamItem['collabToolCall']>['tool'] {
  return value === 'spawn_agent' || value === 'send_input' || value === 'resume_agent' || value === 'wait' || value === 'close_agent';
}

function responsesMessageText(item: Record<string, unknown>): string {
  const content = item.content;
  if (!Array.isArray(content)) return stringValue(item.text);
  return content
    .map((part) => {
      const record = objectValue(part);
      return stringValue(record.text);
    })
    .join('');
}

function responsesReasoningText(item: Record<string, unknown>): string {
  const summary = item.summary;
  if (Array.isArray(summary)) {
    return summary.map((part) => stringValue(objectValue(part).text)).join('');
  }
  return stringValue(item.text);
}

function mergeResponsesOutputItem(
  toolCalls: Map<string, RuntimeToolCall>,
  toolCallIdByItemId: Map<string, string>,
  payload: Record<string, unknown>,
): RuntimeToolCall | null {
  const item = objectValue(payload.item);
  if (stringValue(item.type) !== 'function_call') return null;
  const itemId = stringValue(item.id);
  const id = stringValue(item.call_id) || toolCallIdByItemId.get(itemId) || itemId || `call_${toolCalls.size}`;
  if (itemId) toolCallIdByItemId.set(itemId, id);
  const itemIdEntry = itemId && itemId !== id ? toolCalls.get(itemId) : undefined;
  const existing = toolCalls.get(id) ?? itemIdEntry ?? { id, name: '', arguments: '' };
  const next = {
    id,
    name: stringValue(item.name) || existing.name,
    arguments: stringValue(item.arguments) || existing.arguments,
  };
  if (itemIdEntry) toolCalls.delete(itemId);
  toolCalls.set(id, next);
  return next;
}

function mergeResponsesArguments(
  toolCalls: Map<string, RuntimeToolCall>,
  toolCallIdByItemId: Map<string, string>,
  payload: Record<string, unknown>,
): RuntimeToolCall {
  const itemId = stringValue(payload.item_id);
  const id = stringValue(payload.call_id) || toolCallIdByItemId.get(itemId) || itemId || `call_${toolCalls.size}`;
  if (itemId) toolCallIdByItemId.set(itemId, id);
  const existing = toolCalls.get(id) ?? { id, name: '', arguments: '' };
  const completedArguments = stringValue(payload.arguments);
  const next = {
    ...existing,
    arguments: completedArguments || `${existing.arguments}${stringValue(payload.delta)}`,
  };
  toolCalls.set(id, next);
  return next;
}

function openAiResponsesErrorMessage(payload: Record<string, unknown>): string {
  const error = objectValue(payload.error);
  return stringValue(error.message) || stringValue(payload.message) || 'OpenAI Responses stream failed.';
}

function responsesCompactionSummary(payload: Record<string, unknown>): string {
  return compactionSummaryFromValue(payload)
    || compactionSummaryFromValue(objectValue(payload.response))
    || firstCompactionSummaryFromArray(payload.output)
    || firstCompactionSummaryFromArray(payload.items)
    || firstCompactionSummaryFromArray(payload.data)
    || '';
}

function firstCompactionSummaryFromArray(value: unknown): string {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const summary = compactionSummaryFromValue(item);
    if (summary) return summary;
  }
  return '';
}

function compactionSummaryFromValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const item = objectValue(value);
  const direct = stringValue(item.summary)
    || stringValue(item.message)
    || stringValue(item.text)
    || stringValue(item.output_text);
  if (direct.trim()) return direct.trim();
  const type = stringValue(item.type);
  if (type === 'compaction' || type === 'compaction_summary' || type === 'context_compaction') {
    const readable = stringValue(item.summary) || stringValue(item.message) || stringValue(item.text);
    if (readable.trim()) return readable.trim();
  }
  const contentText = compactionContentText(item.content);
  if (contentText) return contentText;
  return '';
}

function compactionContentText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      const record = objectValue(part);
      return stringValue(record.text);
    })
    .filter(Boolean)
    .join('')
    .trim();
}
