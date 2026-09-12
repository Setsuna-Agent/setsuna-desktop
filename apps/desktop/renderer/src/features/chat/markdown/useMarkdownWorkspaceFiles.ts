import type { WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceEntriesWatcher } from '../../workspace/hooks/useWorkspaceEntriesSync.js';

export type SearchMarkdownWorkspaceEntries = (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
type DirectoryFiles = {
  files: Map<string, string>;
  listeners: Set<() => void>;
  loading: boolean;
  pending: boolean;
  stopWatching?: () => void;
};

/** Share one listing and watcher per referenced directory, never scan the whole repository. */
function createWorkspaceFiles(root: string, search: SearchMarkdownWorkspaceEntries, watch: WorkspaceEntriesWatcher) {
  const directories = new Map<string, DirectoryFiles>();
  const pathKey = (value: string) => {
    const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
    return /^[a-z]:[\\/]/iu.test(root) ? normalized.toLowerCase() : normalized;
  };
  const parentOf = (filePath: string) => filePath.slice(0, Math.max(0, filePath.lastIndexOf('/')));
  const refreshDirectory = async (parent: string, directory: DirectoryFiles) => {
    directory.pending = true;
    if (directory.loading) return;
    directory.loading = true;
    try {
      do {
        directory.pending = false;
        let files = new Map<string, string>();
        try {
          const result = await search('', parent);
          if (pathKey(result.workspaceRoot) === pathKey(root)) {
            files = new Map(result.entries.filter((entry) => entry.kind === 'file'
              && pathKey(parentOf(entry.path)) === pathKey(parent))
              .map((entry) => [pathKey(entry.path), entry.path]));
          }
        } catch { /* Unreadable or missing directories do not produce clickable file labels. */ }
        if (directories.get(parent) !== directory) return;
        directory.files = files;
        for (const listener of directory.listeners) listener();
      } while (directory.pending);
    } finally {
      directory.loading = false;
    }
  };
  return {
    get(filePath: string): string | null {
      return directories.get(parentOf(filePath))?.files.get(pathKey(filePath)) ?? null;
    },
    subscribe(filePath: string, listener: () => void) {
      const parent = parentOf(filePath);
      let directory = directories.get(parent);
      if (!directory) {
        directory = { files: new Map(), listeners: new Set(), loading: false, pending: false };
        directories.set(parent, directory);
        const current = directory;
        // Watch ancestors too, so creating/removing a missing parent revalidates its references.
        const parts = parent.split('/').filter(Boolean);
        directory.stopWatching = watch(['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))],
          () => { void refreshDirectory(parent, current); });
        void refreshDirectory(parent, directory);
      }
      directory.listeners.add(listener);
      const current = directory;
      return () => {
        current.listeners.delete(listener);
        if (!current.listeners.size && directories.get(parent) === current) {
          directories.delete(parent);
          current.stopWatching?.();
        }
      };
    },
    refresh() {
      for (const [parent, directory] of directories) void refreshDirectory(parent, directory);
    },
    dispose() {
      for (const directory of directories.values()) directory.stopWatching?.();
      directories.clear();
    },
  };
}

export type MarkdownWorkspaceFiles = ReturnType<typeof createWorkspaceFiles>;

export function useAvailableMarkdownFile(filePath: string | null, files: MarkdownWorkspaceFiles | undefined) {
  const subscribe = useCallback((listener: () => void) => filePath && files
    ? files.subscribe(filePath, listener) : () => undefined, [filePath, files]);
  const getSnapshot = useCallback(() => filePath ? files?.get(filePath) ?? null : null, [filePath, files]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useMarkdownWorkspaceFiles(root: string | undefined, search: SearchMarkdownWorkspaceEntries | undefined) {
  const files = useMemo(() => root && search ? createWorkspaceFiles(root, search, (paths, changed) => (
    window.setsunaDesktop?.desktop?.watchWorkspaceEntries?.(root, paths, changed) ?? (() => undefined)
  )) : undefined, [root, search]);
  useEffect(() => {
    if (!files) return;
    window.addEventListener('focus', files.refresh);
    return () => {
      window.removeEventListener('focus', files.refresh);
      files.dispose();
    };
  }, [files]);
  return files;
}
