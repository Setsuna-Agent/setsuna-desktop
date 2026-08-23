import type {
  DesktopImageActionResult,
  DesktopImageDataResult,
  RuntimeGeneratedMessageAttachment,
  RuntimeMessageAttachment,
  RuntimePermissionProfile,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { FeatureSettingsDiagnosis } from '@setsuna-desktop/feature-core/settings';
import type {
  ImageGenerationConnection,
  ImageGenerationConnectionPatch,
  ImageGenerationPublicConnection,
  ImageGenerationSecretPatch,
} from './settings.js';

export const IMAGE_GENERATION_TEST_PROMPT_MAX_CHARS = 4_000;

export type ImageGenerationHealth =
  | 'ready'
  | 'not-configured'
  | 'credentials-missing'
  | 'provider-unavailable'
  | 'settings-invalid';

export type ImageGenerationSettingsState = Readonly<{
  value: ImageGenerationPublicConnection;
  revision: number;
  appliedRevision: number | null;
  health: ImageGenerationHealth;
}>;

export type ImageGenerationSettingsUpdate = Readonly<{
  expectedRevision: number;
  patch: ImageGenerationConnectionPatch;
  secretPatch?: ImageGenerationSecretPatch;
}>;

export type ImageGenerationTestInput = Readonly<{ prompt: string }>;

export type ImageGenerationTestResult = Readonly<{
  images: RuntimeGeneratedMessageAttachment[];
  durationMs: number;
  model?: string;
}>;

export type ImageGenerationWorkspaceFile = Readonly<{
  path: string;
  projectId: string;
}>;

export type ImageGenerationResult = Readonly<{
  attachments: RuntimeMessageAttachment[];
  workspaceFiles: ImageGenerationWorkspaceFile[];
  revisedPrompts: string[];
  model?: string;
  size?: string;
}>;

export type ImageGenerationExecutionContext = Readonly<{
  threadId: string;
  projectId?: string;
  turnId?: string;
  toolCallId?: string;
  environment?: Readonly<{
    id: string;
    workspaceProjectId?: string;
  }>;
  permissionProfile?: RuntimePermissionProfile;
  signal?: AbortSignal;
}>;

export type ImageGenerationTurnCleanupOutcome = Readonly<{
  status: 'completed' | 'cancelled' | 'failed';
}>;

export interface ImageGenerationService {
  isAvailable(): Promise<boolean>;
  readSettings(): Promise<ImageGenerationSettingsState>;
  updateSettings(input: ImageGenerationSettingsUpdate): Promise<ImageGenerationSettingsState>;
  diagnoseSettings(): Promise<FeatureSettingsDiagnosis>;
  testGeneration(input: ImageGenerationTestInput, signal?: AbortSignal): Promise<ImageGenerationTestResult>;
  generate(input: unknown, context: ImageGenerationExecutionContext): Promise<ImageGenerationResult>;
  cleanupTurn(
    context: ImageGenerationExecutionContext,
    outcome: ImageGenerationTurnCleanupOutcome,
  ): Promise<void>;
}

export const imageGenerationServiceCapability: CapabilityToken<ImageGenerationService> = defineCapability({
  id: 'image-generation.service',
  major: 1,
  description: 'Stable image generation execution and settings facade',
});

export interface ImageGenerationGeneratedImageStore {
  create(input: Readonly<{ name: string; type: string; data: Uint8Array }>): Promise<{ assetId: string }>;
  delete(assetId: string): Promise<void>;
}

export const imageGenerationAssetStoreCapability: CapabilityToken<ImageGenerationGeneratedImageStore> = defineCapability({
  id: 'image-generation.asset-store',
  major: 1,
  description: 'Host-managed generated image asset persistence',
});

export type ImageGenerationReferenceReader = Readonly<{
  listThreads(query?: Readonly<{ includeArchived?: boolean; includeSide?: boolean }>): Promise<readonly { id: string }[]>;
  getThread(threadId: string): Promise<Readonly<{
    messages: readonly Readonly<{ attachments?: readonly RuntimeMessageAttachment[] }>[];
  }> | null>;
}>;

export const imageGenerationReferenceReaderCapability: CapabilityToken<ImageGenerationReferenceReader> = defineCapability({
  id: 'image-generation.reference-reader',
  major: 1,
  description: 'Read generated image references retained by thread snapshots',
});

export type ImageGenerationWorkspaceFiles = Readonly<{
  writeBinaryFile(projectId: string, relativePath: string, content: Uint8Array): Promise<{ path: string }>;
  deleteFile(projectId: string, relativePath: string): Promise<void>;
}>;

export const imageGenerationWorkspaceFilesCapability: CapabilityToken<ImageGenerationWorkspaceFiles | null> = defineCapability({
  id: 'image-generation.workspace-files',
  major: 1,
  description: 'Optional workspace file persistence for generated images',
});

export type ImageGenerationNetwork = Readonly<{
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}>;

export const imageGenerationNetworkCapability: CapabilityToken<ImageGenerationNetwork> = defineCapability({
  id: 'image-generation.network',
  major: 1,
  description: 'Host-routed network transport for image providers',
});

export type LegacyImageGenerationSettings = Readonly<{
  connection: ImageGenerationConnection;
  apiKey: string;
}>;

export type ImageGenerationLegacySettingsAdapter = Readonly<{
  read(): Promise<LegacyImageGenerationSettings>;
  retire(): Promise<void>;
}>;

export const imageGenerationLegacySettingsCapability: CapabilityToken<ImageGenerationLegacySettingsAdapter> = defineCapability({
  id: 'image-generation.legacy-settings',
  major: 1,
  description: 'One-way reader and cleanup adapter for pre-Feature image settings',
});

export type ImageGenerationRendererAssets = Readonly<{
  read(assetId: string): Promise<DesktopImageDataResult>;
  copy(input: Readonly<{ assetId: string; name: string }>): Promise<DesktopImageActionResult>;
  reveal(input: Readonly<{ assetId: string; name: string }>): Promise<DesktopImageActionResult>;
}>;

export const imageGenerationRendererAssetsCapability: CapabilityToken<ImageGenerationRendererAssets> = defineCapability({
  id: 'image-generation.renderer-assets',
  major: 1,
  description: 'Narrow renderer bridge for generated image preview and desktop actions',
});
