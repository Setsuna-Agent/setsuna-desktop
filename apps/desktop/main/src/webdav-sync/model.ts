import type {
  DesktopWebDavSyncCategoryId,
  DesktopWebDavSyncSnapshotSummary,
} from '@setsuna-desktop/contracts';

export const WEB_DAV_SYNC_STORE_VERSION = 2;
export const WEB_DAV_REPOSITORY_FORMAT_VERSION = 1;
export const WEB_DAV_SNAPSHOT_FORMAT_VERSION = 1;

export type StoredWebDavSyncConnection = {
  endpoint: string;
  remoteRoot: string;
  username: string;
  allowInsecureHttp: boolean;
  repositoryId: string;
  passwordCredentialKey: string;
  recoveryKeyCredentialKey: string;
};

export type StoredWebDavSyncConfig = {
  version: number;
  deviceId: string;
  deviceName: string;
  automaticBackup: boolean;
  categories: DesktopWebDavSyncCategoryId[];
  connection?: StoredWebDavSyncConnection;
  lastBackupAt?: string;
  lastSnapshotId?: string;
  pendingCredentialCleanupKeys: string[];
};

export type ResolvedWebDavSyncConnection = StoredWebDavSyncConnection & {
  password: string;
  recoveryKey: string;
};

export type WebDavRepositoryMetadata = {
  formatVersion: number;
  repositoryId: string;
  createdAt: string;
  keyVerifier: string;
};

export type WebDavSnapshotItemKind =
  | 'file'
  | 'provider-key'
  | 'image-generation-key'
  | 'project-catalog';

export type WebDavSnapshotManifestItem = {
  category: DesktopWebDavSyncCategoryId;
  kind: WebDavSnapshotItemKind;
  logicalPath: string;
  label: string;
  detail?: string;
  credentialId?: string;
  /** Only owner execution is restored, and only for user Skill files. */
  executable?: boolean;
  objectName: string;
  sha256: string;
  size: number;
};

export type WebDavSnapshotManifest = {
  formatVersion: number;
  repositoryId: string;
  id: string;
  deviceId: string;
  deviceName: string;
  createdAt: string;
  appVersion: string;
  sourceDataRoot: string;
  categories: DesktopWebDavSyncCategoryId[];
  items: WebDavSnapshotManifestItem[];
};

export type WebDavSnapshotRecord = {
  manifest: WebDavSnapshotManifest;
  summary: DesktopWebDavSyncSnapshotSummary;
};

export type WebDavSnapshotCompleteMarker = {
  formatVersion: number;
  snapshotId: string;
};

export type LocalSnapshotSource = {
  category: DesktopWebDavSyncCategoryId;
  kind: WebDavSnapshotItemKind;
  logicalPath: string;
  label: string;
  detail?: string;
  credentialId?: string;
  executable?: boolean;
  sourcePath?: string;
  data?: Buffer;
};

export type LocalSnapshotInventoryItem = Omit<
  WebDavSnapshotManifestItem,
  'objectName'
>;
