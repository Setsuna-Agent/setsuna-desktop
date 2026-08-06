import type {
  ModelStreamEvent,
  RuntimeJsonObject,
  RuntimeModelVerification,
  RuntimeSafetyBuffering,
  RuntimeStreamItem,
} from '@setsuna-desktop/contracts';
import type { TextStreamPart, ToolSet } from 'ai';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import { AiSdkRawEventOrder } from './ai-sdk-raw-event-order.js';
import {
  isOpenAiResponsesOutputItemType,
  openAiResponsesMetadata,
  sanitizeOpenAiResponsesItem,
  sanitizeOpenAiResponsesItems,
} from './openai-responses-provider-metadata.js';
import {
  providerMetadataFitsPersistenceLimit,
  providerMetadataSource,
  type ProviderReplayContext,
} from './provider-replay-context.js';
import { objectValue, stringValue } from './provider-values.js';
import { OpenAiResponsesToolArguments } from './openai-responses-tool-arguments.js';

// Provider output indexes are normally small and zero-based. Compatibility
// indexes live in a separate range so they cannot disturb standard tool calls.
const COMPATIBILITY_OUTPUT_INDEX_BASE = 1_000_000_000;

/**
 * Retains the Responses data that the generic AI SDK stream intentionally does
 * not model: exact replay items plus Setsuna/OpenAI extension events.
 */
export class OpenAiResponsesNativeEvents {
  private readonly eventOrder = new AiSdkRawEventOrder<ModelStreamEvent>();
  private readonly toolArguments = new OpenAiResponsesToolArguments();
  private readonly pendingEvents: ModelStreamEvent[] = [];
  private readonly nativeItems: RuntimeJsonObject[] = [];
  private readonly pendingNativeItemIds = new Set<string>();
  private readonly sdkTextItemIds = new Set<string>();
  private readonly nativeTextItemIds = new Set<string>();
  private readonly completedTextItemIds = new Set<string>();
  private readonly completedReasoningItemIds = new Set<string>();
  private readonly reasoningTextByItemId = new Map<string, string>();
  private readonly refusalTextByItemId = new Map<string, string>();
  private readonly functionCallOutputIndexByItemId = new Map<string, number>();
  private nextCompatibilityOutputIndex = COMPATIBILITY_OUTPUT_INDEX_BASE;
  private nativeEnvelopeComplete = true;
  private responseTerminalSeen = false;
  private responseId = '';
  private currentTextItemId = '';
  private currentReasoningItemId = '';
  private lastServerModel = '';

  constructor(
    private readonly provider: Pick<RuntimeProviderConfig, 'provider'>,
    private readonly replayContext: ProviderReplayContext,
    private readonly requestedModel: string,
  ) {}

