import type {
  DesktopWebDavSyncBackupResult,
  DesktopWebDavSyncCategorySummary,
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncConfigureResult,
  DesktopWebDavSyncPreferencesInput,
  DesktopWebDavSyncRestorePlan,
  DesktopWebDavSyncRestorePlanInput,
  DesktopWebDavSyncRestoreResult,
  DesktopWebDavSyncSnapshotList,
  DesktopWebDavSyncState,
} from './types.js';

export const WEB_DAV_SYNC_IPC_CHANNELS = Object.freeze({
  getState: 'webdav-sync:get-state',
  getLocalCategorySummaries: 'webdav-sync:get-local-category-summaries',
  revealRecoveryKey: 'webdav-sync:reveal-recovery-key',
  resetLocalConfiguration: 'webdav-sync:reset-local-configuration',
  configure: 'webdav-sync:configure',
  updatePreferences: 'webdav-sync:update-preferences',
  testConnection: 'webdav-sync:test',
  backupNow: 'webdav-sync:backup-now',
  listSnapshots: 'webdav-sync:list-snapshots',
  inspectRestore: 'webdav-sync:inspect-restore',
  restore: 'webdav-sync:restore',
  cancel: 'webdav-sync:cancel',
  disconnect: 'webdav-sync:disconnect',
  stateChange: 'webdav-sync:state-change',
} as const);

export interface WebDavSyncDesktopBridge {
  getState(): Promise<DesktopWebDavSyncState>;
  getLocalCategorySummaries(): Promise<DesktopWebDavSyncCategorySummary[]>;
  revealRecoveryKey(): Promise<string>;
  resetLocalConfiguration(): Promise<DesktopWebDavSyncState>;
  configure(input: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncConfigureResult>;
  updatePreferences(input: DesktopWebDavSyncPreferencesInput): Promise<DesktopWebDavSyncState>;
  /** When input is provided, verifies the draft without saving it locally. */
  testConnection(input?: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncState>;
  backupNow(): Promise<DesktopWebDavSyncBackupResult>;
  listSnapshots(): Promise<DesktopWebDavSyncSnapshotList>;
  inspectRestore(input: DesktopWebDavSyncRestorePlanInput): Promise<DesktopWebDavSyncRestorePlan>;
  restore(planId: string): Promise<DesktopWebDavSyncRestoreResult>;
  cancelCurrentOperation(): Promise<DesktopWebDavSyncState>;
  disconnect(): Promise<DesktopWebDavSyncState>;
  onStateChange(callback: (state: DesktopWebDavSyncState) => void): () => void;
}

export type WebDavSyncPreloadBridgeContribution = Readonly<{
  webdavSync: WebDavSyncDesktopBridge;
}>;
