import type { StoredThreadEvent } from '@setsuna-desktop/contracts';
import type {
  RendererFeatureMessageKey,
  RendererTranslate,
} from '@setsuna-desktop/feature-core/renderer';
import {
  conversationDebugMessageToolInstanceId,
  type ConversationDebugNode,
  type ConversationDebugRecord,
} from './conversationDebugGraph.js';
import {
  collectConversationDebugNotices,
  type ConversationDebugDiagnosticNotice,
} from './conversationDebugNotices.js';
import {
  safeConversationDebugJson,
  sanitizeConversationDebugText,
  sanitizeConversationDebugValue,
} from './conversationDebugSerialization.js';
import {
  conversationDebugRecordKind,
  isRuntimeDebugTrace,
} from './conversationDebugTraces.js';

export type ConversationDebugDiagnosticField = Readonly<{
  id: string;
  label: string;
  language?: 'json';
  monospace?: boolean;
  path?: string;
  value: string;
  wide?: boolean;
}>;

export type ConversationDebugDiagnosticSection = Readonly<{
  fields: readonly ConversationDebugDiagnosticField[];
  id: 'overview' | 'payload';
  title: string;
}>;

export type ConversationDebugInspectorModel = Readonly<{
  notices: readonly ConversationDebugDiagnosticNotice[];
  noticesTitle: string;
  sections: readonly ConversationDebugDiagnosticSection[];
}>;

type FieldOccurrences = {
  firstSeen: number;
  path: string;
  values: Map<string, number>;
};

const STREAMING_PREVIEW_MAX_LENGTH = 1_600;
const MULTI_VALUE_PREVIEW_MAX_LENGTH = 280;

const STREAMING_EVENT_TYPES = new Set<StoredThreadEvent['type']>([
  'item.delta',
  'message.delta',
  'plan.delta',
  'reasoning.raw_delta',
  'reasoning.summary_delta',
  'tool.output_delta',
]);

