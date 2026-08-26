import type {
  DesktopNetworkProxyRoute,
  ModelCompactionRequest,
  ModelCompactionResult,
  ModelRequest,
  ModelStreamEvent,
  ProviderConfigInput,
  ProviderConfigState,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';

export type ModelProviderRuntimeConfig = Omit<ProviderConfigState, 'apiKeySet' | 'apiKeyPreview'> & Readonly<{
  apiKey: string;
  activeModel?: ProviderConfigState['models'][number];
}>;

export type ModelProviderReplayDecision = Readonly<{
  messageId: string;
  model: string;
  nativeItemCount: number;
  providerId: string;
  providerKind: ProviderConfigState['provider'];
  reason:
    | 'context_mismatch'
    | 'legacy_provider_mismatch'
    | 'metadata_missing'
    | 'native_envelope_invalid'
    | 'native_replay_compatible'
    | 'semantic_mismatch'
    | 'unsupported_provider';
  strategy: 'native' | 'semantic';
}>;

export type ModelProviderReplayTrace = Readonly<{
  afterEventSeq: number;
  decisions: readonly ModelProviderReplayDecision[];
  threadId: string;
  turnId: string;
}>;

export interface ModelProviderRuntimeHost {
  resolveProvider(providerId?: string): Promise<ModelProviderRuntimeConfig | null>;
  readProviderState(): Promise<ModelProviderSettingsState>;
  saveProviderState(input: ModelProviderSettingsInput): Promise<ModelProviderSettingsState>;
  fetchForRoute(route?: DesktopNetworkProxyRoute): typeof fetch;
  reportReplayDecisions?(trace: ModelProviderReplayTrace): void;
}

export type ModelProviderSettingsState = Readonly<{
  activeProviderId?: string;
  providers: ProviderConfigState[];
}>;

export type ModelProviderSettingsInput = Readonly<{
  activeProviderId?: string;
  providers: ProviderConfigInput[];
}>;

export type ModelProviderCatalogModel = Readonly<{
  code: string;
  name: string;
  contextWindowTokens?: number;
  maxOutputTokens: number;
  thinkingEnabled: boolean;
  thinkingEfforts: string[];
  defaultThinkingEffort?: string;
  supportsImages: boolean;
}>;

export type ModelProviderCatalogPlan = Readonly<{
  id: string;
  name: string;
  provider: ProviderConfigState['provider'];
  baseUrl: string;
  models: ModelProviderCatalogModel[];
}>;

export type ModelProviderCatalogProvider = Readonly<{
  id: string;
  name: string;
  plans: ModelProviderCatalogPlan[];
}>;

export type ModelProviderCatalog = Readonly<{
  generatedAt?: number;
  providers: ModelProviderCatalogProvider[];
}>;

export interface ModelProviderSamplingService {
  compactConversation?(request: ModelCompactionRequest): Promise<ModelCompactionResult>;
  stream(request: ModelRequest): AsyncGenerator<ModelStreamEvent>;
}

export const modelProviderRuntimeHostCapability: CapabilityToken<ModelProviderRuntimeHost> = defineCapability({
  id: 'model-provider.runtime-host',
  description: 'Host-owned provider secrets, persistence, and proxy routing boundary',
});

export const modelProviderSamplingCapability: CapabilityToken<ModelProviderSamplingService> = defineCapability({
  id: 'model-provider.sampling',
  description: 'Configured model sampling and native compaction service',
});
