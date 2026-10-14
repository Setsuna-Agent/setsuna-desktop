import { DESKTOP_DATA_MIGRATION_CATEGORY_IDS } from '../data-root.js';

export const DESKTOP_STORAGE_CATEGORY_IDS = [
  ...DESKTOP_DATA_MIGRATION_CATEGORY_IDS,
  'cache',
  'logs',
] as const;

export type DesktopStorageCategory = (typeof DESKTOP_STORAGE_CATEGORY_IDS)[number];
export type DesktopStorageCleanupCategory = 'cache' | 'logs';

export type DesktopStorageUsage = {
  totalBytes: number;
  categories: Array<{ id: DesktopStorageCategory; totalBytes: number }>;
  /** Unreadable entries are excluded; a partial scan must not look like a complete total. */
  incomplete: boolean;
};

export type DesktopStorageCleanupResult = {
  failedCategories: DesktopStorageCleanupCategory[];
};