const FIELD_LABEL_KEYS: Record<string, RendererFeatureMessageKey> = {
  activeProviderId: 'feature.conversationDebug.inspector.field.activeProvider',
  additionalPermissions: 'feature.conversationDebug.inspector.field.additionalPermissions',
  advertisedToolNames: 'feature.conversationDebug.inspector.field.advertisedTools',
  archived: 'feature.conversationDebug.inspector.field.archived',
  argumentsLength: 'feature.conversationDebug.inspector.field.argumentsLength',
  argumentsPreview: 'feature.conversationDebug.inspector.field.arguments',
  fullArguments: 'feature.conversationDebug.inspector.field.fullArguments',
  autoCompactTokenLimit: 'feature.conversationDebug.inspector.field.autoCompactLimit',
  cachedInputTokens: 'feature.conversationDebug.inspector.field.cachedInputTokens',
  code: 'feature.conversationDebug.inspector.field.code',
  command: 'feature.conversationDebug.inspector.field.command',
  completedAt: 'feature.conversationDebug.inspector.field.completedAt',
  content: 'feature.conversationDebug.inspector.field.content',
  contentHash: 'feature.conversationDebug.inspector.field.contentHash',
  createdAt: 'feature.conversationDebug.inspector.field.createdAt',
  cwd: 'feature.conversationDebug.inspector.field.cwd',
  decision: 'feature.conversationDebug.inspector.field.decision',
  deferredToolCatalogSize: 'feature.conversationDebug.inspector.field.deferredTools',
  durationMs: 'feature.conversationDebug.inspector.field.durationMs',
  entries: 'feature.conversationDebug.inspector.field.hookEntries',
  environmentId: 'feature.conversationDebug.inspector.field.environment',
  error: 'feature.conversationDebug.inspector.field.error',
  estimatedTokens: 'feature.conversationDebug.inspector.field.estimatedTokens',
  eventName: 'feature.conversationDebug.inspector.field.hookEvent',
  featureKeys: 'feature.conversationDebug.inspector.field.features',
  forced: 'feature.conversationDebug.inspector.field.forced',
  input: 'feature.conversationDebug.inspector.field.input',
  inputMessageCount: 'feature.conversationDebug.inspector.field.inputMessages',
  inputMessageIds: 'feature.conversationDebug.inspector.field.inputMessages',
  inputTokens: 'feature.conversationDebug.inspector.field.inputTokens',
  interruptedToolResultMessageIds: 'feature.conversationDebug.inspector.field.interruptedResults',
  loadedDeferredToolNames: 'feature.conversationDebug.inspector.field.loadedDeferredTools',
  matcher: 'feature.conversationDebug.inspector.field.matcher',
  maxBufferedEventCount: 'feature.conversationDebug.inspector.field.maxBuffer',
  maxContextTokens: 'feature.conversationDebug.inspector.field.maxContextTokens',
  mcpServerCount: 'feature.conversationDebug.inspector.field.mcpServers',
  mcpServerKeys: 'feature.conversationDebug.inspector.field.mcpServers',
  message: 'feature.conversationDebug.inspector.field.message',
  messageCount: 'feature.conversationDebug.inspector.field.messages',
  messageIds: 'feature.conversationDebug.inspector.field.messages',
  model: 'feature.conversationDebug.inspector.field.model',
  modelCode: 'feature.conversationDebug.inspector.field.modelCode',
  modelContextWindow: 'feature.conversationDebug.inspector.field.modelContextWindow',
  modelId: 'feature.conversationDebug.inspector.field.modelId',
  nativeItemCount: 'feature.conversationDebug.inspector.field.nativeItems',
  networkAccess: 'feature.conversationDebug.inspector.field.networkAccess',
  orphanToolResultMessageIds: 'feature.conversationDebug.inspector.field.orphanResults',
  outputMessageCount: 'feature.conversationDebug.inspector.field.outputMessages',
  outputTokens: 'feature.conversationDebug.inspector.field.outputTokens',
  percent: 'feature.conversationDebug.inspector.field.percent',
  permissionProfile: 'feature.conversationDebug.inspector.field.permissionProfile',
  pluginId: 'feature.conversationDebug.inspector.field.plugin',
  processId: 'feature.conversationDebug.inspector.field.process',
  projectId: 'feature.conversationDebug.inspector.field.project',
  provider: 'feature.conversationDebug.inspector.field.provider',
  providerId: 'feature.conversationDebug.inspector.field.providerId',
  providerKind: 'feature.conversationDebug.inspector.field.providerKind',
  reason: 'feature.conversationDebug.inspector.field.reason',
  reasons: 'feature.conversationDebug.inspector.field.reasons',
  receivedEventCount: 'feature.conversationDebug.inspector.field.receivedEvents',
  receivedStreamCharacters: 'feature.conversationDebug.inspector.field.receivedCharacters',
  resultPreview: 'feature.conversationDebug.inspector.field.result',
  reviewer: 'feature.conversationDebug.inspector.field.reviewer',
  riskLevel: 'feature.conversationDebug.inspector.field.riskLevel',
  role: 'feature.conversationDebug.inspector.field.role',
  selectedSkills: 'feature.conversationDebug.inspector.field.skills',
  serverModel: 'feature.conversationDebug.inspector.field.serverModel',
  source: 'feature.conversationDebug.inspector.field.source',
  sourcePath: 'feature.conversationDebug.inspector.field.sourcePath',
  status: 'feature.conversationDebug.inspector.field.status',
  statusMessage: 'feature.conversationDebug.inspector.field.statusMessage',
  stderrPreview: 'feature.conversationDebug.inspector.field.stderr',
  stdoutPreview: 'feature.conversationDebug.inspector.field.stdout',
  strategy: 'feature.conversationDebug.inspector.field.strategy',
  taskKind: 'feature.conversationDebug.inspector.field.taskKind',
  terminalEventType: 'feature.conversationDebug.inspector.field.terminalEvent',
  threadMessageCount: 'feature.conversationDebug.inspector.field.threadMessages',
  title: 'feature.conversationDebug.inspector.field.title',
  tokensUntilCompaction: 'feature.conversationDebug.inspector.field.tokensUntilCompaction',
  toolChoice: 'feature.conversationDebug.inspector.field.toolChoice',
  toolName: 'feature.conversationDebug.inspector.field.tool',
  toolNames: 'feature.conversationDebug.inspector.field.tools',
  totalTokens: 'feature.conversationDebug.inspector.field.totalTokens',
  unifiedDiff: 'feature.conversationDebug.inspector.field.diff',
  useCases: 'feature.conversationDebug.inspector.field.useCases',
  usedTokens: 'feature.conversationDebug.inspector.field.usedTokens',
  warnings: 'feature.conversationDebug.inspector.field.warnings',
  wireToolCallRewrites: 'feature.conversationDebug.inspector.field.wireRewrites',
};

