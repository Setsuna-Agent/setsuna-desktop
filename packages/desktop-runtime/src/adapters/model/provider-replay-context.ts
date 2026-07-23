import {
  RUNTIME_PROVIDER_METADATA_MAX_BYTES,
  runtimeJsonByteLength,
  sanitizeRuntimeJsonObject,
  type ModelProviderKind,
  type RuntimeMessageProviderMetadata,
  type RuntimeProviderMetadataSource,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import type { RuntimeProviderConfig } from '../../ports/config-store.js';
import { PROVIDER_METADATA_SEMANTIC_BINDING_RESERVE_BYTES } from '../../utils/runtime-message-semantic-fingerprint.js';

export type ProviderReplayContext = {
  providerId: string;
  providerKind: ModelProviderKind;
  model: string;
  endpointFingerprint: string;
};

export function providerReplayContext(
  provider: RuntimeProviderConfig,
  model = provider.activeModel?.code ?? '',
): ProviderReplayContext {
  return {
    providerId: provider.id,
    providerKind: provider.provider,
    model,
    endpointFingerprint: providerEndpointFingerprint(provider.baseUrl),
  };
}

export function providerMetadataSource(
  context: ProviderReplayContext,
): RuntimeProviderMetadataSource {
  return {
    providerId: context.providerId,
    providerKind: context.providerKind,
    model: context.model,
    endpointFingerprint: context.endpointFingerprint,
  };
}

export function providerMetadataMatchesReplayContext(
  metadata: RuntimeMessageProviderMetadata | undefined,
  context: ProviderReplayContext,
): boolean {
  const source = metadata?.source;
  return metadata?.schemaVersion === 2
    && source?.providerId === context.providerId
    && source.providerKind === context.providerKind
    && source.model === context.model
    && source.endpointFingerprint === context.endpointFingerprint;
}

export function isLegacyAnthropicMetadata(
  metadata: RuntimeMessageProviderMetadata | undefined,
): boolean {
  return metadata !== undefined
    && metadata.schemaVersion === undefined
    && metadata.source === undefined
    && Boolean(metadata.anthropic?.contentBlocks.length);
}

export function providerMetadataFitsPersistenceLimit(
  metadata: RuntimeMessageProviderMetadata,
): boolean {
  const json = sanitizeRuntimeJsonObject(metadata);
  return Boolean(
    json
    && runtimeJsonByteLength(json)
      <= RUNTIME_PROVIDER_METADATA_MAX_BYTES - PROVIDER_METADATA_SEMANTIC_BINDING_RESERVE_BYTES,
  );
}

/** Produces a stable hash without persisting the configured endpoint itself. */
export function providerEndpointFingerprint(baseUrl: string): string {
  return createHash('sha256').update(normalizeProviderBaseUrl(baseUrl)).digest('hex');
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.searchParams.sort();
    const path = url.pathname === '/' ? '' : url.pathname;
    const credentials = url.username || url.password
      ? `${url.username}${url.password ? `:${url.password}` : ''}@`
      : '';
    return `${url.protocol}//${credentials}${url.host}${path}${url.search}`;
  } catch {
    // Request validation reports malformed URLs later; hashing still needs a stable boundary.
    return trimmed.replace(/\/+$/, '');
  }
}
