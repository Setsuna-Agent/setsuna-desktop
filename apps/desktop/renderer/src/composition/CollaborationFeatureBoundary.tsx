import type { CollaborationRendererStateService } from '@setsuna-desktop/feature-collaboration/contracts';
import {
  CollaborationRendererProvider,
  CollaborationTaskDirectory,
  CollaborationTaskControls,
  CollaborationAgentInfo,
  CollaborationTaskList,
  CollaborationTaskNavigationProvider,
  SubagentTaskStatus,
  useCollaborationState,
  useCollaborationTaskNavigation,
  type CollaborationTaskOpenHandler,
} from '@setsuna-desktop/feature-collaboration/renderer';
import type { ComponentProps, ReactNode } from 'react';

/** Keeps the cross-cutting Collaboration providers at the renderer composition boundary. */
export function CollaborationFeatureServiceBoundary({
  children,
  service,
}: Readonly<{
  children: ReactNode;
  service: CollaborationRendererStateService;
}>) {
  return (
    <CollaborationRendererProvider service={service}>
      {children}
    </CollaborationRendererProvider>
  );
}

export function CollaborationFeatureNavigationBoundary({
  children,
  onOpenTask,
  onOpenList,
}: Readonly<{
  children: ReactNode;
  onOpenTask: CollaborationTaskOpenHandler;
  onOpenList: (parentThreadId: string) => void;
}>) {
  return (
    <CollaborationTaskNavigationProvider onOpenTask={onOpenTask} onOpenList={onOpenList}>
      {children}
    </CollaborationTaskNavigationProvider>
  );
}

export function useCollaborationFeatureState(threadId: string) {
  return useCollaborationState(threadId);
}

export function useCollaborationFeatureNavigation() {
  return useCollaborationTaskNavigation();
}

export function CollaborationFeatureTaskDirectory(props: ComponentProps<typeof CollaborationTaskDirectory>) {
  return <CollaborationTaskDirectory {...props} />;
}

export function CollaborationFeatureTaskControls(props: ComponentProps<typeof CollaborationTaskControls>) {
  return <CollaborationTaskControls {...props} />;
}

export function CollaborationFeatureAgentInfo(props: ComponentProps<typeof CollaborationAgentInfo>) {
  return <CollaborationAgentInfo {...props} />;
}

export function CollaborationFeatureTaskList(props: ComponentProps<typeof CollaborationTaskList>) {
  return <CollaborationTaskList {...props} />;
}

export function CollaborationFeatureTaskStatus(props: ComponentProps<typeof SubagentTaskStatus>) {
  return <SubagentTaskStatus {...props} />;
}