export function createConversationDebugInspectorModel({
  locale,
  node,
  records,
  contextRecords = records,
  t,
}: Readonly<{
  contextRecords?: readonly ConversationDebugRecord[];
  locale: string;
  node: ConversationDebugNode;
  records: readonly ConversationDebugRecord[];
  t: RendererTranslate;
}>): ConversationDebugInspectorModel {
  const payloadFields = collectPayloadFields(
    records,
    t,
    fullToolArguments(node, contextRecords),
  );
  const sections: ConversationDebugDiagnosticSection[] = [{
    fields: overviewFields(node, records, locale, t),
    id: 'overview',
    title: t('feature.conversationDebug.inspector.section.overview'),
  }];
  if (payloadFields.length) {
    sections.push({
      fields: payloadFields,
      id: 'payload',
      title: t('feature.conversationDebug.inspector.section.nodeData'),
    });
  }
  return {
    notices: collectConversationDebugNotices(records, t),
    noticesTitle: t('feature.conversationDebug.inspector.section.notices'),
    sections,
  };
}

function overviewFields(
  node: ConversationDebugNode,
  records: readonly ConversationDebugRecord[],
  locale: string,
  t: RendererTranslate,
): ConversationDebugDiagnosticField[] {
  const fields: ConversationDebugDiagnosticField[] = [];
  const eventCount = node.eventIds.length;
  const traceCount = node.traceIds.length;
  const durationMs = node.completedAt
    ? Date.parse(node.completedAt) - Date.parse(node.startedAt)
    : undefined;
  addOverviewField(fields, 'startedAt', t('feature.conversationDebug.inspector.field.startedAt'), formatTimestamp(node.startedAt, locale));
  if (node.completedAt) {
    addOverviewField(fields, 'completedAt', t('feature.conversationDebug.inspector.field.completedAt'), formatTimestamp(node.completedAt, locale));
  }
  if (durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0) {
    addOverviewField(fields, 'duration', t('feature.conversationDebug.inspector.field.duration'), formatDuration(durationMs, locale));
  }
  addOverviewField(
    fields,
    'records',
    t('feature.conversationDebug.inspector.records'),
    t('feature.conversationDebug.inspector.recordBreakdown', {
      events: eventCount,
      traces: traceCount,
    }),
  );
  addOverviewField(
    fields,
    'sequence',
    t('feature.conversationDebug.inspector.sequence'),
    `${node.source === 'trace' ? 'D' : 'E'}#${node.seqStart}${node.seqEnd > node.seqStart ? `–${node.seqEnd}` : ''}`,
    true,
  );
  addOverviewField(fields, 'nodeId', t('feature.conversationDebug.inspector.field.nodeId'), node.id, true, true);
  addOverviewField(fields, 'turnId', t('feature.conversationDebug.inspector.turn'), node.turnId, true, true);
  addOverviewField(fields, 'toolCallId', t('feature.conversationDebug.inspector.field.toolCallId'), node.relatedToolCallId, true, true);
  addOverviewField(
    fields,
    'recordTypes',
    t('feature.conversationDebug.inspector.field.recordTypes'),
    [...new Set(records.map(conversationDebugRecordKind))].join(', '),
    true,
    true,
  );
  return fields;
}

function addOverviewField(
  fields: ConversationDebugDiagnosticField[],
  id: string,
  label: string,
  value: string | undefined,
  monospace = false,
  wide = false,
): void {
  if (!value) return;
  fields.push({ id, label, monospace, value: sanitizeConversationDebugText(value), wide });
}

