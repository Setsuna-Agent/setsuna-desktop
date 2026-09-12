import type { WorkspaceEntry, WorkspaceEntrySearchResponse } from '@setsuna-desktop/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { useIdentityRequestGuard } from '../../../shared/hooks/useIdentityRequestGuard.js';
import {
  buildProjectEntryTree,
  clampFileTreeWidth,
  mergeProjectEntries,
  replaceDirectoryEntries,
  normalizeProjectTreePath,
  searchItemToWorkspaceEntry,
} from '../workspaceFileTree.js';
import { isWorkspaceEntryWithin, renamedWorkspaceEntryPath, workspaceEntryAncestors, workspaceEntryParent } from '../workspaceEntryPaths.js';
import { useWorkspaceEntriesSync, type WorkspaceEntriesWatcher } from './useWorkspaceEntriesSync.js';

function initialTreeState(workspaceKey: string | null) {
  return {
    workspaceKey,
    treeEntries: [] as WorkspaceEntry[],
    expandedPaths: new Set<string>(),
    loadedDirectoryPaths: new Set<string>(),
    loadingDirectoryPaths: new Set<string>(),
    treeError: null as string | null,
    treeQuery: '',
    loadedQuery: null as string | null,
    treeSearching: false,
    treeTruncated: false,
    treeVisible: true,
    treeWidth: 248,
  };
}

