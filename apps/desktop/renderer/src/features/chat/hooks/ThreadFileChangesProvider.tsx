import type { WorkspaceFileChangeAction } from '@setsuna-desktop/contracts';
import { createContext, useCallback, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

type ChangeState = { undone: boolean; pendingAction: WorkspaceFileChangeAction | null };
type ApplyChanges = (action: WorkspaceFileChangeAction) => void | Promise<void>;
const initialState: ChangeState = { undone: false, pendingAction: null };
const noSubscription = () => () => undefined;

function createChangeStore() {
  const states = new Map<string, ChangeState>();
  const listeners = new Set<() => void>();
  const get = (key: string) => states.get(key) ?? initialState;
  const set = (key: string, state: ChangeState) => {
    if (!state.undone && !state.pendingAction) states.delete(key);
    else states.set(key, state);
    for (const listener of listeners) listener();
  };
  return {
    get,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async apply(key: string, applyChanges: ApplyChanges) {
      const current = get(key);
      if (current.pendingAction) return;
      const action = current.undone ? 'redo' : 'undo';
      set(key, { ...current, pendingAction: action });
      try {
        await applyChanges(action);
        set(key, { undone: action === 'undo', pendingAction: null });
      } catch (error) {
        set(key, current);
        throw error;
      }
    },
  };
}

const ThreadFileChangesContext = createContext<ReturnType<typeof createChangeStore> | null>(null);

/** App-scoped state survives transcript remounts, including requests completed after navigation. */
export function ThreadFileChangesProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createChangeStore);
  return <ThreadFileChangesContext.Provider value={store}>{children}</ThreadFileChangesContext.Provider>;
}

export function useThreadFileChanges(threadId: string | null, toolCallIds: readonly string[]) {
  const store = useContext(ThreadFileChangesContext);
  const key = threadId && toolCallIds.length ? JSON.stringify([threadId, [...new Set(toolCallIds)].sort()]) : null;
  const getSnapshot = useCallback(() => store && key ? store.get(key) : initialState, [store, key]);
  const state = useSyncExternalStore(store?.subscribe ?? noSubscription, getSnapshot, getSnapshot);
  const apply = useCallback(async (applyChanges: ApplyChanges) => {
    if (store && key) await store.apply(key, applyChanges);
  }, [store, key]);
  return { ...state, available: Boolean(store && key), apply };
}
