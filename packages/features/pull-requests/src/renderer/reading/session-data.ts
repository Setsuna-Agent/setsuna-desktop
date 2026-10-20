import { useCallback, useSyncExternalStore, type SetStateAction } from 'react';
import type {
  PullRequestActivityEvent, PullRequestCheck, PullRequestDetail, PullRequestDiscussion,
  PullRequestDiscussionInput, PullRequestFile, PullRequestPatch, PullRequestRepositories, PullRequestSummary,
} from '../../contracts/index.js';

type Snapshot<T> = { key: string; value: T };
export type SessionData<T> = ReturnType<typeof createSessionData<T>>;

/** Keep the last query's data beyond panel unmounts; loading and requests stay with the reader. */
function createSessionData<T>() {
  let snapshot: Snapshot<T> | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set: (next: Snapshot<T>) => {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

export function useSessionData<T>(data: SessionData<T>, key: string, empty: T) {
  const snapshot = useSyncExternalStore(data.subscribe, data.getSnapshot);
  const setValue = useCallback((update: SetStateAction<T>) => {
    const current = data.getSnapshot();
    const value = current?.key === key ? current.value : empty;
    data.set({ key, value: typeof update === 'function' ? (update as (value: T) => T)(value) : update });
  }, [data, key, empty]);
  return [snapshot?.key === key ? snapshot.value : empty, setValue, snapshot?.key === key] as const;
}

export type RepositoryPages = Record<string, { items: PullRequestSummary[]; cursor: string | null; depth: number; error: string }>;
export type DiscussionFeeds = Partial<Record<PullRequestDiscussionInput['kind'], {
  items: PullRequestDiscussion[]; cursor: string | null; depth: number; error: string;
}>>;
export type ActivitySnapshot = { items: PullRequestActivityEvent[]; cursor: string | null; depth: number };
export type FilesSnapshot = { files: PullRequestFile[]; nextPage: number | null };

export function createPullRequestListData() {
  return { inventory: createSessionData<PullRequestRepositories>(), pages: createSessionData<RepositoryPages>() };
}
export type PullRequestListData = ReturnType<typeof createPullRequestListData>;

export function createPullRequestDetailData() {
  return {
    detail: createSessionData<PullRequestDetail | null>(),
    discussions: createSessionData<DiscussionFeeds>(),
    activity: createSessionData<ActivitySnapshot>(),
    checks: createSessionData<PullRequestCheck[]>(),
    files: createSessionData<FilesSnapshot>(),
    // Retain the current patch, not every file body or every historical commit.
    patch: createSessionData<PullRequestPatch | null>(),
  };
}
export type PullRequestDetailData = ReturnType<typeof createPullRequestDetailData>;
