import { defineRuntimeCodec } from '@setsuna-desktop/feature-core/codec';
import { defineFeatureOperation } from '@setsuna-desktop/feature-core/operation';
import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type {
  ConversationDebugEventPage,
  ConversationDebugEventPageQuery,
} from './event-pages.js';
import {
  conversationDebugSettingsCodec,
  conversationDebugSettingsPatchCodec,
  type ConversationDebugSettingsState,
  type ConversationDebugSettingsUpdate,
} from './settings.js';
import type {
  RuntimeCompactionDebugPayload,
  RuntimeDebugTraceEvent,
  RuntimeDebugTraceList,
  RuntimeHistoryNormalizationDebugPayload,
  RuntimeProviderReplayDebugPayload,
  RuntimeStreamPipelineDebugPayload,
} from './traces.js';

const emptyInputCodec = defineRuntimeCodec<undefined>((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined;
  throw new Error('Operation does not accept input.');
});

export const conversationDebugSettingsStateCodec = defineRuntimeCodec<ConversationDebugSettingsState>((value) => {
  const record = objectRecord(value, 'Conversation debug settings state must be an object.');
  return Object.freeze({
    value: conversationDebugSettingsCodec.parse(record.value),
    revision: nonNegativeInteger(record.revision, 'settings revision'),
  });
});

const settingsUpdateCodec = defineRuntimeCodec<ConversationDebugSettingsUpdate>((value) => {
  const record = objectRecord(value, 'Conversation debug settings update must be an object.');
  return Object.freeze({
    expectedRevision: nonNegativeInteger(record.expectedRevision, 'expected revision'),
    patch: conversationDebugSettingsPatchCodec.parse(record.patch ?? {}),
  });
});

export type ConversationDebugTraceQuery = Readonly<{
  threadId: string;
  afterSeq: string;
}>;

const MAX_EVENT_PAGE_SIZE = 1_000;

const eventPageQueryCodec = defineRuntimeCodec<ConversationDebugEventPageQuery>((value) => {
  const record = objectRecord(value, 'Conversation debug event page query must be an object.');
  const afterSeq = stableIntegerString(record.afterSeq, 'afterSeq');
  const throughSeq = stableIntegerString(record.throughSeq, 'throughSeq');
  const limit = stableIntegerString(record.limit, 'limit');
  if (Number(afterSeq) > Number(throughSeq)) {
    throw new Error('Conversation debug afterSeq must not exceed throughSeq.');
  }
  if (Number(limit) < 1 || Number(limit) > MAX_EVENT_PAGE_SIZE) {
    throw new Error(`Conversation debug limit must be between 1 and ${MAX_EVENT_PAGE_SIZE}.`);
  }
  return Object.freeze({
    afterSeq,
    limit,
    threadId: runtimeId(record.threadId, 'threadId'),
    throughSeq,
  });
});

const traceQueryCodec = defineRuntimeCodec<ConversationDebugTraceQuery>((value) => {
  const record = objectRecord(value, 'Conversation debug trace query must be an object.');
  const afterSeq = stableIntegerString(record.afterSeq, 'afterSeq');
  return Object.freeze({
    threadId: runtimeId(record.threadId, 'threadId'),
    afterSeq,
  });
});

export const runtimeDebugTraceListCodec = defineRuntimeCodec<RuntimeDebugTraceList>((value) => {
  const record = objectRecord(value, 'Conversation debug trace list must be an object.');
  if (!Array.isArray(record.traces)) throw new Error('Conversation debug traces must be an array.');
  return Object.freeze({
    ...optionalNonNegativeInteger(record, 'droppedBeforeSeq'),
    nextSeq: positiveInteger(record.nextSeq, 'nextSeq'),
    traces: Object.freeze(record.traces.map(runtimeDebugTraceEvent)),
  });
});

export const conversationDebugEventPageCodec = defineRuntimeCodec<ConversationDebugEventPage>((value) => {
  const record = objectRecord(value, 'Conversation debug event page must be an object.');
  if (!Array.isArray(record.records)) {
    throw new Error('Conversation debug event page records must be an array.');
  }
  const records = record.records.map(storedThreadEvent);
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]!.seq !== records[index - 1]!.seq + 1) {
      throw new Error('Conversation debug event page records must be contiguous.');
    }
  }
  return Object.freeze({
    records: Object.freeze(records),
    throughSeq: nonNegativeInteger(record.throughSeq, 'throughSeq'),
  });
});

export const readConversationDebugSettings = defineFeatureOperation({
  id: 'conversation-debug.settings.read',
  method: 'GET',
  path: '/v1/features/conversation-debug/settings',
  input: emptyInputCodec,
  output: conversationDebugSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'safe',
});

export const updateConversationDebugSettings = defineFeatureOperation({
  id: 'conversation-debug.settings.update',
  method: 'PATCH',
  path: '/v1/features/conversation-debug/settings',
  input: settingsUpdateCodec,
  output: conversationDebugSettingsStateCodec,
  errors: Object.freeze({ SETTINGS_UNAVAILABLE: { status: 503 } }),
  idempotency: 'idempotent',
});

