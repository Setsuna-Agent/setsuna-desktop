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

export function useCollaborationActions() {
  return useContext(CollaborationStateContext);
}

export type CollaborationTaskOpenHandler = (
  parentThreadId: string,
  task: CollaborationTask,
) => void;

type CollaborationNavigation = {
  openTask: CollaborationTaskOpenHandler;
  openList: (parentThreadId: string) => void;
};

const CollaborationNavigationContext = createContext<CollaborationNavigation | null>(null);

export function CollaborationTaskNavigationProvider({
  children,
  onOpenTask,
  onOpenList,
}: Readonly<{
  children: ReactNode;
  onOpenTask: CollaborationTaskOpenHandler;
  onOpenList: (parentThreadId: string) => void;
}>) {
  const navigation = useMemo(() => ({ openTask: onOpenTask, openList: onOpenList }), [onOpenTask, onOpenList]);
  return (
    <CollaborationNavigationContext.Provider value={navigation}>
      {children}
    </CollaborationNavigationContext.Provider>
  );
}

export function useCollaborationTaskNavigation(): CollaborationNavigation | null {
  return useContext(CollaborationNavigationContext);
}
