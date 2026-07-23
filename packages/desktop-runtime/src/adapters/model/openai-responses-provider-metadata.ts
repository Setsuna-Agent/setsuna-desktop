import type {
  RuntimeJsonObject,
  RuntimeJsonValue,
  RuntimeMessage,
  RuntimeMessageProviderMetadata,
} from '@setsuna-desktop/contracts';
import {
  portableRuntimeAssistantText,
  providerMetadataMatchesSemanticMessage,
} from '../../utils/runtime-message-semantic-fingerprint.js';
import {
  providerMetadataMatchesReplayContext,
  type ProviderReplayContext,
} from './provider-replay-context.js';

type ResponsesEnvelopeKind = 'response' | 'compaction';
type ReplayableResponsesItemType =
  | 'message'
  | 'reasoning'
  | 'function_call'
  | 'function_call_output'
  | 'compaction';

const RESPONSE_ITEM_TYPES = new Set<ReplayableResponsesItemType>([
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
  'compaction',
]);

/**
 * Applies field-level and nested schemas instead of recursively copying provider JSON.
 * Returning undefined means the item cannot be replayed without losing native semantics.
 */
export function sanitizeOpenAiResponsesItem(
  value: unknown,
  kind: ResponsesEnvelopeKind = 'response',
): RuntimeJsonObject | undefined {
  const input = objectRecord(value);
  const type = input?.type;
  if (!input || !isReplayableItemType(type)) return undefined;
  if (!itemTypeAllowedForKind(type, kind)) return undefined;

  if (type === 'message') return sanitizeMessageItem(input, kind);
  if (type === 'reasoning') return sanitizeReasoningItem(input);
  if (type === 'function_call') return sanitizeFunctionCallItem(input);
  if (type === 'function_call_output') return sanitizeFunctionCallOutputItem(input);
  return sanitizeCompactionItem(input);
}

export function sanitizeOpenAiResponsesItems(
  values: readonly unknown[],
  kind: ResponsesEnvelopeKind,
): RuntimeJsonObject[] | undefined {
  const items: RuntimeJsonObject[] = [];
  for (const value of values) {
    const item = sanitizeOpenAiResponsesItem(value, kind);
    if (!item) return undefined;
    items.push(item);
  }
  if (kind === 'compaction') {
    const compactionCount = items.filter((item) => item.type === 'compaction').length;
    if (compactionCount !== 1) return undefined;
  }
  return items;
}

export function isOpenAiResponsesOutputItemType(value: unknown): boolean {
  const type = objectRecord(value)?.type;
  return type === 'message' || type === 'reasoning' || type === 'function_call';
}

export function compatibleOpenAiResponsesItems(
  message: RuntimeMessage,
  context: ProviderReplayContext,
): RuntimeJsonObject[] | undefined {
  const metadata = message.providerMetadata;
  const envelope = metadata?.openAiResponses;
  if (!envelope || !providerMetadataMatchesReplayContext(metadata, context)) return undefined;
  const items = sanitizeOpenAiResponsesItems(envelope.items, envelope.kind);
  if (!items || !nativeItemsMatchSemanticMessage(items, message, metadata)) return undefined;
  return items.map((item) => structuredClone(item));
}

export function openAiResponsesMetadata(
  source: NonNullable<RuntimeMessageProviderMetadata['source']>,
  input: {
    kind: ResponsesEnvelopeKind;
    responseId?: string;
    items: readonly unknown[];
  },
): RuntimeMessageProviderMetadata | undefined {
  const items = sanitizeOpenAiResponsesItems(input.items, input.kind);
  if (!items || (!items.length && !input.responseId)) return undefined;
  return {
    schemaVersion: 2,
    source: { ...source },
    openAiResponses: {
      kind: input.kind,
      ...(input.responseId ? { responseId: input.responseId } : {}),
      items,
    },
  };
}

