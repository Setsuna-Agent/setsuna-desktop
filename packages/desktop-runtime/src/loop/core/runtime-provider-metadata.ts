import {
  normalizeRuntimeMessageProviderMetadata,
  type RuntimeMessage,
} from '@setsuna-desktop/contracts';

/**
 * Merges provider metadata fragments emitted during one assistant sample.
 *
 * Anthropic may emit additive block fragments. A Responses fragment represents a complete
 * envelope and therefore replaces the previous Responses envelope as a unit.
 */
export function mergeRuntimeProviderMetadata(
  previous: RuntimeMessage['providerMetadata'],
  next: NonNullable<RuntimeMessage['providerMetadata']>,
): RuntimeMessage['providerMetadata'] {
  const previousClone = previous
    ? normalizeRuntimeMessageProviderMetadata(previous)
    : undefined;
  const nextClone = normalizeRuntimeMessageProviderMetadata(next);
  if (!nextClone) return previousClone;
  const previousBlocks = previousClone?.anthropic?.contentBlocks ?? [];
  const nextBlocks = nextClone.anthropic?.contentBlocks ?? [];
  const merged = {
    ...previousClone,
    ...nextClone,
    ...(previousBlocks.length || nextBlocks.length
      ? { anthropic: { contentBlocks: [...previousBlocks, ...nextBlocks] } }
      : {}),
    ...(nextClone.openAiResponses
      ? { openAiResponses: structuredClone(nextClone.openAiResponses) }
      : previousClone?.openAiResponses
        ? { openAiResponses: structuredClone(previousClone.openAiResponses) }
        : {}),
  };
  return normalizeRuntimeMessageProviderMetadata(merged);
}