export const listConversationDebugTraces = defineFeatureOperation({
  id: 'conversation-debug.traces.list',
  method: 'GET',
  path: '/v1/features/conversation-debug/threads/:threadId/traces/:afterSeq',
  input: traceQueryCodec,
  output: runtimeDebugTraceListCodec,
  errors: Object.freeze({
    DEBUG_DISABLED: { status: 404 },
    THREAD_NOT_FOUND: { status: 404 },
  }),
  idempotency: 'safe',
});

export const listConversationDebugEvents = defineFeatureOperation({
  id: 'conversation-debug.events.list',
  method: 'GET',
  path: '/v1/features/conversation-debug/threads/:threadId/events/:afterSeq/:throughSeq/:limit',
  input: eventPageQueryCodec,
  output: conversationDebugEventPageCodec,
  errors: Object.freeze({
    DEBUG_DISABLED: { status: 404 },
    THREAD_NOT_FOUND: { status: 404 },
  }),
  idempotency: 'safe',
});

function storedThreadEvent(value: unknown): StoredThreadEvent {
  const record = objectRecord(value, 'Conversation debug event record must be an object.');
  const type = text(record.type, 'event type');
  const base = {
    ...record,
    createdAt: text(record.createdAt, 'createdAt'),
    id: runtimeId(record.id, 'event id'),
    payload: record.payload,
    seq: positiveInteger(record.seq, 'event seq'),
    threadId: runtimeId(record.threadId, 'threadId'),
    ...(record.turnId === undefined ? {} : { turnId: runtimeId(record.turnId, 'turnId') }),
    type,
  };
  if (type === 'feature.event') {
    Object.assign(base, {
      eventType: text(record.eventType, 'feature event type'),
      featureId: text(record.featureId, 'feature id'),
      schemaVersion: positiveInteger(record.schemaVersion, 'schemaVersion'),
    });
  }
  // Event-specific payload codecs remain owned by Core/each Feature. This boundary
  // validates the common durable envelope before handing the record to the viewer.
  return Object.freeze(base) as StoredThreadEvent;
}

function runtimeDebugTraceEvent(value: unknown): RuntimeDebugTraceEvent {
  const record = objectRecord(value, 'Conversation debug trace must be an object.');
  const kind = debugTraceKind(record.kind);
  const base = {
    afterEventSeq: nonNegativeInteger(record.afterEventSeq, 'afterEventSeq'),
    createdAt: text(record.createdAt, 'createdAt'),
    id: runtimeId(record.id, 'id'),
    kind,
    payload: debugTracePayload(kind, record.payload),
    seq: positiveInteger(record.seq, 'seq'),
    threadId: runtimeId(record.threadId, 'threadId'),
    ...optionalText(record, 'spanId'),
    ...optionalText(record, 'turnId'),
  };
  return base as RuntimeDebugTraceEvent;
}

function debugTraceKind(value: unknown): RuntimeDebugTraceEvent['kind'] {
  if (
    value === 'context.compaction.completed'
    || value === 'context.compaction.native'
    || value === 'context.compaction.portable'
    || value === 'model.history.normalized'
    || value === 'provider.replay.decision'
    || value === 'stream.pipeline.summary'
  ) return value;
  throw new Error('Conversation debug trace kind is invalid.');
}

function debugTracePayload(
  kind: RuntimeDebugTraceEvent['kind'],
  value: unknown,
): RuntimeDebugTraceEvent['payload'] {
  const record = objectRecord(value, 'Conversation debug trace payload must be an object.');
  if (kind.startsWith('context.compaction.')) return compactionPayload(record);
  if (kind === 'model.history.normalized') return historyPayload(record);
  if (kind === 'provider.replay.decision') return providerReplayPayload(record);
  return streamPipelinePayload(record);
}

function compactionPayload(record: Record<string, unknown>): RuntimeCompactionDebugPayload {
  const outcome = record.outcome;
  if (outcome !== 'error' && outcome !== 'fallback' && outcome !== 'started' && outcome !== 'success' && outcome !== 'unsupported') {
    throw new Error('Conversation debug compaction outcome is invalid.');
  }
  const source = record.source;
  if (source !== undefined && source !== 'local' && source !== 'remote') {
    throw new Error('Conversation debug compaction source is invalid.');
  }
  return Object.freeze({
    ...optionalText(record, 'error'),
    ...optionalBoolean(record, 'metadataPersisted'),
    olderMessageCount: nonNegativeInteger(record.olderMessageCount, 'olderMessageCount'),
    outcome,
    recentMessageCount: nonNegativeInteger(record.recentMessageCount, 'recentMessageCount'),
    ...(source ? { source } : {}),
    ...optionalNonNegativeInteger(record, 'summaryCharacters'),
  });
}

