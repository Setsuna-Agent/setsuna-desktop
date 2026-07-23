import {
  normalizeRuntimeMessageProviderMetadata,
  sanitizeRuntimeJsonValue,
  type RuntimeJsonValue,
  type RuntimeMessage,
  type RuntimeMessageProviderMetadata,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';

/** Space reserved before persistence for `"semanticFingerprint":"sha256:…"` and JSON syntax. */
export const PROVIDER_METADATA_SEMANTIC_BINDING_RESERVE_BYTES = 128;

/**
 * Hashes only the portable fields that can affect a provider request. This lets the runtime
 * detect post-capture edits (for example, a collaboration wait note) before native replay.
 */
export function runtimeMessageSemanticFingerprint(message: RuntimeMessage): string {
  const semanticValue = {
    role: message.role,
    content: message.content,
    toolCallId: message.toolCallId ?? null,
    toolName: message.toolName ?? null,
    toolCalls: (message.toolCalls ?? []).map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    })),
    attachments: sanitizeRuntimeJsonValue(message.attachments ?? []) ?? [],
  };
  return `sha256:${createHash('sha256').update(stableJson(semanticValue)).digest('hex')}`;
}

export function bindProviderMetadataToSemanticMessage(
  metadata: RuntimeMessageProviderMetadata | undefined,
  message: RuntimeMessage,
): RuntimeMessageProviderMetadata | undefined {
  const normalized = normalizeRuntimeMessageProviderMetadata(metadata);
  if (!normalized || normalized.schemaVersion !== 2 || !normalized.source) return normalized;
  return normalizeRuntimeMessageProviderMetadata({
    ...normalized,
    semanticFingerprint: runtimeMessageSemanticFingerprint(message),
  });
}

export function providerMetadataMatchesSemanticMessage(
  metadata: RuntimeMessageProviderMetadata | undefined,
  message: RuntimeMessage,
): boolean {
  const fingerprint = metadata?.semanticFingerprint;
  return !fingerprint || fingerprint === runtimeMessageSemanticFingerprint(message);
}

export function portableRuntimeAssistantText(value: string): string {
  return value.replace(/<think>[\s\S]*?<\/think>/giu, '');
}

export function runtimeJsonValuesEqual(left: unknown, right: unknown): boolean {
  const leftValue = sanitizeRuntimeJsonValue(left);
  const rightValue = sanitizeRuntimeJsonValue(right);
  return leftValue !== undefined
    && rightValue !== undefined
    && stableJson(leftValue) === stableJson(rightValue);
}

function stableJson(value: RuntimeJsonValue | Record<string, unknown>): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): RuntimeJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  );
}