function nativeItemsMatchSemanticMessage(
  items: RuntimeJsonObject[],
  message: RuntimeMessage,
  metadata: RuntimeMessageProviderMetadata,
): boolean {
  if (!providerMetadataMatchesSemanticMessage(metadata, message)) return false;
  if (metadata.openAiResponses?.kind === 'compaction') {
    // Native compact output and the portable summary are deliberately independent products.
    // A finalized fingerprint is therefore the only safe binding between them.
    return Boolean(message.contextCompaction && metadata.semanticFingerprint);
  }

  const nativeText = items
    .filter((item) => item.type === 'message' && item.role === 'assistant')
    .map(messageItemText)
    .join('');
  if (nativeText !== portableRuntimeAssistantText(message.content)) return false;

  const nativeCalls = items
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      id: stringField(item.call_id),
      name: stringField(item.name),
      arguments: stringField(item.arguments),
    }));
  if (new Set(nativeCalls.map((call) => call.id)).size !== nativeCalls.length) return false;
  const semanticCalls = (message.toolCalls ?? []).map((call) => ({
    id: call.id,
    name: call.name,
    arguments: call.arguments,
  }));
  return nativeCalls.length === semanticCalls.length
    && nativeCalls.every((call, index) => (
      call.id === semanticCalls[index]?.id
      && call.name === semanticCalls[index]?.name
      && call.arguments === semanticCalls[index]?.arguments
    ));
}

function sanitizeMessageItem(
  input: Record<string, unknown>,
  kind: ResponsesEnvelopeKind,
): RuntimeJsonObject | undefined {
  const role = input.role ?? (kind === 'response' ? 'assistant' : undefined);
  if (!isMessageRole(role) || (kind === 'response' && role !== 'assistant')) return undefined;
  const content = sanitizeMessageContent(input.content, kind, role);
  if (content === undefined) return undefined;
  const id = optionalString(input.id);
  if (kind === 'response' && !id) return undefined;
  const status = optionalItemStatus(input.status);
  if (input.status !== undefined && !status) return undefined;
  const phase = optionalMessagePhase(input.phase);
  if (input.phase !== undefined && (role !== 'assistant' || !phase)) return undefined;
  return {
    type: 'message',
    ...(id ? { id } : {}),
    role,
    ...(status ? { status } : {}),
    ...(phase ? { phase } : {}),
    content,
  };
}

function sanitizeMessageContent(
  value: unknown,
  kind: ResponsesEnvelopeKind,
  role: string,
): RuntimeJsonValue | undefined {
  if (typeof value === 'string') return kind === 'compaction' ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const parts: RuntimeJsonObject[] = [];
  for (const valuePart of value) {
    const part = objectRecord(valuePart);
    const type = part?.type;
    if (!part || typeof type !== 'string') return undefined;
    if (type === 'output_text' && role === 'assistant') {
      const text = requiredString(part.text);
      if (text === undefined) return undefined;
      const annotations = sanitizeAnnotations(part.annotations);
      if (part.annotations !== undefined && !annotations) return undefined;
      parts.push({
        type,
        text,
        ...(annotations ? { annotations } : {}),
      });
      continue;
    }
    if (type === 'refusal' && role === 'assistant') {
      const refusal = requiredString(part.refusal);
      if (refusal === undefined) return undefined;
      parts.push({ type, refusal });
      continue;
    }
    if (type === 'input_text' && kind === 'compaction' && role !== 'assistant') {
      const text = requiredString(part.text);
      if (text === undefined) return undefined;
      parts.push({ type, text });
      continue;
    }
    return undefined;
  }
  return parts;
}

function sanitizeAnnotations(value: unknown): RuntimeJsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const annotations: RuntimeJsonObject[] = [];
  for (const valueAnnotation of value) {
    const annotation = objectRecord(valueAnnotation);
    const type = annotation?.type;
    if (!annotation || typeof type !== 'string') return undefined;
    if (type === 'file_citation') {
      const fileId = requiredString(annotation.file_id);
      const filename = requiredString(annotation.filename);
      const index = finiteNumber(annotation.index);
      if (fileId === undefined || filename === undefined || index === undefined) return undefined;
      annotations.push({ type, file_id: fileId, filename, index });
      continue;
    }
    if (type === 'url_citation') {
      const endIndex = finiteNumber(annotation.end_index);
      const startIndex = finiteNumber(annotation.start_index);
      const title = requiredString(annotation.title);
      const url = requiredString(annotation.url);
      if (endIndex === undefined || startIndex === undefined || title === undefined || url === undefined) return undefined;
      annotations.push({ type, end_index: endIndex, start_index: startIndex, title, url });
      continue;
    }
    if (type === 'container_file_citation') {
      const containerId = requiredString(annotation.container_id);
      const endIndex = finiteNumber(annotation.end_index);
      const fileId = requiredString(annotation.file_id);
      const filename = requiredString(annotation.filename);
      const startIndex = finiteNumber(annotation.start_index);
      if (
        containerId === undefined
        || endIndex === undefined
        || fileId === undefined
        || filename === undefined
        || startIndex === undefined
      ) return undefined;
      annotations.push({
        type,
        container_id: containerId,
        end_index: endIndex,
        file_id: fileId,
        filename,
        start_index: startIndex,
      });
      continue;
    }
    if (type === 'file_path') {
      const fileId = requiredString(annotation.file_id);
      const index = finiteNumber(annotation.index);
      if (fileId === undefined || index === undefined) return undefined;
      annotations.push({ type, file_id: fileId, index });
      continue;
    }
    return undefined;
  }
  return annotations;
}

