import type { RuntimeJsonObject, RuntimeJsonValue } from './runtime-json.js';

type ResponsesEnvelopeKind = 'response' | 'compaction';
type ReplayableItemType = 'message' | 'reasoning' | 'function_call' | 'function_call_output' | 'compaction';

const REPLAYABLE_ITEM_TYPES = new Set<ReplayableItemType>([
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
  'compaction',
]);

/**
 * Persists only the Responses fields required for stateless replay. Validation is all-or-nothing:
 * a compatible endpoint returning one malformed companion item must not poison future requests.
 */
export function sanitizeResponsesItems(
  values: readonly unknown[],
  kind: ResponsesEnvelopeKind,
): RuntimeJsonObject[] | undefined {
  const items: RuntimeJsonObject[] = [];
  for (const value of values) {
    const input = objectRecord(value);
    const type = input?.type;
    if (!input || !isReplayableItemType(type) || !itemTypeAllowed(type, kind)) return undefined;
    const item = type === 'message'
      ? sanitizeMessage(input, kind)
      : type === 'reasoning'
        ? sanitizeReasoning(input)
        : type === 'function_call'
          ? sanitizeFunctionCall(input)
          : type === 'function_call_output'
            ? sanitizeFunctionCallOutput(input)
            : sanitizeCompaction(input);
    if (!item) return undefined;
    items.push(item);
  }
  if (kind === 'compaction' && items.filter((item) => item.type === 'compaction').length !== 1) {
    return undefined;
  }
  return items;
}

function sanitizeMessage(input: Record<string, unknown>, kind: ResponsesEnvelopeKind): RuntimeJsonObject | undefined {
  const role = input.role ?? (kind === 'response' ? 'assistant' : undefined);
  if (!isMessageRole(role) || (kind === 'response' && role !== 'assistant')) return undefined;
  const content = sanitizeMessageContent(input.content, kind, role);
  if (content === undefined) return undefined;
  const id = optionalString(input.id);
  if (kind === 'response' && !id) return undefined;
  const status = optionalStatus(input.status);
  if (input.status !== undefined && !status) return undefined;
  const phase = optionalPhase(input.phase);
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
    if (!part) return undefined;
    if (part.type === 'output_text' && role === 'assistant' && typeof part.text === 'string') {
      const annotations = sanitizeAnnotations(part.annotations);
      if (part.annotations !== undefined && !annotations) return undefined;
      parts.push({ type: 'output_text', text: part.text, ...(annotations ? { annotations } : {}) });
      continue;
    }
    if (part.type === 'refusal' && role === 'assistant' && typeof part.refusal === 'string') {
      parts.push({ type: 'refusal', refusal: part.refusal });
      continue;
    }
    if (part.type === 'input_text' && kind === 'compaction' && role !== 'assistant' && typeof part.text === 'string') {
      parts.push({ type: 'input_text', text: part.text });
      continue;
    }
    if (part.type === 'input_image' && kind === 'compaction' && role === 'user') {
      const image = sanitizeInputImage(part);
      if (!image) return undefined;
      parts.push(image);
      continue;
    }
    if (part.type === 'input_file' && kind === 'compaction' && role === 'user') {
      const file = sanitizeInputFile(part);
      if (!file) return undefined;
      parts.push(file);
      continue;
    }
    return undefined;
  }
  return parts;
}

function sanitizeInputImage(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const imageUrl = optionalString(input.image_url);
  const fileId = optionalString(input.file_id);
  const detail = input.detail === undefined ? undefined : input.detail;
  if ((!imageUrl && !fileId) || (imageUrl && fileId) || (detail !== undefined && !isImageDetail(detail))) {
    return undefined;
  }
  return {
    type: 'input_image',
    ...(imageUrl ? { image_url: imageUrl } : { file_id: fileId! }),
    ...(detail ? { detail } : {}),
  };
}

