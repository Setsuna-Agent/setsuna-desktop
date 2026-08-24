import type { CollaborationRendererStateService } from '@setsuna-desktop/feature-collaboration/contracts';
import {
  AgentAvatar,
  CollaborationRendererProvider,
  CollaborationTaskList,
  CollaborationTaskNavigationProvider,
  SubagentTaskStatus,
  useCollaborationState,
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
}: Readonly<{
  children: ReactNode;
  onOpenTask: CollaborationTaskOpenHandler;
}>) {
  return (
    <CollaborationTaskNavigationProvider onOpenTask={onOpenTask}>
      {children}
    </CollaborationTaskNavigationProvider>
  );
}

export function useCollaborationFeatureState(threadId: string) {
  return useCollaborationState(threadId);
}

export function CollaborationFeatureTaskList(props: ComponentProps<typeof CollaborationTaskList>) {
  return <CollaborationTaskList {...props} />;
}

export function CollaborationFeatureAgentAvatar(props: ComponentProps<typeof AgentAvatar>) {
  return <AgentAvatar {...props} />;
}

export function CollaborationFeatureTaskStatus(props: ComponentProps<typeof SubagentTaskStatus>) {
  return <SubagentTaskStatus {...props} />;
}