  aiSdkPayload(payload: Record<string, unknown>): Record<string, unknown> | null {
    const type = stringValue(payload.type);
    if (
      type === 'response.created'
      || type === 'response.in_progress'
      || type === 'response.queued'
      || type === 'response.metadata'
      || type.startsWith('response.reasoning_')
    ) {
      // These lifecycle events do not create a runtime-visible SDK item. Passing
      // them through would make the raw-event ordering gate hold native reasoning
      // until a later message or tool event, hiding it while the model is thinking.
      return null;
    }
    if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
      return this.refusalPayloadForAiSdk(payload, type);
    }
    if (type === 'response.function_call_arguments.delta') {
      return this.functionArgumentsPayloadForAiSdk(payload);
    }
    if (type === 'response.output_text.delta' || type === 'response.output_text.done') {
      const explicitItemId = stringValue(payload.item_id);
      const itemId = explicitItemId || this.currentTextItemId;
      if (!this.sdkTextItemIds.has(itemId)) return null;
      return explicitItemId ? payload : { ...payload, item_id: itemId };
    }
    if (type !== 'response.output_item.added' && type !== 'response.output_item.done') {
      return payload;
    }
    const itemType = stringValue(objectValue(payload.item).type);
    if (
      itemType === 'collab_tool_call'
      || itemType === 'collabToolCall'
      || itemType === 'reasoning'
    ) return null;
    if (itemType === 'function_call') {
      return this.functionCallPayloadForAiSdk(payload, type);
    }
    return payload;
  }

  observe(payload: Record<string, unknown>, forwardedToAiSdk: boolean): void {
    this.toolArguments.observe(payload);
    this.captureProviderSignals(payload);
    this.captureNativeEnvelope(payload);
    this.captureTextEvents(payload);
    this.captureReasoningEvents(payload);
    this.captureCollabEvent(payload);
    this.eventOrder.record(
      this.pendingEvents.splice(0, this.pendingEvents.length),
      forwardedToAiSdk,
    );
  }

  observeForwardedChunkWithoutEvents(): void {
    this.eventOrder.recordForwardedWithoutEvents();
  }

  liveEvents(): AsyncIterable<ModelStreamEvent> {
    return this.eventOrder.liveEvents();
  }

  finishStreaming(): void {
    this.eventOrder.finishSource();
  }

  eventsForPart(part: TextStreamPart<ToolSet>): ModelStreamEvent[] {
    if (part.type !== 'raw') return [];
    return this.eventOrder.consumeForwardedBatch();
  }

  toolCallArguments(callId: string): string | undefined {
    return this.toolArguments.get(callId);
  }

  terminalEvents(): ModelStreamEvent[] {
    const events = [
      ...this.eventOrder.drainRemainingSideEvents(),
      ...this.pendingEvents.splice(0, this.pendingEvents.length),
    ];
    if (!this.responseTerminalSeen || this.pendingNativeItemIds.size) {
      this.nativeEnvelopeComplete = false;
    }
    const providerMetadata = this.nativeEnvelopeComplete
      ? openAiResponsesMetadata(providerMetadataSource(this.replayContext), {
          kind: 'response',
          responseId: this.responseId || undefined,
          items: this.nativeItems,
        })
      : undefined;
    if (!providerMetadata) return events;
    if (providerMetadataFitsPersistenceLimit(providerMetadata)) {
      events.push({ type: 'assistant_metadata', providerMetadata });
    } else {
      events.push({
        type: 'model_verification',
        verification: {
          model: this.requestedModel,
          provider: this.provider.provider,
          warnings: ['provider_metadata_omitted_too_large'],
        },
      });
    }
    return events;
  }

  private refusalPayloadForAiSdk(
    payload: Record<string, unknown>,
    type: 'response.refusal.delta' | 'response.refusal.done',
  ): Record<string, unknown> | null {
    const itemId = stringValue(payload.item_id) || this.currentTextItemId;
    if (!itemId || !this.sdkTextItemIds.has(itemId)) return null;
    const previous = this.refusalTextByItemId.get(itemId) ?? '';
    const text = type === 'response.refusal.delta'
      ? stringValue(payload.delta)
      : refusalCompletionSuffix(previous, stringValue(payload.refusal));
    if (!text) return null;
    // @ai-sdk/openai 4.0.20 does not model refusal events. At the transport
    // boundary they are semantically projected as text deltas, while the
    // original refusal item remains available to the native metadata codec.
    return {
      type: 'response.output_text.delta',
      item_id: itemId,
      delta: text,
      ...(numberValue(payload.output_index) === undefined
        ? {}
        : { output_index: payload.output_index }),
      ...(numberValue(payload.content_index) === undefined
        ? {}
        : { content_index: payload.content_index }),
    };
  }

  private functionCallPayloadForAiSdk(
    payload: Record<string, unknown>,
    type: 'response.output_item.added' | 'response.output_item.done',
  ): Record<string, unknown> {
    const item = objectValue(payload.item);
    const callId = stringValue(item.call_id) || stringValue(item.id);
    const itemId = stringValue(item.id)
      || callId
      || responseOutputItemFallbackId(payload, 'function_call');
    const name = stringValue(item.name);
    if (!name) return payload;

    const explicitStatus = item.status;
    const status = stringValue(explicitStatus);
    if (
      type === 'response.output_item.done'
      && explicitStatus !== undefined
      && status !== 'in_progress'
      && status !== 'completed'
      && status !== 'incomplete'
    ) return payload;

    const outputIndex = numberValue(payload.output_index)
      ?? this.functionCallOutputIndexByItemId.get(itemId)
      ?? this.nextCompatibilityOutputIndex++;
    this.functionCallOutputIndexByItemId.set(itemId, outputIndex);
    return {
      ...payload,
      output_index: outputIndex,
      item: {
        ...item,
        id: itemId,
        call_id: callId || itemId,
        name,
        arguments: typeof item.arguments === 'string' ? item.arguments : '',
        ...(type === 'response.output_item.done'
          ? { status: status || 'completed' }
          : {}),
      },
    };
  }

  private functionArgumentsPayloadForAiSdk(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (numberValue(payload.output_index) !== undefined) return payload;
    const outputIndex = this.functionCallOutputIndexByItemId.get(stringValue(payload.item_id));
    return outputIndex === undefined ? payload : { ...payload, output_index: outputIndex };
  }

  private captureProviderSignals(payload: Record<string, unknown>): void {
    this.responseId = responsesResponseId(payload) || this.responseId;
    const serverModel = responsesServerModel(payload);
    if (serverModel && serverModel !== this.lastServerModel) {
      this.lastServerModel = serverModel;
      if (serverModel !== this.requestedModel) {
        this.pendingEvents.push({
          type: 'model_verification',
          verification: {
            model: this.requestedModel,
            provider: this.provider.provider,
            serverModel,
            warnings: ['server_model_mismatch'],
          },
        });
      }
    }
    for (const verification of responsesMetadataVerifications(
      payload,
      this.provider.provider,
      this.requestedModel,
    )) {
      this.pendingEvents.push({ type: 'model_verification', verification });
    }
    const safetyBuffering = responsesSafetyBuffering(payload, this.requestedModel);
    if (safetyBuffering) {
      this.pendingEvents.push({ type: 'safety_buffering', buffering: safetyBuffering });
    }
  }

  private captureNativeEnvelope(payload: Record<string, unknown>): void {
    const type = stringValue(payload.type);
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const providerItem = objectValue(payload.item);
      const providerItemId = stringValue(providerItem.id);
      if (!isOpenAiResponsesOutputItemType(providerItem) || !providerItemId) {
        this.nativeEnvelopeComplete = false;
      } else if (type === 'response.output_item.added') {
        this.pendingNativeItemIds.add(providerItemId);
      } else {
        this.pendingNativeItemIds.delete(providerItemId);
      }
      if (type === 'response.output_item.done') {
        const nativeItem = sanitizeOpenAiResponsesItem(payload.item, 'response');
        if (nativeItem) upsertNativeResponseItem(this.nativeItems, nativeItem);
        else this.nativeEnvelopeComplete = false;
      }
      return;
    }
    if (type !== 'response.completed' && type !== 'response.incomplete') return;
    this.responseTerminalSeen = true;
    const response = objectValue(payload.response);
    if (!Array.isArray(response.output) || !response.output.length) return;
    const completedItems = sanitizeOpenAiResponsesItems(response.output, 'response');
    if (!completedItems) {
      this.nativeEnvelopeComplete = false;
      return;
    }
    this.nativeItems.splice(0, this.nativeItems.length, ...completedItems);
    this.pendingNativeItemIds.clear();
  }

  private captureReasoningEvents(payload: Record<string, unknown>): void {
    const type = stringValue(payload.type);
    if (type === 'response.output_item.added') {
      const item = objectValue(payload.item);
      if (stringValue(item.type) !== 'reasoning') return;
      const id = stringValue(item.id) || responseOutputItemFallbackId(payload, 'reasoning');
      this.currentReasoningItemId = id;
      this.pendingEvents.push({
        type: 'item_started',
        item: { id, kind: 'reasoning', content: '', status: 'in_progress' },
      });
      return;
    }
    if (type === 'response.reasoning_summary_part.added') {
      this.pendingEvents.push({
        type: 'reasoning_summary_part_added',
        itemId: stringValue(payload.item_id) || this.currentReasoningItemId || undefined,
        summaryIndex: numberValue(payload.summary_index) ?? 0,
      });
      return;
    }
    if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
      const text = stringValue(payload.delta);
      if (!text) return;
      const itemId = stringValue(payload.item_id) || this.currentReasoningItemId || undefined;
      if (itemId) {
        this.reasoningTextByItemId.set(
          itemId,
          `${this.reasoningTextByItemId.get(itemId) ?? ''}${text}`,
        );
      }
      this.pendingEvents.push(type === 'response.reasoning_summary_text.delta'
        ? {
            type: 'reasoning_summary_delta',
            itemId,
            text,
            summaryIndex: numberValue(payload.summary_index) ?? 0,
          }
        : {
            type: 'reasoning_raw_delta',
            itemId,
            text,
            contentIndex: numberValue(payload.content_index) ?? 0,
          });
      return;
    }
    if (
      type === 'response.reasoning_summary_text.done'
      || type === 'response.reasoning_text.done'
    ) {
      const itemId = stringValue(payload.item_id) || this.currentReasoningItemId;
      this.completeReasoningItem(itemId, stringValue(payload.text));
      return;
    }
    if (type !== 'response.output_item.done') return;
    const item = objectValue(payload.item);
    if (stringValue(item.type) !== 'reasoning') return;
    const itemId = stringValue(item.id) || this.currentReasoningItemId;
    this.completeReasoningItem(itemId, responsesReasoningText(item));
  }

  private captureTextEvents(payload: Record<string, unknown>): void {
    const type = stringValue(payload.type);
    if (type === 'response.output_item.added') {
      const item = objectValue(payload.item);
      if (stringValue(item.type) !== 'message') return;
      const id = stringValue(item.id) || responseOutputItemFallbackId(payload, 'message');
      this.currentTextItemId = id;
      if (canAiSdkHandleMessageItem(payload, item) && !responsesMessageHasRefusal(item)) {
        this.sdkTextItemIds.add(id);
        return;
      }
      this.startNativeTextItem(id, responsesMessageText(item));
      return;
    }
    if (type === 'response.output_text.delta') {
      const text = stringValue(payload.delta);
      if (!text) return;
      const itemId = stringValue(payload.item_id) || this.currentTextItemId;
      // Valid standard Responses text is already projected by the AI SDK.
      // This fallback only handles legacy/provider-compatible orphan deltas.
      if (this.sdkTextItemIds.has(itemId)) return;
      this.pendingEvents.push(itemId
        ? { type: 'item_delta', itemId, delta: text }
        : { type: 'text_delta', text });
      return;
    }
    if (type === 'response.refusal.delta') {
      const itemId = stringValue(payload.item_id)
        || this.currentTextItemId
        || responseOutputItemFallbackId(payload, 'message');
      const delta = stringValue(payload.delta);
      if (!delta) return;
      this.refusalTextByItemId.set(
        itemId,
        `${this.refusalTextByItemId.get(itemId) ?? ''}${delta}`,
      );
      if (this.sdkTextItemIds.has(itemId)) return;
      this.startNativeTextItem(itemId);
      this.pendingEvents.push({ type: 'item_delta', itemId, delta });
      return;
    }
    if (type === 'response.refusal.done') {
      const itemId = stringValue(payload.item_id)
        || this.currentTextItemId
        || responseOutputItemFallbackId(payload, 'message');
      const previous = this.refusalTextByItemId.get(itemId) ?? '';
      const refusal = stringValue(payload.refusal);
      const suffix = refusalCompletionSuffix(previous, refusal);
      this.refusalTextByItemId.set(itemId, refusal || previous);
      if (this.sdkTextItemIds.has(itemId)) return;
      this.startNativeTextItem(itemId);
      if (suffix) this.pendingEvents.push({ type: 'item_delta', itemId, delta: suffix });
      this.completeTextItem(itemId, refusal || previous);
      return;
    }
    if (type === 'response.output_item.done') {
      const item = objectValue(payload.item);
      if (stringValue(item.type) !== 'message') return;
      const itemId = stringValue(item.id) || responseOutputItemFallbackId(payload, 'message');
      this.currentTextItemId = itemId;
      if (this.sdkTextItemIds.has(itemId) && canAiSdkHandleMessageItem(payload, item)) return;
      this.completeTextItem(itemId, responsesMessageText(item));
      return;
    }
    if (type !== 'response.output_text.done') return;
    const itemId = stringValue(payload.item_id) || this.currentTextItemId;
    if (this.sdkTextItemIds.has(itemId)) return;
    this.completeTextItem(itemId, stringValue(payload.text));
  }

  private startNativeTextItem(itemId: string, content = ''): void {
    if (!itemId || this.nativeTextItemIds.has(itemId)) return;
    this.nativeTextItemIds.add(itemId);
    this.pendingEvents.push({
      type: 'item_started',
      item: {
        id: itemId,
        kind: 'agent_message',
        content,
        status: 'in_progress',
      },
    });
  }

  private completeTextItem(itemId: string, text: string): void {
    if (!itemId || this.completedTextItemIds.has(itemId)) return;
    this.completedTextItemIds.add(itemId);
    this.pendingEvents.push({
      type: 'item_completed',
      item: {
        id: itemId,
        kind: 'agent_message',
        content: text || this.refusalTextByItemId.get(itemId) || '',
        status: 'completed',
      },
    });
  }

  private completeReasoningItem(itemId: string, text: string): void {
    if (!itemId || this.completedReasoningItemIds.has(itemId)) return;
    this.completedReasoningItemIds.add(itemId);
    this.pendingEvents.push({
      type: 'item_completed',
      item: {
        id: itemId,
        kind: 'reasoning',
        content: text || this.reasoningTextByItemId.get(itemId) || '',
        status: 'completed',
      },
    });
  }

  private captureCollabEvent(payload: Record<string, unknown>): void {
    const type = stringValue(payload.type);
    if (type !== 'response.output_item.added' && type !== 'response.output_item.done') return;
    const item = objectValue(payload.item);
    const itemType = stringValue(item.type);
    if (itemType !== 'collab_tool_call' && itemType !== 'collabToolCall') return;
    const streamItem = responsesCollabStreamItem(
      item,
      type === 'response.output_item.done' ? 'completed' : 'in_progress',
    );
    if (!streamItem) return;
    this.pendingEvents.push(type === 'response.output_item.done'
      ? { type: 'item_completed', item: streamItem }
      : { type: 'item_started', item: streamItem });
  }
}

