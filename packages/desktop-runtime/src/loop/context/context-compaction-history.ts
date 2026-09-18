import { normalizeRuntimeProviderEndpoint, type ModelRequest, type RuntimeConfigState, type RuntimeMessage } from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { providerMetadataMatchesSemanticMessage } from '../../utils/runtime-message-semantic-fingerprint.js';

export { restoreNativeCompactionHistory } from '@setsuna-desktop/contracts';

export function nativeCompactionMatchesModel(
  message: RuntimeMessage,
  config: RuntimeConfigState | null | undefined,
  model: Pick<ModelRequest, 'providerId' | 'model'>,
): boolean {
  const metadata = message.providerMetadata;
  const source = metadata?.source;
  const provider = config?.providers.find((item) => item.enabled && item.id === (model.providerId ?? config.activeProviderId));
  if (!provider || provider.provider !== 'openai-responses' || !source
    || source.providerId !== provider.id || source.providerKind !== provider.provider || source.model !== model.model
    || (metadata?.schemaVersion === 3 && !metadata.semanticFingerprint)
    || !providerMetadataMatchesSemanticMessage(metadata, message)) return false;
  const hasEnvelope = metadata?.schemaVersion === 3 ? Boolean(metadata.openAiResponsesCompaction?.items.length)
    : metadata?.schemaVersion === 2 && metadata.openAiResponses?.kind === 'compaction' && Boolean(metadata.openAiResponses.items.length);
  return Boolean(hasEnvelope && source.endpointFingerprint === createHash('sha256').update(normalizeRuntimeProviderEndpoint(provider.baseUrl)).digest('hex'));
}
