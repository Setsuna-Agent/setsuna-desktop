import type {
  DesktopStorageCleanupCategory,
  DesktopStorageCleanupResult,
  DesktopStorageUsage,
} from '@setsuna-desktop/contracts';
import { clearDesktopLogs, scanDesktopStorage } from './storage-files.js';

export type StorageCacheSession = Pick<Electron.Session, 'clearCache' | 'clearCodeCaches' | 'clearStorageData'>;

/** All I/O is requested by the storage panel; construction never scans or initializes a session. */
export class DesktopStorageService {
  private scan: Promise<DesktopStorageUsage> | null = null;
  private cleanup: Promise<DesktopStorageCleanupResult> | null = null;

  constructor(
    private readonly activeRoot: () => string,
    private readonly cacheSessions: () => StorageCacheSession[],
  ) {}

  getUsage(): Promise<DesktopStorageUsage> {
    if (this.scan) return this.scan;
    this.scan = (async () => {
      await this.cleanup;
      return scanDesktopStorage(this.activeRoot());
    })().finally(() => { this.scan = null; });
    return this.scan;
  }

  clear(categories: unknown): Promise<DesktopStorageCleanupResult> {
    if (!Array.isArray(categories) || categories.some((id) => id !== 'cache' && id !== 'logs')) {
      return Promise.reject(new Error('Invalid storage cleanup categories.'));
    }
    if (this.cleanup) return Promise.reject(new Error('Storage cleanup is already running.'));
    const selected = [...new Set(categories)] as DesktopStorageCleanupCategory[];
    this.cleanup = (async () => {
      await this.scan?.catch(() => undefined);
      const root = this.activeRoot();
      const failedCategories: DesktopStorageCleanupCategory[] = [];
      for (const category of selected) {
        try {
          if (category === 'logs') await clearDesktopLogs(root);
          else await this.clearCaches();
        } catch {
          failedCategories.push(category);
        }
      }
      return { failedCategories };
    })().finally(() => { this.cleanup = null; });
    return this.cleanup;
  }

  private async clearCaches(): Promise<void> {
    const results = await Promise.allSettled([...new Set(this.cacheSessions())].map(async (session) => {
      // Electron owns live profile files. Limit clearing to caches, preserving cookies, passwords,
      // local storage, IndexedDB, and unsent composer drafts.
      const cleared = await Promise.allSettled([
        session.clearCache(),
        session.clearCodeCaches({}),
        session.clearStorageData({ storages: ['shadercache'] }),
      ]);
      if (cleared.some((result) => result.status === 'rejected')) throw new Error('Cache cleanup failed.');
    }));
    if (results.some((result) => result.status === 'rejected')) throw new Error('Cache cleanup failed.');
  }
}