function upsertNativeResponseItem(items: RuntimeJsonObject[], next: RuntimeJsonObject): void {
  const id = typeof next.id === 'string' ? next.id : '';
  const index = id ? items.findIndex((item) => item.id === id) : -1;
  if (index < 0) items.push(structuredClone(next));
  else items[index] = structuredClone(next);
}

function responsesResponseId(payload: Record<string, unknown>): string {
  return stringValue(objectValue(payload.response).id) || stringValue(payload.response_id);
}

function responseOutputItemFallbackId(payload: Record<string, unknown>, prefix: string): string {
  const outputIndex = typeof payload.output_index === 'number' ? payload.output_index : undefined;
  return outputIndex === undefined ? `${prefix}_item` : `${prefix}_${outputIndex}`;
}

function responsesReasoningText(item: Record<string, unknown>): string {
  const summary = item.summary;
  if (Array.isArray(summary)) {
    return summary.map((part) => stringValue(objectValue(part).text)).join('');
  }
  return stringValue(item.text);
}

function responsesMessageText(item: Record<string, unknown>): string {
  const content = item.content;
  if (!Array.isArray(content)) return stringValue(item.text);
  return content.map((part) => {
    const record = objectValue(part);
    return stringValue(record.text) || stringValue(record.refusal);
  }).join('');
}

