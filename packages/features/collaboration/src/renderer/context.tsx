import {
  createNoopCollaborationRendererStateService,
  type CollaborationRendererStateController,
  type CollaborationRendererStateService,
  type CollaborationRendererStateSnapshot,
  type CollaborationTask,
} from '../contracts/index.js';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const EMPTY_SERVICE = createNoopCollaborationRendererStateService();
const CollaborationStateContext = createContext<CollaborationRendererStateService>(EMPTY_SERVICE);

export function CollaborationRendererProvider({
  children,
  service,
}: Readonly<{ children: ReactNode; service: CollaborationRendererStateService }>) {
  return (
    <CollaborationStateContext.Provider value={service}>
      {children}
    </CollaborationStateContext.Provider>
  );
}

export function useCollaborationState(threadId: string | null | undefined): CollaborationRendererStateSnapshot {
  const service = useContext(CollaborationStateContext);
  const controller = useMemo<CollaborationRendererStateController>(
    () => threadId ? service.controller(threadId) : EMPTY_SERVICE.controller(''),
    [service, threadId],
  );
  useEffect(() => controller.start(), [controller]);
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.snapshot(),
    () => controller.snapshot(),
  );
}

export type CollaborationTaskOpenHandler = (
  parentThreadId: string,
  task: CollaborationTask,
) => void;

const CollaborationNavigationContext = createContext<CollaborationTaskOpenHandler | null>(null);

export function CollaborationTaskNavigationProvider({
  children,
  onOpenTask,
}: Readonly<{ children: ReactNode; onOpenTask: CollaborationTaskOpenHandler }>) {
  return (
    <CollaborationNavigationContext.Provider value={onOpenTask}>
      {children}
    </CollaborationNavigationContext.Provider>
  );
}

export function useCollaborationTaskNavigation(): CollaborationTaskOpenHandler | null {
  return useContext(CollaborationNavigationContext);
}
