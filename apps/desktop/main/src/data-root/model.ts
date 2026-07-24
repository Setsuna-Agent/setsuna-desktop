import type {
  DesktopDataMigrationCategoryId,
  DesktopDataMigrationProgress,
} from '@setsuna-desktop/contracts';

export type DataRootMarker = {
  owner: 'setsuna-desktop';
  version: 1;
  rootId: string;
  createdAt: string;
};

export type DataRootPointer = {
  version: 1;
  dataRoot: string;
  rootId: string;
  previousDataRoot?: string;
  previousRootId?: string;
  updatedAt: string;
};

export type PendingDataMigration = {
  version: 1;
  kind?: 'data_root' | 'legacy_import';
  migrationId: string;
  sourceRoot: string;
  sourceRootId?: string;
  targetRoot: string;
  targetRootId?: string;
  targetDeviceId?: string;
  legacyMemoryStoragePath?: string;
  legacyPolicyPaths?: string[];
  legacyTransactionStage?: 'scheduled' | 'prepared' | 'backup_created' | 'memory_committed';
  createdAt: string;
};

export type DesktopDataRootBootMode =
  | {
      mode: 'normal';
      activeRoot: string;
      defaultRoot: string;
      pointer?: DataRootPointer;
      completedPending?: PendingDataMigration;
    }
  | {
      mode: 'migrating';
      activeRoot: string;
      defaultRoot: string;
      pointer?: DataRootPointer;
      pending: PendingDataMigration;
    }
  | {
      mode: 'recovery';
      defaultRoot: string;
      pointer: DataRootPointer;
      reason: 'configured_root_unavailable' | 'configured_root_invalid';
      error: string;
      bootstrapIssue?: 'pending_migration' | 'committed_pending';
    };

export type DataMigrationManifestEntry = {
  absolutePath: string;
  category: DesktopDataMigrationCategoryId;
  kind: 'file' | 'symlink';
  linkTarget?: string;
  relativePath: string;
  size: number;
  mode: number;
  mtimeMs: number;
};

export type DataMigrationManifest = {
  entries: DataMigrationManifestEntry[];
  directories: Array<{
    relativePath: string;
    mode: number;
    mtimeMs: number;
  }>;
  skipped: Array<{ relativePath: string; reason: string }>;
  totalBytes: number;
  rootMode: number;
};

export type MigrationProgressListener = (progress: DesktopDataMigrationProgress) => void;
