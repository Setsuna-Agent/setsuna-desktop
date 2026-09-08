import type {
  RuntimeExtensionStatusList,
  RuntimePluginInstallResult,
  RuntimePluginItemContent,
  RuntimePluginList,
  RuntimePluginMarketplaceList,
  RuntimePluginRemoveResult,
  RuntimePluginUiActionInput,
  RuntimePluginUiActionResult,
  RuntimePluginUiStateInput,
  RuntimePluginUiStateResult,
  RuntimePluginUiDataInput,
  RuntimePluginUiDataResult,
  RuntimePluginUiDocumentReadInput,
  RuntimePluginUiDocumentReadResult,
} from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type { PluginManagementDesktopBridge } from './bridge.js';
import type {
  PluginManagementExtensionSnapshot,
  PluginManagementExtensionTrustInput,
  PluginManagementHook,
  PluginManagementHookQuery,
  PluginManagementHookSnapshot,
  PluginManagementHookStateInput,
  PluginManagementHookTarget,
  PluginManagementItemTarget,
  PluginManagementLocalInstallInput,
  PluginManagementPluginTarget,
  PluginManagementSnapshot,
} from './types.js';

export type PluginManagementHookMutationResult =
  | Readonly<{ status: 'updated'; snapshot: PluginManagementHookSnapshot }>
  | Readonly<{ status: 'not-found' | 'changed' | 'not-manageable' | 'not-standalone' }>;

/** Existing runtime adapters exposed through one management-only seam. */
export interface PluginManagementRuntimeHost {
  catalogRevision(): Promise<string>;
  getInstalledItem(input: PluginManagementItemTarget): Promise<RuntimePluginItemContent>;
  getMarketplaceItem(input: PluginManagementItemTarget): Promise<RuntimePluginItemContent>;
  installLocal(input: PluginManagementLocalInstallInput): Promise<RuntimePluginInstallResult>;
  installMarketplace(input: PluginManagementPluginTarget): Promise<RuntimePluginInstallResult>;
  listExtensions(): Promise<RuntimeExtensionStatusList>;
  listHooks(input: PluginManagementHookQuery): Promise<PluginManagementHookSnapshot>;
  listMarketplace(): Promise<RuntimePluginMarketplaceList>;
  listPlugins(): Promise<RuntimePluginList>;
  runRendererUiAction(
    input: RuntimePluginUiActionInput,
    signal?: AbortSignal,
  ): Promise<RuntimePluginUiActionResult>;
  readRendererUiState(input: RuntimePluginUiStateInput): Promise<RuntimePluginUiStateResult>;
  readRendererUiData(input: RuntimePluginUiDataInput): Promise<RuntimePluginUiDataResult>;
  readRendererUiDocument(
    input: RuntimePluginUiDocumentReadInput,
  ): Promise<RuntimePluginUiDocumentReadResult>;
  remove(input: PluginManagementPluginTarget): Promise<RuntimePluginRemoveResult>;
  setExtensionTrust(input: PluginManagementExtensionTrustInput): Promise<RuntimePluginList>;
  setHookState(input: PluginManagementHookStateInput): Promise<PluginManagementHookMutationResult>;
  deleteStandaloneHook(input: PluginManagementHookTarget): Promise<PluginManagementHookMutationResult>;
  updateMarketplace(input: PluginManagementPluginTarget): Promise<RuntimePluginInstallResult>;
}

export const pluginManagementRuntimeHostCapability: CapabilityToken<PluginManagementRuntimeHost> = defineCapability({
  id: 'plugin-management.runtime-host',
  description: 'Plugin bundle, marketplace, and extension status adapters used by plugin management',
});

export interface PluginManagementRendererHost {
  readonly bridge: PluginManagementDesktopBridge | null;
  /** Opens an allow-listed external URL through the desktop host. */
  openExternal(url: string): Promise<boolean>;
}

export const pluginManagementRendererHostCapability: CapabilityToken<PluginManagementRendererHost> = defineCapability({
  id: 'plugin-management.renderer-host',
  description: 'Native local Plugin Bundle picker exposed to the plugin management renderer',
});

export type PluginManagementRendererListener = () => void;

export interface PluginManagementRendererService {
  getSnapshot(): PluginManagementSnapshot;
  getHookSnapshot(): PluginManagementHookSnapshot;
  subscribe(listener: PluginManagementRendererListener): () => void;
  /** Subscribes only to Renderer UI data invalidations for one Plugin. */
  subscribeRendererUiData(pluginId: string, listener: PluginManagementRendererListener): () => void;
  refresh(options?: Readonly<{ signal?: AbortSignal }>): Promise<PluginManagementSnapshot>;
  refreshExtensions(options?: Readonly<{ signal?: AbortSignal }>): Promise<PluginManagementExtensionSnapshot>;
  refreshInstalled(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimePluginList>;
  getInstalledItem(
    input: PluginManagementItemTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginItemContent>;
  getMarketplaceItem(
    input: PluginManagementItemTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginItemContent>;
  installLocal(options?: Readonly<{ signal?: AbortSignal }>): Promise<RuntimePluginInstallResult | null>;
  installMarketplace(
    input: PluginManagementPluginTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginInstallResult>;
  updateMarketplace(
    input: PluginManagementPluginTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginInstallResult>;
  remove(
    input: PluginManagementPluginTarget,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginRemoveResult>;
  runRendererUiAction(
    input: RuntimePluginUiActionInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginUiActionResult>;
  readRendererUiState(
    input: RuntimePluginUiStateInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginUiStateResult>;
  readRendererUiData(
    input: RuntimePluginUiDataInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginUiDataResult>;
  readRendererUiDocument(
    input: RuntimePluginUiDocumentReadInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginUiDocumentReadResult>;
  setExtensionTrust(
    input: PluginManagementExtensionTrustInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<RuntimePluginList>;
  refreshHooks(
    input?: PluginManagementHookQuery,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot>;
  setHookEnabled(
    hook: PluginManagementHook,
    enabled: boolean,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot>;
  setHookTrust(
    hook: PluginManagementHook,
    trusted: boolean,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot>;
  deleteStandaloneHook(
    hook: PluginManagementHook,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PluginManagementHookSnapshot>;
}

export const pluginManagementRendererServiceCapability: CapabilityToken<PluginManagementRendererService> = defineCapability({
  id: 'plugin-management.renderer-service',
  description: 'Renderer state and commands for Plugin catalog management',
});
