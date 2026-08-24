import type {
  ModelRequest,
  ProviderConfigState,
  RuntimeUsage,
  RuntimeUsageRecord,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { FeatureSettingsDiagnosis } from '@setsuna-desktop/feature-core/settings';
import type { VisionRecognitionModelSelection } from './settings.js';

export const VISION_RECOGNITION_PROMPT_MAX_CHARS = 4_000;

export type VisionRecognitionHealth =
  | 'ready'
  | 'not-configured'
  | 'model-unavailable'
  | 'provider-unavailable'
  | 'settings-invalid';

export type VisionRecognitionModelOption = Readonly<{
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  modelCode: string;
}>;

export type VisionRecognitionSettingsState = Readonly<{
  selection: VisionRecognitionModelSelection;
  revision: number;
  appliedRevision: number | null;
  availableModels: readonly VisionRecognitionModelOption[];
  health: VisionRecognitionHealth;
}>;

export type VisionRecognitionSettingsUpdate = Readonly<{
  expectedRevision: number;
  selection: VisionRecognitionModelSelection;
}>;

export type VisionRecognitionTestInput = Readonly<{ prompt: string }>;

export type VisionRecognitionTestResult = Readonly<{
  content: string;
  durationMs: number;
  model?: string;
}>;

export type VisionRecognitionResult = Readonly<{
  content: string;
  attachmentId: string;
  attachmentName: string;
  providerId: string;
  modelId: string;
  model: string;
}>;

export type VisionRecognitionExecutionContext = Readonly<{
  threadId: string;
  turnId?: string;
  signal?: AbortSignal;
}>;

export interface VisionRecognitionService {
  isAvailable(): Promise<boolean>;
  readSettings(): Promise<VisionRecognitionSettingsState>;
  updateSettings(input: VisionRecognitionSettingsUpdate): Promise<VisionRecognitionSettingsState>;
  diagnoseSettings(): Promise<FeatureSettingsDiagnosis>;
  testRecognition(input: VisionRecognitionTestInput, signal?: AbortSignal): Promise<VisionRecognitionTestResult>;
  analyze(input: unknown, context: VisionRecognitionExecutionContext): Promise<VisionRecognitionResult>;
}

export const visionRecognitionServiceCapability: CapabilityToken<VisionRecognitionService> = defineCapability({
  id: 'vision-recognition.service',
  description: 'Stable vision recognition execution and settings facade',
});

export type VisionRecognitionResolvedImage = Readonly<{
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: Uint8Array;
}>;

export type VisionRecognitionTextRequest = Pick<
  ModelRequest,
  'providerId' | 'model' | 'messages' | 'maxOutputTokens' | 'tools' | 'toolChoice' | 'signal'
> & Readonly<{ maxResultChars: number }>;

export type VisionRecognitionTextResult = Readonly<{
  content: string;
  usage?: RuntimeUsage;
}>;

export type VisionRecognitionLegacySettingsAdapter = Readonly<{
  read(): Promise<VisionRecognitionModelSelection>;
  retire(): Promise<void>;
}>;

/** Native/runtime resources exposed to the Feature as one purpose-specific port. */
export interface VisionRecognitionRuntimeHost {
  listProviders(): Promise<readonly ProviderConfigState[]>;
  resolveImage(threadId: string, requestedId: string): Promise<VisionRecognitionResolvedImage>;
  generateText(input: VisionRecognitionTextRequest): Promise<VisionRecognitionTextResult>;
  recordUsage(input: Omit<RuntimeUsageRecord, 'id'>): Promise<void>;
  now(): Date;
  isMarketplacePluginInstalled(): Promise<boolean>;
  readLegacySelection(): Promise<VisionRecognitionModelSelection>;
  retireLegacySelection(): Promise<void>;
}

export const visionRecognitionRuntimeHostCapability: CapabilityToken<VisionRecognitionRuntimeHost> = defineCapability({
  id: 'vision-recognition.runtime-host',
  description: 'Host-managed model, attachment, usage, plugin, and legacy configuration boundary',
});
