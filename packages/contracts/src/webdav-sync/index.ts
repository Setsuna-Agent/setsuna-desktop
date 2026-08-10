export const DESKTOP_WEBDAV_SYNC_CATEGORY_IDS = [
  'conversations',
  'memories',
  'preferences',
  'model_credentials',
  'user_skills',
  'usage',
] as const;

export type DesktopWebDavSyncCategoryId =
  (typeof DESKTOP_WEBDAV_SYNC_CATEGORY_IDS)[number];

export const DEFAULT_DESKTOP_WEBDAV_SYNC_CATEGORIES = [
  'conversations',
  'memories',
  'preferences',
  'model_credentials',
  'user_skills',
] as const satisfies readonly DesktopWebDavSyncCategoryId[];

export type DesktopWebDavSyncRepositoryMode = 'create' | 'connect';

export type DesktopWebDavSyncConfigureInput = {
  endpoint: string;
  remoteRoot: string;
  username: string;
  /** Omit when retaining the password of an existing connection. */
  password?: string;
  allowInsecureHttp?: boolean;
  repositoryMode: DesktopWebDavSyncRepositoryMode;
  /** Required when connecting to an existing encrypted repository. */
  recoveryKey?: string;
  deviceName?: string;
};

export type DesktopWebDavSyncPreferencesInput = {
  automaticBackup?: boolean;
  categories?: DesktopWebDavSyncCategoryId[];
};

export type DesktopWebDavSyncConnectionState = {
  endpoint: string;
  remoteRoot: string;
  username: string;
  passwordSet: boolean;
  allowInsecureHttp: boolean;
  repositoryId: string;
  recoveryKeySet: boolean;
  deviceId: string;
  deviceName: string;
};

export type DesktopWebDavSyncOperationKind =
  | 'configure'
  | 'test'
  | 'backup'
  | 'list'
  | 'restore-plan'
  | 'restore';

export type DesktopWebDavSyncOperationPhase =
  | 'connecting'
  | 'waiting-for-idle'
  | 'snapshotting'
  | 'encrypting'
  | 'uploading'
  | 'publishing'
  | 'pruning'
  | 'listing'
  | 'downloading'
  | 'inspecting'
  | 'preparing-restore'
  | 'restoring';

export type DesktopWebDavSyncOperationState = {
  kind: DesktopWebDavSyncOperationKind;
  phase: DesktopWebDavSyncOperationPhase;
  startedAt: string;
  completedBytes?: number;
  totalBytes?: number;
  completedItems?: number;
  totalItems?: number;
  cancellable: boolean;
};

export type DesktopWebDavSyncState = {
  configPath: string;
  configured: boolean;
  connection?: DesktopWebDavSyncConnectionState;
  automaticBackup: boolean;
  categories: DesktopWebDavSyncCategoryId[];
  operation?: DesktopWebDavSyncOperationState;
  lastBackupAt?: string;
  lastSnapshotId?: string;
  lastError?: string;
  nextAutomaticBackupAt?: string;
};

export type DesktopWebDavSyncConfigureResult = {
  state: DesktopWebDavSyncState;
  /** Returned only once when a new encrypted repository is created. */
  recoveryKey?: string;
};

export type DesktopWebDavSyncCategorySummary = {
  id: DesktopWebDavSyncCategoryId;
  itemCount: number;
  totalBytes: number;
};

export type DesktopWebDavSyncSnapshotSummary = {
  id: string;
  deviceId: string;
  deviceName: string;
  createdAt: string;
  appVersion: string;
  categories: DesktopWebDavSyncCategorySummary[];
  totalBytes: number;
};

export type DesktopWebDavSyncSnapshotList = {
  snapshots: DesktopWebDavSyncSnapshotSummary[];
};

export type DesktopWebDavSyncRestorePlanInput = {
  snapshotId: string;
  categories: DesktopWebDavSyncCategoryId[];
};

export type DesktopWebDavSyncRestoreDiffItem = {
  id: string;
  label: string;
  detail?: string;
};

export type DesktopWebDavSyncRestoreCategoryDiff = {
  category: DesktopWebDavSyncCategoryId;
  backupItemCount: number;
  localItemCount: number;
  added: DesktopWebDavSyncRestoreDiffItem[];
  overwritten: DesktopWebDavSyncRestoreDiffItem[];
  removed: DesktopWebDavSyncRestoreDiffItem[];
  preserved: DesktopWebDavSyncRestoreDiffItem[];
  addedCount: number;
  overwrittenCount: number;
  removedCount: number;
  preservedCount: number;
  warnings: string[];
};

export type DesktopWebDavSyncRestorePlan = {
  id: string;
  snapshot: DesktopWebDavSyncSnapshotSummary;
  categories: DesktopWebDavSyncCategoryId[];
  diffs: DesktopWebDavSyncRestoreCategoryDiff[];
  createdAt: string;
  expiresAt: string;
  overwrittenCount: number;
  removedCount: number;
  projectActions: DesktopWebDavSyncRestoreProjectAction[];
};

export type DesktopWebDavSyncRestoreProjectAction = {
  sourceProjectId: string;
  name: string;
  action: 'reuse' | 'create';
  /** Existing target project id when `action` is `reuse`. */
  targetProjectId?: string;
  /** Reused projects retain this device-local directory binding. */
  directoryBound: boolean;
};

export type DesktopWebDavSyncBackupResult = {
  state: DesktopWebDavSyncState;
  snapshot: DesktopWebDavSyncSnapshotSummary;
};

export type DesktopWebDavSyncRestoreResult = {
  ok: true;
  relaunching: true;
};