function collectPayloadFields(
  records: readonly ConversationDebugRecord[],
  t: RendererTranslate,
  authoritativeToolArguments?: string,
): ConversationDebugDiagnosticField[] {
  const occurrences = new Map<string, FieldOccurrences>();
  const streamStats = new Map<string, { characters: number; count: number; preview: string }>();
  let order = 0;

  const addOccurrence = (path: string, value: string) => {
    if (!value) return;
    const current = occurrences.get(path) ?? {
      firstSeen: order++,
      path,
      values: new Map<string, number>(),
    };
    current.values.set(value, (current.values.get(value) ?? 0) + 1);
    occurrences.set(path, current);
  };

  for (const record of records) {
    if (!isRuntimeDebugTrace(record) && STREAMING_EVENT_TYPES.has(record.type)) {
      const length = streamingRecordCharacterCount(record);
      const streamKey = streamingRecordKey(record);
      const current = streamStats.get(streamKey) ?? { characters: 0, count: 0, preview: '' };
      current.characters += length;
      current.count += 1;
      const preview = streamingRecordPreview(record);
      if (preview) {
        current.preview = clipDebugPreviewValue(
          `${current.preview}${preview}`,
          STREAMING_PREVIEW_MAX_LENGTH,
        );
      }
      streamStats.set(streamKey, current);
      continue;
    }
    const sanitizedPayload = sanitizeConversationDebugValue(record.payload);
    flattenDebugPayload(sanitizedPayload, '', addOccurrence, t);
  }

  if (authoritativeToolArguments !== undefined) {
    const preview = occurrences.get('argumentsPreview');
    occurrences.delete('argumentsPreview');
    occurrences.set('fullArguments', {
      firstSeen: preview?.firstSeen ?? order++,
      path: 'fullArguments',
      values: new Map([[
        sanitizeConversationDebugText(authoritativeToolArguments),
        1,
      ]]),
    });
  }

  const fields = [...occurrences.values()]
    .sort((left, right) => left.firstSeen - right.firstSeen)
    .map((occurrence) => fieldFromOccurrences(occurrence, t));
  for (const [streamKey, stats] of streamStats) {
    fields.push({
      id: `stream:${streamKey}`,
      label: t('feature.conversationDebug.inspector.field.streamingDetails'),
      monospace: true,
      path: streamKey,
      value: t('feature.conversationDebug.inspector.streamingSummary', {
        characters: stats.characters,
        count: stats.count,
      }),
    });
    if (stats.preview) {
      fields.push({
        id: `stream-preview:${streamKey}`,
        label: t('feature.conversationDebug.inspector.field.stderr'),
        monospace: true,
        path: `${streamKey}.preview`,
        value: stats.preview,
        wide: true,
      });
    }
  }
  return fields;
}

function fullToolArguments(
  node: ConversationDebugNode,
  records: readonly ConversationDebugRecord[],
): string | undefined {
  if (!node.relatedToolCallId) return undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (
      isRuntimeDebugTrace(record)
      || record.type !== 'message.completed'
      || record.turnId !== node.turnId
    ) continue;
    const toolCall = record.payload.toolCalls?.find((candidate) => {
      if (candidate.id !== node.relatedToolCallId) return false;
      return !node.relatedToolInstanceId
        || conversationDebugMessageToolInstanceId(record, candidate.id)
          === node.relatedToolInstanceId;
    });
    if (toolCall) return toolCall.arguments;
  }
  return undefined;
}

function flattenDebugPayload(
  value: unknown,
  path: string,
  add: (path: string, value: string) => void,
  t: RendererTranslate,
  depth = 0,
): void {
  if (value === null || value === undefined || value === '[undefined]') return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (value === '') return;
    add(path || 'value', formatPayloadPrimitive(value, t));
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) return;
    const scalarArray = value.every((item) => (
      item === null
      || typeof item === 'string'
      || typeof item === 'number'
      || typeof item === 'boolean'
    ));
    add(
      path || 'items',
      scalarArray
        ? formatScalarArray(value, t)
        : safeConversationDebugJson(value),
    );
    return;
  }
  if (typeof value !== 'object') {
    add(path || 'value', sanitizeConversationDebugText(String(value)));
    return;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return;
  if (depth >= 5) {
    add(path || 'value', safeConversationDebugJson(value));
    return;
  }
  for (const [key, nestedValue] of entries) {
    flattenDebugPayload(
      nestedValue,
      path ? `${path}.${key}` : key,
      add,
      t,
      depth + 1,
    );
  }
}

