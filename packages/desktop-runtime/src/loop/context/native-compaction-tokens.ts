import type { RuntimeJsonValue, RuntimeMessageProviderMetadata } from '@setsuna-desktop/contracts';

/** Model-visible size, not serialized metadata size. Legacy opaque checkpoints retain the conservative scale. */
export function nativeCompactionTokens(metadata: RuntimeMessageProviderMetadata | undefined): number | undefined {
  const envelope = metadata?.openAiResponsesCompaction
    ?? (metadata?.openAiResponses?.kind === 'compaction' ? metadata.openAiResponses : undefined);
  if (!envelope) return undefined;
  const bytesPerOpaqueToken = metadata?.openAiResponsesCompaction?.mode === 'responses-v2' ? 12 : 4;
  return envelope.items.reduce((total, item) => {
    if (item.type === 'compaction' || item.type === 'reasoning') {
      const opaque = typeof item.encrypted_content === 'string' ? Math.ceil(item.encrypted_content.length / bytesPerOpaqueToken) : 0;
      return total + opaque + contentTokens(item.summary);
    }
    if (item.type === 'function_call') return total + contentTokens(item.name) + contentTokens(item.arguments);
    return total + contentTokens(item.content ?? item.output);
  }, 0);
}

function contentTokens(value: RuntimeJsonValue | undefined): number {
  if (typeof value === 'string') return Math.ceil(Buffer.byteLength(value, 'utf8') / 4);
  if (Array.isArray(value)) return value.reduce<number>((total, part) => total + contentTokens(part), 0);
  if (!value || typeof value !== 'object') return 0;
  if (value.type === 'input_image') return 4_096;
  if (value.type === 'input_file') return typeof value.file_data === 'string'
    ? Math.ceil(value.file_data.length / 4) : 4_096;
  return contentTokens(value.text ?? value.refusal ?? value.content);
}
