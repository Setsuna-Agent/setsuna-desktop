import type { ModelProviderKind } from './model-provider.js';
import { sanitizeResponsesItems } from './responses-items.js';
import {
  runtimeJsonByteLength,
  sanitizeRuntimeJsonObject,
  sanitizeRuntimeJsonValue,
  type RuntimeJsonObject,
  type RuntimeJsonValue,
} from './runtime-json.js';

export {
  runtimeJsonByteLength,
  sanitizeRuntimeJsonObject,
  sanitizeRuntimeJsonValue,
  type RuntimeJsonObject,
  type RuntimeJsonPrimitive,
  type RuntimeJsonValue,
} from './runtime-json.js';

export type RuntimeMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

/** Matches the Codex App Server / Responses wire values for assistant presentation. */
export type RuntimeAssistantMessagePhase = 'commentary' | 'final_answer';

export type RuntimeMessagePromptSource = 'hook' | 'plan' | 'review' | 'goal' | 'runtime_context' | 'collaboration';

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

export type RuntimeProviderReplayBlock =
  | { type: 'text'; text: string; signature?: string }
  | { type: 'thinking'; text: string; signature?: string; redacted?: boolean }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      arguments: RuntimeJsonValue;
      itemId?: string;
      thoughtSignature?: string;
      namespace?: string;
    };

export type RuntimeMessageProviderMetadata = {
  /**
   * Missing means legacy metadata. Version 2 stores protocol-native envelopes; version 3 stores
   * replay-critical blocks without coupling persisted events to a provider SDK.
   */
  schemaVersion?: 2 | 3;

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

  assistantReplay?: {
    responseId?: string;
    blocks: RuntimeProviderReplayBlock[];
  };

  openAiResponsesCompaction?: {
    responseId?: string;
    items: RuntimeJsonObject[];
  };
};

export const RUNTIME_PROVIDER_METADATA_MAX_BYTES = 2 * 1024 * 1024;

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

  if (root.schemaVersion === 2 || root.schemaVersion === 3) {
    const source = normalizeProviderMetadataSource(root.source);
    if (source) {
      normalized.source = source as unknown as RuntimeJsonObject;
      if (root.schemaVersion === 2) normalizeV2ProviderEnvelopes(normalized, root, source.providerKind);
      else normalizeV3ProviderEnvelopes(normalized, root, source.providerKind);
    } else {
      delete normalized.source;
      delete normalized.anthropic;
      delete normalized.openAiResponses;
      delete normalized.assistantReplay;
      delete normalized.openAiResponsesCompaction;
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
    delete normalized.assistantReplay;
    delete normalized.openAiResponsesCompaction;
  }

  omitOversizedKnownEnvelope(normalized);
  omitEmptyKnownScaffold(normalized);
  if (!Object.keys(normalized).length) return undefined;
  // Unknown additive fields remain forward-compatible only within the same per-message cap.
  // Their semantics are opaque, so an oversized remainder must be dropped as a unit.
  if (runtimeJsonByteLength(normalized) > RUNTIME_PROVIDER_METADATA_MAX_BYTES) return undefined;
  return normalized as unknown as RuntimeMessageProviderMetadata;
}

function normalizeV3ProviderEnvelopes(
  normalized: RuntimeJsonObject,
  root: RuntimeJsonObject,
  providerKind: ModelProviderKind,
): void {
  if (!isSemanticFingerprint(root.semanticFingerprint)) delete normalized.semanticFingerprint;
  const replay = normalizeAssistantReplay(root.assistantReplay);
  if (replay) normalized.assistantReplay = replay as unknown as RuntimeJsonObject;
  else delete normalized.assistantReplay;
  const compaction = providerKind === 'openai-responses'
    ? normalizeV3ResponsesCompaction(root.openAiResponsesCompaction)
    : undefined;
  if (compaction) normalized.openAiResponsesCompaction = compaction as unknown as RuntimeJsonObject;
  else delete normalized.openAiResponsesCompaction;
  delete normalized.anthropic;
  delete normalized.openAiResponses;
}

function normalizeAssistantReplay(
  value: unknown,
): RuntimeMessageProviderMetadata['assistantReplay'] | undefined {
  const replay = sanitizeRuntimeJsonObject(value);
  if (!replay || !Array.isArray(replay.blocks)) return undefined;
  const blocks: RuntimeProviderReplayBlock[] = [];
  for (const valueBlock of replay.blocks) {
    const block = normalizeReplayBlock(valueBlock);
    if (!block) return undefined;
    blocks.push(block);
  }
  if (!blocks.length && typeof replay.responseId !== 'string') return undefined;
  return {
    ...(typeof replay.responseId === 'string' && replay.responseId
      ? { responseId: replay.responseId }
      : {}),
    blocks,
  };
}

function normalizeReplayBlock(value: unknown): RuntimeProviderReplayBlock | undefined {
  const block = sanitizeRuntimeJsonObject(value);
  if (!block || !nonEmptyString(block.type)) return undefined;
  if (block.type === 'text' && typeof block.text === 'string') {
    return {
      type: 'text',
      text: block.text,
      ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
    };
  }
  if (block.type === 'thinking' && typeof block.text === 'string') {
    return {
      type: 'thinking',
      text: block.text,
      ...(typeof block.signature === 'string' ? { signature: block.signature } : {}),
      ...(block.redacted === true ? { redacted: true } : {}),
    };
  }
  if (
    block.type !== 'tool_call'
    || !nonEmptyString(block.id)
    || !nonEmptyString(block.name)
  ) return undefined;
  const argumentsValue = sanitizeRuntimeJsonValue(block.arguments);
  if (argumentsValue === undefined) return undefined;
  return {
    type: 'tool_call',
    id: block.id,
    name: block.name,
    arguments: argumentsValue,
    ...(typeof block.itemId === 'string' && block.itemId ? { itemId: block.itemId } : {}),
    ...(typeof block.thoughtSignature === 'string'
      ? { thoughtSignature: block.thoughtSignature }
      : {}),
    ...(typeof block.namespace === 'string' ? { namespace: block.namespace } : {}),
  };
}

function normalizeV3ResponsesCompaction(
  value: unknown,
): RuntimeMessageProviderMetadata['openAiResponsesCompaction'] | undefined {
  const compaction = sanitizeRuntimeJsonObject(value);
  if (!compaction || !Array.isArray(compaction.items)) return undefined;
  const items = sanitizeResponsesItems(compaction.items, 'compaction');
  if (!items?.length) return undefined;
  return {
    ...(typeof compaction.responseId === 'string' && compaction.responseId
      ? { responseId: compaction.responseId }
      : {}),
    items,
  };
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
  const items = sanitizeResponsesItems(metadata.items, metadata.kind);
  if (!items) return undefined;
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
  delete metadata.assistantReplay;
  delete metadata.openAiResponsesCompaction;
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