function fieldFromOccurrences(
  occurrence: FieldOccurrences,
  t: RendererTranslate,
): ConversationDebugDiagnosticField {
  const terminalKey = occurrence.path.split('.').at(-1) ?? occurrence.path;
  const labelKey = FIELD_LABEL_KEYS[terminalKey];
  const value = formatFieldOccurrences(occurrence.values, t);
  const language = structuredDebugValueLanguage(value);
  return {
    id: `payload:${occurrence.path}`,
    label: labelKey ? t(labelKey) : humanizeDebugFieldName(terminalKey),
    ...(language ? { language } : {}),
    monospace: Boolean(language) || isMonospaceDebugField(terminalKey),
    path: occurrence.path,
    value,
    wide: Boolean(language) || value.includes('\n') || value.length > 120 || isWideDebugField(terminalKey),
  };
}

function structuredDebugValueLanguage(value: string): 'json' | undefined {
  if (!value.startsWith('{') && !value.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' ? 'json' : undefined;
  } catch {
    return value.includes('\n…[') ? 'json' : undefined;
  }
}

function formatFieldOccurrences(
  values: ReadonlyMap<string, number>,
  t: RendererTranslate,
): string {
  const entries = [...values.entries()];
  if (entries.length === 1) return entries[0]![0];
  const visible = entries.slice(0, 4).map(([value, count]) => (
    `${clipDebugPreviewValue(value, MULTI_VALUE_PREVIEW_MAX_LENGTH)}${count > 1 ? ` × ${count}` : ''}`
  ));
  if (entries.length > visible.length) {
    visible.push(t('feature.conversationDebug.inspector.additionalValues', {
      count: entries.length - visible.length,
    }));
  }
  return visible.join(' → ');
}

function streamingRecordCharacterCount(event: StoredThreadEvent): number {
  switch (event.type) {
    case 'message.delta':
      return event.payload.text.length;
    case 'item.delta':
    case 'plan.delta':
    case 'reasoning.raw_delta':
    case 'reasoning.summary_delta':
    case 'tool.output_delta':
      return event.payload.delta.length;
    default:
      return 0;
  }
}

function streamingRecordKey(event: StoredThreadEvent): string {
  if (event.type === 'message.delta' && event.payload.channel) {
    return `${event.type}.${event.payload.channel}`;
  }
  if (event.type === 'tool.output_delta' && event.payload.stream) {
    return `${event.type}.${event.payload.stream}`;
  }
  return event.type;
}

function streamingRecordPreview(event: StoredThreadEvent): string {
  return event.type === 'tool.output_delta' && event.payload.stream === 'stderr'
    ? sanitizeConversationDebugText(event.payload.delta)
    : '';
}

function formatPayloadPrimitive(value: string | number | boolean, t: RendererTranslate): string {
  if (typeof value === 'boolean') {
    return t(value
      ? 'feature.conversationDebug.inspector.value.yes'
      : 'feature.conversationDebug.inspector.value.no');
  }
  return sanitizeConversationDebugText(String(value));
}

function formatScalarArray(value: unknown[], t: RendererTranslate): string {
  const visible = value.slice(0, 20).map((item) => (
    item === null ? 'null' : formatPayloadPrimitive(item as string | number | boolean, t)
  ));
  if (value.length > visible.length) {
    visible.push(t('feature.conversationDebug.inspector.additionalValues', {
      count: value.length - visible.length,
    }));
  }
  return visible.join(', ');
}

function formatTimestamp(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    day: '2-digit',
    fractionalSecondDigits: 3,
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  });
}

function formatDuration(durationMs: number, locale: string): string {
  if (durationMs < 1_000) return `${durationMs.toLocaleString(locale)} ms`;
  return `${(durationMs / 1_000).toLocaleString(locale, { maximumFractionDigits: 3 })} s`;
}

function clipDebugPreviewValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n…[${value.length - maxLength} chars omitted]`;
}

function humanizeDebugFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim();
}

function isMonospaceDebugField(key: string): boolean {
  return /(?:code|hash|id|key|path|process|provider|source|type)$/iu.test(key);
}

function isWideDebugField(key: string): boolean {
  return /(?:arguments|command|content|data|diff|entries|error|input|message|preview|reason|stderr|stdout|warning)/iu.test(key);
}
