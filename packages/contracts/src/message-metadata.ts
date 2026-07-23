import type { ModelProviderKind } from './model-provider.js';

export type RuntimeMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export type RuntimeMessagePromptSource = 'hook' | 'plan' | 'review' | 'goal' | 'runtime_context';

export type RuntimeJsonPrimitive = string | number | boolean | null;

export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue };

export type RuntimeJsonObject = {
  [key: string]: RuntimeJsonValue;
};

export type RuntimeAnthropicContentBlock =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type RuntimeProviderMetadataSource = {
  providerId: string;
  providerKind: ModelProviderKind;
  model: string;
  endpointFingerprint: string;
};

export type RuntimeMessageProviderMetadata = {
  /**
   * Missing means legacy metadata. Newly captured provider metadata always writes version 2.
   */
  schemaVersion?: 2;

  /** Identifies the exact provider replay boundary for version 2 metadata. */
  source?: RuntimeProviderMetadataSource;

  /**
   * Binds a native envelope to the finalized portable message. A mismatch forces semantic replay.
   */
  semanticFingerprint?: string;

  anthropic?: {
    /** Exact assistant blocks required when a tool result continues an Anthropic thinking turn. */
    contentBlocks: RuntimeAnthropicContentBlock[];
  };

  openAiResponses?: {
    kind: 'response' | 'compaction';
    responseId?: string;
    items: RuntimeJsonObject[];
  };
};

export const RUNTIME_PROVIDER_METADATA_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Converts an arbitrary value into a detached JSON-safe value.
 *
 * Unsupported values and cyclic references are omitted instead of leaking provider objects into
 * persisted runtime events.
 */
export function sanitizeRuntimeJsonValue(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): RuntimeJsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object' || ancestors.has(value)) return undefined;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitized = sanitizeRuntimeJsonValue(item, nextAncestors);
      return sanitized === undefined ? [] : [sanitized];
    });
  }

  const output: RuntimeJsonObject = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeRuntimeJsonValue(item, nextAncestors);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function sanitizeRuntimeJsonObject(value: unknown): RuntimeJsonObject | undefined {
  const sanitized = sanitizeRuntimeJsonValue(value);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized
    : undefined;
}

