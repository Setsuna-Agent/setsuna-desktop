import { threadFileChangeKey, type ThreadFileChangesResult, type WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useChatThreadFileChangeStates } from '../conversation/ChatThreadProvider.js';

type ChangeState = { undone: boolean; pendingAction: WorkspaceFileChangeAction | null; seq: number };
type ApplyChanges = (action: WorkspaceFileChangeAction) => void | Promise<void | ThreadFileChangesResult>;
const initialState: ChangeState = { undone: false, pendingAction: null, seq: 0 };
const noSubscription = () => () => undefined;

function createChangeStore() {
  const states = new Map<string, ChangeState>();
  const listeners = new Set<() => void>();
  const get = (key: string) => states.get(key);
  const set = (key: string, state: ChangeState) => {
    states.set(key, state);
    for (const listener of listeners) listener();
  };
  return {
    get,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async apply(key: string, current: ChangeState, applyChanges: ApplyChanges) {
      if (get(key)?.pendingAction) return;
      const action = current.undone ? 'redo' : 'undo';
      set(key, { ...current, pendingAction: action });
      try {
        const result = await applyChanges(action);
        const applied = result?.state ?? { action, seq: current.seq + 1 };
        set(key, { undone: applied.action === 'undo', pendingAction: null, seq: applied.seq });
      } catch (error) {
        set(key, current);
        throw error;
      }
    },
  };
}

const ThreadFileChangesContext = createContext<ReturnType<typeof createChangeStore> | null>(null);

/** Share pending requests across remounts; durable direction comes from the thread projection. */
export function ThreadFileChangesProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createChangeStore);
  return <ThreadFileChangesContext.Provider value={store}>{children}</ThreadFileChangesContext.Provider>;
}

export function useThreadFileChanges(threadId: string | null, toolCallIds: readonly string[]) {
  const store = useContext(ThreadFileChangesContext);
  const persistedStates = useChatThreadFileChangeStates();
  const batchKey = threadFileChangeKey(toolCallIds);
  const key = threadId && toolCallIds.length ? JSON.stringify([threadId, batchKey]) : null;
  const persisted = persistedStates?.[batchKey];
  const restored = useMemo<ChangeState>(() => persisted
    ? { undone: persisted.action === 'undo', seq: persisted.seq, pendingAction: null } : initialState, [persisted]);
  const getSnapshot = useCallback(() => {
    const local = store && key ? store.get(key) : undefined;
    // A delayed SSE event must not replace a newer acknowledged operation, while
    // an operation from another view should supersede this view's older result.
    return local && (local.pendingAction || local.seq >= restored.seq) ? local : restored;
  }, [store, key, restored]);
  const state = useSyncExternalStore(store?.subscribe ?? noSubscription, getSnapshot, getSnapshot);
  const apply = useCallback(async (applyChanges: ApplyChanges) => {
    if (store && key) await store.apply(key, getSnapshot(), applyChanges);
  }, [store, key, getSnapshot]);
  return { ...state, available: Boolean(store && key), apply };
}
