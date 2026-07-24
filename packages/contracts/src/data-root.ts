export const DESKTOP_DATA_MIGRATION_CATEGORY_IDS = [
  'conversations',
  'settings_credentials',
  'projects_capabilities',
  'memories',
  'attachments_images',
  'runtime_dependencies',
  'desktop_browser',
] as const;

export type DesktopDataMigrationCategoryId =
  (typeof DESKTOP_DATA_MIGRATION_CATEGORY_IDS)[number];

export type DesktopDataMigrationCategorySummary = {
  id: DesktopDataMigrationCategoryId;
  fileCount: number;
  totalBytes: number;
  /** Domain records represented by the files, when the category supports a stable count. */
  recordCount?: number;
};

export type DesktopDataMigrationIssueCode =
  | 'active_turns'
  | 'existing_setsuna_data'
  | 'insufficient_space'
  | 'invalid_source'
  | 'invalid_target'
  | 'network_or_cloud_location'
  | 'same_directory'
  | 'source_target_nested'
  | 'symlink_not_supported'
  | 'target_unavailable'
  | 'target_not_empty'
  | 'unsupported_file';

export type DesktopDataMigrationIssue = {
  code: DesktopDataMigrationIssueCode;
  message: string;
  path?: string;
};

export type DesktopDataMigrationPlan = {
  planId: string;
  sourceRoot: string;
  targetRoot: string;
  totalFiles: number;
  totalBytes: number;
  requiredBytes: number;
  availableBytes: number;
  categories: DesktopDataMigrationCategorySummary[];
  blockers: DesktopDataMigrationIssue[];
  warnings: DesktopDataMigrationIssue[];
  createdAt: string;
};

export type DesktopDataMigrationPhase =
  | 'scanning'
  | 'copying'
  | 'merging_memory'
  | 'validating'
  | 'committing'
  | 'restarting'
  | 'failed';

export type DesktopDataMigrationCategoryStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type DesktopDataMigrationCategoryProgress =
  DesktopDataMigrationCategorySummary & {
    completedFiles: number;
    completedBytes: number;
    status: DesktopDataMigrationCategoryStatus;
  };

export type DesktopDataMigrationError = {
  code: string;
  message: string;
  path?: string;
};

export type DesktopDataMigrationProgress = {
  operation: 'relocate' | 'legacy_import';
  phase: DesktopDataMigrationPhase;
  sourceRoot: string;
  targetRoot: string;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  currentCategory?: DesktopDataMigrationCategoryId;
  currentRelativePath?: string;
  categories: DesktopDataMigrationCategoryProgress[];
  error?: DesktopDataMigrationError;
};

export type DesktopDataRootRetainedBackup = {
  id: string;
  path: string;
  createdAt: string;
  promptOnStartup: boolean;
};

export type DesktopDataRootRetainedBackupInspection = {
  id: string;
  path: string;
  status: 'ready' | 'unavailable' | 'changed';
  fileCount: number;
  totalBytes: number;
  error?: DesktopDataMigrationError;
};

export type DesktopDataRootState =
  | {
      mode: 'normal';
      activeRoot: string;
      defaultRoot: string;
      previousRoot?: string;
      isCustom: boolean;
      retainedBackups: DesktopDataRootRetainedBackup[];
    }
  | {
      mode: 'migrating';
      activeRoot: string;
      defaultRoot: string;
      previousRoot?: string;
      migration: DesktopDataMigrationProgress;
    }
  | {
      mode: 'recovery';
      activeRoot?: string;
      configuredRoot: string;
      defaultRoot: string;
      previousRoot?: string;
      reason: 'configured_root_unavailable' | 'configured_root_invalid' | 'migration_failed';
      error?: DesktopDataMigrationError;
    };

export type DesktopDataRootActionResult =
  | { ok: true }
  | { ok: false; error: DesktopDataMigrationError };

/**
 * Runtime admission barrier used immediately before Electron schedules a restart migration.
 * `registeredTasks` includes cancelled turns whose terminal writes have not settled yet.
 */
export type RuntimeDataMigrationReadiness = {
  ready: boolean;
  registeredTasks: number;
  pendingMutations: number;
};
