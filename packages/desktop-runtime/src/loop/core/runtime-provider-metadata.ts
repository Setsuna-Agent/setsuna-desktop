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
    ...(nextClone.assistantReplay
      ? { assistantReplay: structuredClone(nextClone.assistantReplay) }
      : previousClone?.assistantReplay
        ? { assistantReplay: structuredClone(previousClone.assistantReplay) }
        : {}),
    ...(nextClone.openAiResponsesCompaction
      ? { openAiResponsesCompaction: structuredClone(nextClone.openAiResponsesCompaction) }
      : previousClone?.openAiResponsesCompaction
        ? { openAiResponsesCompaction: structuredClone(previousClone.openAiResponsesCompaction) }
        : {}),
  };
  return normalizeRuntimeMessageProviderMetadata(merged);
}

/**
 * Keeps provider replay metadata aligned with the tool calls the runtime will actually execute.
 *
 * OpenAI response IDs are detached whenever a model-emitted call is removed: the remote response
 * still contains that call, so continuing from it would require a tool result that the runtime
 * intentionally did not create.
 */
export function retainRuntimeProviderToolCalls(
  metadata: RuntimeMessage['providerMetadata'],
  retainedToolCallIds: ReadonlySet<string>,
): RuntimeMessage['providerMetadata'] {
  const normalized = metadata
    ? normalizeRuntimeMessageProviderMetadata(metadata)
    : undefined;
  if (!normalized) return undefined;

  const next = structuredClone(normalized);
  if (next.assistantReplay) {
    next.assistantReplay.blocks = next.assistantReplay.blocks.filter((block) => (
      block.type !== 'tool_call' || retainedToolCallIds.has(block.id)
    ));
    delete next.assistantReplay.responseId;
  }
  if (next.anthropic) {
    next.anthropic.contentBlocks = next.anthropic.contentBlocks.filter((block) => (
      block.type !== 'tool_use' || retainedToolCallIds.has(block.id)
    ));
  }
  if (next.openAiResponses) {
    next.openAiResponses.items = next.openAiResponses.items.filter((item) => (
      item.type !== 'function_call'
      || typeof item.call_id !== 'string'
      || retainedToolCallIds.has(item.call_id)
    ));
    delete next.openAiResponses.responseId;
  }
  return normalizeRuntimeMessageProviderMetadata(next);
}