function historyPayload(record: Record<string, unknown>): RuntimeHistoryNormalizationDebugPayload {
  if (!Array.isArray(record.wireToolCallRewrites)) {
    throw new Error('Conversation debug wire rewrites must be an array.');
  }
  return Object.freeze({
    inputMessageCount: nonNegativeInteger(record.inputMessageCount, 'inputMessageCount'),
    interruptedToolResultMessageIds: stringArray(record.interruptedToolResultMessageIds),
    orphanToolResultMessageIds: stringArray(record.orphanToolResultMessageIds),
    outputMessageCount: nonNegativeInteger(record.outputMessageCount, 'outputMessageCount'),
    warnings: stringArray(record.warnings),
    wireToolCallRewrites: record.wireToolCallRewrites.map((item) => {
      const rewrite = objectRecord(item, 'Conversation debug wire rewrite must be an object.');
      return Object.freeze({
        assistantMessageId: text(rewrite.assistantMessageId, 'assistantMessageId'),
        callIndex: nonNegativeInteger(rewrite.callIndex, 'callIndex'),
        providerMetadataRemoved: boolean(rewrite.providerMetadataRemoved, 'providerMetadataRemoved'),
        semanticCallId: text(rewrite.semanticCallId, 'semanticCallId'),
        toolResultMessageIds: stringArray(rewrite.toolResultMessageIds),
        wireCallId: text(rewrite.wireCallId, 'wireCallId'),
      });
    }),
  });
}

function providerReplayPayload(record: Record<string, unknown>): RuntimeProviderReplayDebugPayload {
  const providerKind = record.providerKind;
  if (
    providerKind !== 'openai-compatible'
    && providerKind !== 'openai-responses'
    && providerKind !== 'anthropic'
  ) throw new Error('Conversation debug provider kind is invalid.');
  const reason = record.reason;
  if (
    reason !== 'context_mismatch'
    && reason !== 'legacy_provider_mismatch'
    && reason !== 'metadata_missing'
    && reason !== 'native_envelope_invalid'
    && reason !== 'native_replay_compatible'
    && reason !== 'semantic_mismatch'
    && reason !== 'unsupported_provider'
  ) throw new Error('Conversation debug replay reason is invalid.');
  if (record.strategy !== 'native' && record.strategy !== 'semantic') {
    throw new Error('Conversation debug replay strategy is invalid.');
  }
  return Object.freeze({
    messageId: text(record.messageId, 'messageId'),
    model: text(record.model, 'model'),
    nativeItemCount: nonNegativeInteger(record.nativeItemCount, 'nativeItemCount'),
    providerId: text(record.providerId, 'providerId'),
    providerKind,
    reason,
    strategy: record.strategy,
  });
}

function streamPipelinePayload(record: Record<string, unknown>): RuntimeStreamPipelineDebugPayload {
  const terminalEventType = record.terminalEventType;
  if (terminalEventType !== 'runtime.error' && terminalEventType !== 'turn.cancelled' && terminalEventType !== 'turn.completed') {
    throw new Error('Conversation debug terminal event type is invalid.');
  }
  return Object.freeze({
    batchFlushCount: nonNegativeInteger(record.batchFlushCount, 'batchFlushCount'),
    coalescedEventCount: nonNegativeInteger(record.coalescedEventCount, 'coalescedEventCount'),
    maxBufferedEventCount: nonNegativeInteger(record.maxBufferedEventCount, 'maxBufferedEventCount'),
    persistedEventCount: nonNegativeInteger(record.persistedEventCount, 'persistedEventCount'),
    persistedStreamCharacters: nonNegativeInteger(record.persistedStreamCharacters, 'persistedStreamCharacters'),
    persistedStreamDeltaCount: nonNegativeInteger(record.persistedStreamDeltaCount, 'persistedStreamDeltaCount'),
    receivedEventCount: nonNegativeInteger(record.receivedEventCount, 'receivedEventCount'),
    receivedMergeableEventCount: nonNegativeInteger(record.receivedMergeableEventCount, 'receivedMergeableEventCount'),
    receivedStreamCharacters: nonNegativeInteger(record.receivedStreamCharacters, 'receivedStreamCharacters'),
    receivedStreamDeltaCount: nonNegativeInteger(record.receivedStreamDeltaCount, 'receivedStreamDeltaCount'),
    terminalEventType,
  });
}

function objectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function runtimeId(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[A-Za-z0-9_-]+$/u.test(normalized)) throw new Error(`Conversation debug ${label} is invalid.`);
  return normalized;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 8_192) {
    throw new Error(`Conversation debug ${label} is invalid.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Conversation debug ${label} is invalid.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Conversation debug ${label} is invalid.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`Conversation debug ${label} is invalid.`);
  return parsed;
}

function stableIntegerString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Conversation debug ${label} is invalid.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Conversation debug ${label} is invalid.`);
  return String(parsed);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Conversation debug string list is invalid.');
  }
  return value as string[];
}

function optionalText(record: Record<string, unknown>, key: string): Record<string, string> {
  return record[key] === undefined ? {} : { [key]: text(record[key], key) };
}

function optionalBoolean(record: Record<string, unknown>, key: string): Record<string, boolean> {
  return record[key] === undefined ? {} : { [key]: boolean(record[key], key) };
}

function optionalNonNegativeInteger(record: Record<string, unknown>, key: string): Record<string, number> {
  return record[key] === undefined ? {} : { [key]: nonNegativeInteger(record[key], key) };
}
