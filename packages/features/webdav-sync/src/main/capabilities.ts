import type { RuntimeDataMigrationReadiness } from '@setsuna-desktop/contracts';
import { defineCapability, type CapabilityToken } from '@setsuna-desktop/feature-core/capability';
import type {
  ErasedFeatureSettingsDocumentDefinition,
  FeatureCredentialBackup,
  PortableFeatureSettingsDocument,
} from '@setsuna-desktop/feature-core/settings';
import type { BrowserWindow } from 'electron';

export interface WebDavSyncCredentialVault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type WebDavSyncDataLayout = Readonly<{
  generatedImagesRoot: string;
  memoriesRoot: string;
  runtimeConfigPath: string;
  runtimeDatabasePath: string;
  runtimeRoot: string;
  toolResultsRoot: string;
}>;

/** Host-owned filesystem transactions and layout knowledge used by backup/restore. */
export interface WebDavSyncStorageHost {
  dataLayout(dataRoot: string): WebDavSyncDataLayout;
  relocateDataRootContents(stagingRoot: string, sourceRoot: string, targetRoot: string): Promise<void>;
  removeFileDurably(filePath: string): Promise<void>;
  syncDirectoryDurably(directory: string): Promise<void>;
  writeJsonAtomically(filePath: string, value: unknown): Promise<void>;
}

export interface WebDavSyncRuntimeCoordinator {
  prepare(): Promise<RuntimeDataMigrationReadiness>;
  release(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
  exportPortableFeatureSettings(): Promise<readonly PortableFeatureSettingsDocument[]>;
  exportFeatureCredentialBackups(): Promise<readonly FeatureCredentialBackup[]>;
}

export interface WebDavSyncMainHost {
  readonly appVersion: string;
  readonly configPath: string;
  readonly credentialVault: WebDavSyncCredentialVault;
  readonly dataRoot: string;
  readonly featureSettingsDocuments: readonly ErasedFeatureSettingsDocumentDefinition[];
  readonly mainWindow: BrowserWindow;
  readonly runtime: WebDavSyncRuntimeCoordinator;
  readonly storage: WebDavSyncStorageHost;
  fetch(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): Promise<Response>;
  requestRelaunch(): Promise<void>;
}

export interface WebDavSyncLifecycle {
  start(): Promise<void>;
  close(): void;
}

export const webDavSyncMainHostCapability: CapabilityToken<WebDavSyncMainHost> = defineCapability({
  id: 'webdav-sync.main-host',
  description: 'Desktop storage, credentials, network, and runtime lifecycle required by WebDAV sync',
});

export const webDavSyncLifecycleCapability: CapabilityToken<WebDavSyncLifecycle> = defineCapability({
  id: 'webdav-sync.lifecycle',
  description: 'Early shutdown control for the desktop WebDAV synchronization service',
});