function sanitizeInputFile(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const sources = ['file_data', 'file_id', 'file_url']
    .map((key) => [key, optionalString(input[key])] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  if (sources.length !== 1) return undefined;
  const filename = optionalString(input.filename);
  return {
    type: 'input_file',
    [sources[0]![0]]: sources[0]![1],
    ...(filename ? { filename } : {}),
  };
}

function sanitizeAnnotations(value: unknown): RuntimeJsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const output: RuntimeJsonObject[] = [];
  for (const valueAnnotation of value) {
    const annotation = objectRecord(valueAnnotation);
    if (!annotation || typeof annotation.type !== 'string') return undefined;
    if (annotation.type === 'file_citation') {
      if (!isString(annotation.file_id) || !isString(annotation.filename) || !isNumber(annotation.index)) return undefined;
      output.push({ type: annotation.type, file_id: annotation.file_id, filename: annotation.filename, index: annotation.index });
      continue;
    }
    if (annotation.type === 'url_citation') {
      if (!isNumber(annotation.end_index) || !isNumber(annotation.start_index)
        || !isString(annotation.title) || !isString(annotation.url)) return undefined;
      output.push({
        type: annotation.type,
        end_index: annotation.end_index,
        start_index: annotation.start_index,
        title: annotation.title,
        url: annotation.url,
      });
      continue;
    }
    if (annotation.type === 'container_file_citation') {
      if (!isString(annotation.container_id) || !isNumber(annotation.end_index)
        || !isString(annotation.file_id) || !isString(annotation.filename)
        || !isNumber(annotation.start_index)) return undefined;
      output.push({
        type: annotation.type,
        container_id: annotation.container_id,
        end_index: annotation.end_index,
        file_id: annotation.file_id,
        filename: annotation.filename,
        start_index: annotation.start_index,
      });
      continue;
    }
    if (annotation.type === 'file_path') {
      if (!isString(annotation.file_id) || !isNumber(annotation.index)) return undefined;
      output.push({ type: annotation.type, file_id: annotation.file_id, index: annotation.index });
      continue;
    }
    return undefined;
  }
  return output;
}

function sanitizeReasoning(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const summary = sanitizeReasoningSummary(input.summary);
  const encryptedContent = optionalString(input.encrypted_content);
  const status = optionalStatus(input.status);
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
  const output: RuntimeJsonObject[] = [];
  for (const valuePart of value) {
    const part = objectRecord(valuePart);
    if (!part || part.type !== 'summary_text' || typeof part.text !== 'string') return undefined;
    output.push({ type: 'summary_text', text: part.text });
  }
  return output;
}

function sanitizeFunctionCall(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const callId = optionalString(input.call_id);
  const name = optionalString(input.name);
  const status = optionalStatus(input.status);
  if (!id || !callId || !name || typeof input.arguments !== 'string'
    || (input.status !== undefined && !status)) return undefined;
  return {
    type: 'function_call',
    id,
    call_id: callId,
    name,
    arguments: input.arguments,
    ...(status ? { status } : {}),
  };
}

function sanitizeFunctionCallOutput(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const callId = optionalString(input.call_id);
  const status = optionalStatus(input.status);
  if (!callId || typeof input.output !== 'string' || (input.status !== undefined && !status)) return undefined;
  return {
    type: 'function_call_output',
    ...(id ? { id } : {}),
    call_id: callId,
    output: input.output,
    ...(status ? { status } : {}),
  };
}

function sanitizeCompaction(input: Record<string, unknown>): RuntimeJsonObject | undefined {
  const id = optionalString(input.id);
  const encryptedContent = optionalString(input.encrypted_content);
  return encryptedContent
    ? { type: 'compaction', ...(id ? { id } : {}), encrypted_content: encryptedContent }
    : undefined;
}

function itemTypeAllowed(type: ReplayableItemType, kind: ResponsesEnvelopeKind): boolean {
  return kind === 'compaction'
    || type === 'message'
    || type === 'reasoning'
    || type === 'function_call';
}

function isReplayableItemType(value: unknown): value is ReplayableItemType {
  return typeof value === 'string' && REPLAYABLE_ITEM_TYPES.has(value as ReplayableItemType);
}

function isMessageRole(value: unknown): value is 'assistant' | 'developer' | 'system' | 'user' {
  return value === 'assistant' || value === 'developer' || value === 'system' || value === 'user';
}

function optionalStatus(value: unknown): 'in_progress' | 'completed' | 'incomplete' | undefined {
  return value === 'in_progress' || value === 'completed' || value === 'incomplete' ? value : undefined;
}

function optionalPhase(value: unknown): 'commentary' | 'final_answer' | undefined {
  return value === 'commentary' || value === 'final_answer' ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isImageDetail(value: unknown): value is 'auto' | 'high' | 'low' {
  return value === 'auto' || value === 'high' || value === 'low';
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