/** Owned above the per-tab renderer slots so every file detail shares one directory navigator. */
export function useWorkspaceFileTree({ workspaceKey, enabled, searchEntries, watchEntries, paused = false }: {
  workspaceKey: string | null;
  enabled: boolean;
  searchEntries(query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  watchEntries?: WorkspaceEntriesWatcher;
  paused?: boolean;
}) {
  const [state, setState] = useState(() => initialTreeState(workspaceKey));
  const scrollTop = useRef(0);
  // Reset before children commit; entries and pending reads belong to the workspace, not the tab.
  if (state.workspaceKey !== workspaceKey) {
    setState(initialTreeState(workspaceKey));
    scrollTop.current = 0;
  }
  const query = state.treeQuery.trim().toLowerCase();
  const requests = useIdentityRequestGuard(JSON.stringify([workspaceKey, query]));
  const directoryRequestScope = useRef<() => boolean>(() => false);
  const tree = useMemo(() => buildProjectEntryTree(state.treeEntries), [state.treeEntries]);

  useEffect(() => {
    if (!enabled || !workspaceKey || state.loadedQuery === query) return;
    const isCurrent = requests.begin();
    directoryRequestScope.current = isCurrent;
    setState((current) => ({ ...current, treeSearching: true, treeError: null, treeTruncated: false }));
    void searchEntries(query, query ? undefined : '').then((result) => {
      if (!isCurrent()) return;
      setState((current) => ({
        ...current,
        treeEntries: result.entries.map(searchItemToWorkspaceEntry),
        treeSearching: false,
        treeTruncated: result.truncated,
        loadedQuery: query,
        loadedDirectoryPaths: query ? new Set() : new Set(['']),
        loadingDirectoryPaths: new Set(),
      }));
    }).catch((error: unknown) => {
      if (!isCurrent()) return;
      setState((current) => ({
        ...current, treeEntries: [], treeSearching: false,
        treeError: error instanceof Error ? error.message : String(error),
      }));
    });
  }, [enabled, workspaceKey, query, state.loadedQuery, requests, searchEntries]);

  const loadDirectory = async (path: string, force = false) => {
    if (!workspaceKey || query || (!force && (state.loadedDirectoryPaths.has(path) || state.loadingDirectoryPaths.has(path)))) return;
    const isCurrent = directoryRequestScope.current;
    setState((current) => ({
      ...current, loadingDirectoryPaths: new Set(current.loadingDirectoryPaths).add(path), treeError: null,
    }));
    try {
      const incoming = await searchEntries('', path);
      if (!isCurrent()) return;
      setState((current) => {
        if (path && !current.treeEntries.some((entry) => entry.path === path && entry.type === 'directory')) return current;
        return {
          ...current,
          treeEntries: replaceDirectoryEntries(current.treeEntries, path, incoming.entries.map(searchItemToWorkspaceEntry)),
          treeTruncated: current.treeTruncated || incoming.truncated,
          loadedDirectoryPaths: new Set(current.loadedDirectoryPaths).add(path),
        };
      });
    } catch (error: unknown) {
      if (isCurrent()) setState((current) => ({
        ...current, treeError: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (isCurrent()) setState((current) => {
        const loadingDirectoryPaths = new Set(current.loadingDirectoryPaths);
        loadingDirectoryPaths.delete(path);
        return { ...current, loadingDirectoryPaths };
      });
    }
  };

  const toggleDirectory = (pathValue: string) => {
    const path = normalizeProjectTreePath(pathValue);
    const expanding = !state.expandedPaths.has(path);
    setState((current) => {
      const expandedPaths = new Set(current.expandedPaths);
      if (expandedPaths.has(path)) expandedPaths.delete(path);
      else expandedPaths.add(path);
      return { ...current, expandedPaths };
    });
    if (expanding) void loadDirectory(path);
  };

  const refreshFromDisk = async (isSyncCurrent: () => boolean) => {
    const isLatest = requests.begin();
    directoryRequestScope.current = isLatest;
    // Pausing for a local mutation also retires any background snapshot already in flight.
    const isCurrent = () => isLatest() && isSyncCurrent();
    if (query) {
      try {
        const result = await searchEntries(query);
        if (isCurrent()) setState((current) => ({
          ...current, treeEntries: result.entries.map(searchItemToWorkspaceEntry), treeTruncated: result.truncated,
        }));
      } catch { /* Background failures leave the last usable tree visible. */ }
      return;
    }
    const paths = [...new Set(['', ...state.loadedDirectoryPaths, ...state.loadingDirectoryPaths])]
      .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
    const results = await Promise.allSettled(paths.map((directoryPath) => searchEntries('', directoryPath)));
    if (!isCurrent()) return;
    setState((current) => {
      let treeEntries = current.treeEntries;
      const loaded = new Set(current.loadedDirectoryPaths);
      const loading = new Set(current.loadingDirectoryPaths);
      let truncated = false;
      paths.forEach((directoryPath, index) => {
        loading.delete(directoryPath);
        // Parent listings decide whether a deleted/renamed child's older response still belongs here.
        if (directoryPath && !treeEntries.some((entry) => entry.path === directoryPath && entry.type === 'directory')) return;
        const result = results[index];
        if (result.status !== 'fulfilled') return;
        treeEntries = replaceDirectoryEntries(treeEntries, directoryPath, result.value.entries.map(searchItemToWorkspaceEntry));
        loaded.add(directoryPath);
        truncated ||= result.value.truncated;
      });
      const directories = new Set(treeEntries.filter((entry) => entry.type === 'directory').map((entry) => entry.path));
      const keepDirectory = (directoryPath: string) => !directoryPath || directories.has(directoryPath);
      return {
        ...current, treeEntries, treeTruncated: truncated,
        expandedPaths: new Set([...current.expandedPaths].filter(keepDirectory)),
        loadedDirectoryPaths: new Set([...loaded].filter(keepDirectory)),
        loadingDirectoryPaths: new Set([...loading].filter(keepDirectory)),
      };
    });
  };
  useWorkspaceEntriesSync({
    enabled: enabled && Boolean(workspaceKey) && !paused && state.loadedQuery === query,
    identity: JSON.stringify([workspaceKey, query]),
    directoryPaths: query
      ? ['', ...state.treeEntries.flatMap((entry) => [
        ...workspaceEntryAncestors(entry.path), ...(entry.type === 'directory' ? [entry.path] : []),
      ])]
      : ['', ...state.loadedDirectoryPaths],
    watchEntries,
    refresh: refreshFromDisk,
  });

  // The file-list DOM can remount with its renderer slot; retain its workspace-owned scroll offset.
  const fileListRef = useCallback((element: HTMLDivElement | null) => {
    if (element) element.scrollTop = scrollTop.current;
  }, []);
  const onFileListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    scrollTop.current = event.currentTarget.scrollTop;
  }, []);

  const applyEntryChange = (entry: WorkspaceEntry, previousPath?: string) => {
    // Reads started before a rename must not put old paths back into the tree.
    directoryRequestScope.current = requests.begin();
    const remap = (value: string) => previousPath ? renamedWorkspaceEntryPath(value, previousPath, entry.path) : value;
    setState((current) => {
      if (current.workspaceKey !== workspaceKey) return current;
      const treeEntries = current.treeEntries.map((item) => {
        const nextPath = remap(item.path);
        if (nextPath === item.path) return item;
        return { ...item, path: nextPath, name: item.path === previousPath ? entry.name : item.name };
      });
      const expandedPaths = new Set([...current.expandedPaths].map(remap));
      workspaceEntryAncestors(entry.path).forEach((ancestor) => expandedPaths.add(ancestor));
      const loadedDirectoryPaths = new Set([...current.loadedDirectoryPaths].map(remap));
      if (!previousPath && entry.type === 'directory') loadedDirectoryPaths.add(entry.path);
      return {
        ...current, expandedPaths, loadedDirectoryPaths,
        treeEntries: mergeProjectEntries(treeEntries, [entry]),
        loadingDirectoryPaths: new Set(), treeError: null,
        loadedQuery: query ? null : current.loadedQuery,
      };
    });
    if (!query) {
      const refreshPaths = new Set([...state.loadingDirectoryPaths].map(remap));
      const parent = workspaceEntryParent(entry.path);
      if (!state.loadedDirectoryPaths.has(parent)) refreshPaths.add(parent);
      refreshPaths.forEach((path) => { void loadDirectory(path, true); });
    }
  };

  const applyEntryDeletion = (entryPath: string) => {
    directoryRequestScope.current = requests.begin();
    const keepPath = (path: string) => !isWorkspaceEntryWithin(path, entryPath);
    setState((current) => current.workspaceKey !== workspaceKey ? current : {
      ...current,
      treeEntries: current.treeEntries.filter((entry) => keepPath(entry.path)),
      expandedPaths: new Set([...current.expandedPaths].filter(keepPath)),
      loadedDirectoryPaths: new Set([...current.loadedDirectoryPaths].filter(keepPath)),
      loadingDirectoryPaths: new Set(), treeError: null,
      loadedQuery: query ? null : current.loadedQuery,
    });
    if (!query) [...state.loadingDirectoryPaths].filter(keepPath).forEach((path) => { void loadDirectory(path, true); });
  };

  return {
    ...state, tree, query, toggleDirectory, fileListRef, onFileListScroll, applyEntryChange, applyEntryDeletion,
    updateTreeQuery: (treeQuery: string) => {
      scrollTop.current = 0;
      setState((current) => ({
        ...current,
        treeQuery,
        // Clearing an in-flight search must start a fresh listing, even if the last result was the root.
        loadedQuery: current.treeQuery.trim().toLowerCase() === treeQuery.trim().toLowerCase()
          ? current.loadedQuery : null,
      }));
    },
    toggleTreeVisible: () => setState((current) => ({ ...current, treeVisible: !current.treeVisible })),
    setTreeWidth: (width: number) => setState((current) => ({ ...current, treeWidth: clampFileTreeWidth(width) })),
  };
}

export type WorkspaceFileTreeState = ReturnType<typeof useWorkspaceFileTree>;