function refusalCompletionSuffix(previous: string, completed: string): string {
  if (!completed || completed === previous) return '';
  return completed.startsWith(previous) ? completed.slice(previous.length) : '';
}

function canAiSdkHandleMessageItem(
  payload: Record<string, unknown>,
  item: Record<string, unknown>,
): boolean {
  const phase = item.phase;
  return typeof payload.output_index === 'number'
    && typeof item.id === 'string'
    && (
      phase === undefined
      || phase === null
      || phase === 'commentary'
      || phase === 'final_answer'
    );
}

function responsesMessageHasRefusal(item: Record<string, unknown>): boolean {
  return Array.isArray(item.content)
    && item.content.some((part) => stringValue(objectValue(part).type) === 'refusal');
}

function responsesCollabStreamItem(
  item: Record<string, unknown>,
  fallbackStatus: NonNullable<RuntimeStreamItem['status']>,
): RuntimeStreamItem | null {
  const tool = stringValue(item.tool);
  if (!isCollabToolName(tool)) return null;
  const senderThreadId = stringValue(item.senderThreadId) || stringValue(item.sender_thread_id);
  if (!senderThreadId) return null;
  return {
    id: stringValue(item.id) || 'collab_item',
    kind: 'collab_tool_call',
    status: responsesItemStatus(item, fallbackStatus),
    collabToolCall: {
      tool,
      senderThreadId,
      receiverThreadId: stringValue(item.receiverThreadId) || stringValue(item.receiver_thread_id) || undefined,
      newThreadId: stringValue(item.newThreadId) || stringValue(item.new_thread_id) || undefined,
      prompt: stringValue(item.prompt) || undefined,
      agentStatus: stringValue(item.agentStatus) || stringValue(item.agent_status) || undefined,
    },
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

function responsesMetadataVerifications(
  payload: Record<string, unknown>,
  provider: string,
  model: string,
): RuntimeModelVerification[] {
  if (stringValue(payload.type) !== 'response.metadata') return [];
  const metadata = objectValue(payload.metadata);
  const recommendations = stringArrayValue(metadata.openai_verification_recommendation);
  return recommendations.length ? [{ model, provider, warnings: recommendations }] : [];
}

function responsesSafetyBuffering(
  payload: Record<string, unknown>,
  model: string,
): RuntimeSafetyBuffering | null {
  const value = objectValue(payload.safety_buffering);
  if (!Object.keys(value).length) return null;
  return {
    model,
    fasterModel: stringValue(value.retry_model)
      || stringValue(value.faster_model)
      || stringValue(value.fasterModel)
      || undefined,
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
  return Array.isArray(value) ? stringValue(value[0]) : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function responsesItemStatus(
  item: Record<string, unknown>,
  fallback: NonNullable<RuntimeStreamItem['status']>,
): NonNullable<RuntimeStreamItem['status']> {
  const status = stringValue(item.status);
  return status === 'completed'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'in_progress'
    ? status
    : fallback;
}

function isCollabToolName(
  value: string,
): value is NonNullable<RuntimeStreamItem['collabToolCall']>['tool'] {
  return value === 'spawn_agent'
    || value === 'send_input'
    || value === 'resume_agent'
    || value === 'wait'
    || value === 'close_agent';
}