function sanitizeReasoningItem(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const summary = sanitizeReasoningSummary(input.summary);
  const encryptedContent = optionalString(input.encrypted_content);
  const status = optionalItemStatus(input.status);
  if (!id || !summary || (input.status !== undefined && !status)) return undefined;
  return {
    type: 'reasoning',
    id,
    ...(status ? { status } : {}),
    summary,
    ...(encryptedContent ? { encrypted_content: encryptedContent } : {}),
  };
}

function sanitizeReasoningSummary(value: unknown): RuntimeJsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const summary: RuntimeJsonObject[] = [];
  for (const valuePart of value) {
    const part = objectRecord(valuePart);
    const text = requiredString(part?.text);
    if (!part || part.type !== 'summary_text' || text === undefined) return undefined;
    summary.push({ type: 'summary_text', text });
  }
  return summary;
}

function sanitizeFunctionCallItem(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const callId = optionalString(input.call_id);
  const name = optionalString(input.name);
  const argumentsText = requiredString(input.arguments);
  const status = optionalItemStatus(input.status);
  if (!id || !callId || !name || argumentsText === undefined || (input.status !== undefined && !status)) {
    return undefined;
  }
  return {
    type: 'function_call',
    id,
    call_id: callId,
    name,
    arguments: argumentsText,
    ...(status ? { status } : {}),
  };
}

function sanitizeFunctionCallOutputItem(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const callId = optionalString(input.call_id);
  const output = requiredString(input.output);
  const status = optionalItemStatus(input.status);
  if (!callId || output === undefined || (input.status !== undefined && !status)) return undefined;
  return {
    type: 'function_call_output',
    ...(id ? { id } : {}),
    call_id: callId,
    output,
    ...(status ? { status } : {}),
  };
}

function sanitizeCompactionItem(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const encryptedContent = optionalString(input.encrypted_content);
  if (!encryptedContent) return undefined;
  return {
    type: 'compaction',
    ...(id ? { id } : {}),
    encrypted_content: encryptedContent,
  };
}

function messageItemText(item: RuntimeJsonObject): string {
  if (typeof item.content === 'string') return item.content;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((value) => {
    const part = objectRecord(value);
    if (part?.type === 'output_text') return stringField(part.text);
    if (part?.type === 'refusal') return stringField(part.refusal);
    return '';
  }).join('');
}

function itemTypeAllowedForKind(
  type: ReplayableResponsesItemType,
  kind: ResponsesEnvelopeKind,
): boolean {
  if (kind === 'response') {
    return type === 'message' || type === 'reasoning' || type === 'function_call';
  }
  return RESPONSE_ITEM_TYPES.has(type);
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isReplayableItemType(value: unknown): value is ReplayableResponsesItemType {
  return typeof value === 'string' && RESPONSE_ITEM_TYPES.has(value as ReplayableResponsesItemType);
}

function isMessageRole(value: unknown): value is 'assistant' | 'developer' | 'system' | 'user' {
  return value === 'assistant' || value === 'developer' || value === 'system' || value === 'user';
}

function optionalItemStatus(value: unknown): 'in_progress' | 'completed' | 'incomplete' | undefined {
  return value === 'in_progress' || value === 'completed' || value === 'incomplete'
    ? value
    : undefined;
}

function optionalMessagePhase(value: unknown): 'commentary' | 'final_answer' | undefined {
  return value === 'commentary' || value === 'final_answer'
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function requiredString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