export function runtimeJsonByteLength(value: RuntimeJsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Normalizes persisted metadata without inventing native state for legacy messages.
 *
 * Unknown JSON-safe additive fields are retained for forward compatibility. Known native
 * envelopes are only retained when their shape is safe to clone and replay.
 */
export function normalizeRuntimeMessageProviderMetadata(
  value: unknown,
): RuntimeMessageProviderMetadata | undefined {
  const root = sanitizeRuntimeJsonObject(value);
  if (!root) return undefined;
  const normalized: RuntimeJsonObject = { ...root };

  if (root.schemaVersion === 2) {
    const source = normalizeProviderMetadataSource(root.source);
    if (source) {
      normalized.source = source as unknown as RuntimeJsonObject;
      normalizeV2ProviderEnvelopes(normalized, root, source.providerKind);
    } else {
      delete normalized.source;
      delete normalized.anthropic;
      delete normalized.openAiResponses;
    }
  } else if (root.schemaVersion === undefined && root.source === undefined) {
    const anthropic = normalizeAnthropicMetadata(root.anthropic);
    if (anthropic) normalized.anthropic = anthropic as unknown as RuntimeJsonObject;
    else delete normalized.anthropic;
    // OpenAI Responses envelopes were introduced with schema version 2.
    delete normalized.openAiResponses;
  } else if (root.schemaVersion === undefined) {
    // A partial V2 envelope must not inherit the permissive legacy Anthropic replay rule.
    delete normalized.anthropic;
    delete normalized.openAiResponses;
  }

  omitOversizedKnownEnvelope(normalized);
  omitEmptyKnownScaffold(normalized);
  if (!Object.keys(normalized).length) return undefined;
  // Unknown additive fields remain forward-compatible only within the same per-message cap.
  // Their semantics are opaque, so an oversized remainder must be dropped as a unit.
  if (runtimeJsonByteLength(normalized) > RUNTIME_PROVIDER_METADATA_MAX_BYTES) return undefined;
  return normalized as unknown as RuntimeMessageProviderMetadata;
}

function normalizeV2ProviderEnvelopes(
  normalized: RuntimeJsonObject,
  root: RuntimeJsonObject,
  providerKind: ModelProviderKind,
): void {
  if (!isSemanticFingerprint(root.semanticFingerprint)) {
    delete normalized.semanticFingerprint;
  }
  if (providerKind === 'anthropic') {
    const anthropic = normalizeAnthropicMetadata(root.anthropic);
    if (anthropic) normalized.anthropic = anthropic as unknown as RuntimeJsonObject;
    else delete normalized.anthropic;
    delete normalized.openAiResponses;
    return;
  }
  if (providerKind === 'openai-responses') {
    const responses = normalizeOpenAiResponsesMetadata(root.openAiResponses);
    if (responses) normalized.openAiResponses = responses as unknown as RuntimeJsonObject;
    else delete normalized.openAiResponses;
    delete normalized.anthropic;
    return;
  }
  delete normalized.anthropic;
  delete normalized.openAiResponses;
}

function normalizeProviderMetadataSource(value: unknown): RuntimeProviderMetadataSource | undefined {
  const source = sanitizeRuntimeJsonObject(value);
  if (!source) return undefined;
  const providerKind = source.providerKind;
  if (
    !nonEmptyString(source.providerId)
    || !isModelProviderKind(providerKind)
    || !nonEmptyString(source.model)
    || !isEndpointFingerprint(source.endpointFingerprint)
  ) {
    return undefined;
  }
  return {
    providerId: source.providerId,
    providerKind,
    model: source.model,
    endpointFingerprint: source.endpointFingerprint.toLowerCase(),
  };
}

function normalizeAnthropicMetadata(value: unknown): RuntimeMessageProviderMetadata['anthropic'] | undefined {
  const metadata = sanitizeRuntimeJsonObject(value);
  if (!metadata || !Array.isArray(metadata.contentBlocks)) return undefined;
  const contentBlocks: RuntimeAnthropicContentBlock[] = [];
  for (const valueBlock of metadata.contentBlocks) {
    const block = normalizeAnthropicContentBlock(valueBlock);
    if (!block) return undefined;
    contentBlocks.push(block);
  }
  return { contentBlocks };
}

function normalizeAnthropicContentBlock(value: unknown): RuntimeAnthropicContentBlock | undefined {
  const block = sanitizeRuntimeJsonObject(value);
  if (!block || !nonEmptyString(block.type)) return undefined;
  if (block.type === 'thinking' && typeof block.thinking === 'string' && typeof block.signature === 'string') {
    return { type: 'thinking', thinking: block.thinking, signature: block.signature };
  }
  if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
    return { type: 'redacted_thinking', data: block.data };
  }
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use' && nonEmptyString(block.id) && nonEmptyString(block.name)) {
    const input = sanitizeRuntimeJsonValue(block.input);
    if (input === undefined) return undefined;
    return { type: 'tool_use', id: block.id, name: block.name, input };
  }
  return undefined;
}

function normalizeOpenAiResponsesMetadata(
  value: unknown,
): RuntimeMessageProviderMetadata['openAiResponses'] | undefined {
  const metadata = sanitizeRuntimeJsonObject(value);
  if (
    !metadata
    || (metadata.kind !== 'response' && metadata.kind !== 'compaction')
    || !Array.isArray(metadata.items)
  ) {
    return undefined;
  }
  const items: RuntimeJsonObject[] = [];
  for (const valueItem of metadata.items) {
    const item = sanitizeRuntimeJsonObject(valueItem);
    if (!item) return undefined;
    items.push(item);
  }
  return {
    kind: metadata.kind,
    ...(typeof metadata.responseId === 'string' && metadata.responseId
      ? { responseId: metadata.responseId }
      : {}),
    items,
  };
}

function omitOversizedKnownEnvelope(metadata: RuntimeJsonObject): void {
  if (runtimeJsonByteLength(metadata) <= RUNTIME_PROVIDER_METADATA_MAX_BYTES) return;
  delete metadata.anthropic;
  delete metadata.openAiResponses;
}

function omitEmptyKnownScaffold(metadata: RuntimeJsonObject): void {
  const remainingKeys = Object.keys(metadata).filter(
    (key) => key !== 'schemaVersion' && key !== 'source' && key !== 'semanticFingerprint',
  );
  if (remainingKeys.length) return;
  delete metadata.schemaVersion;
  delete metadata.source;
  delete metadata.semanticFingerprint;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isModelProviderKind(value: unknown): value is ModelProviderKind {
  return value === 'openai-compatible' || value === 'openai-responses' || value === 'anthropic';
}

function isEndpointFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
}

function isSemanticFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-fA-F0-9]{64}$/.test(value);
}
