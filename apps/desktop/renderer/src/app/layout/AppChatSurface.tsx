import type { WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ArtifactFeatureNavigationBoundary } from '../../composition/ArtifactFeatureBoundary.js';
import {
  ReviewFeatureConversationGitControls,
  ReviewFeatureGitCommitProvider,
} from '../../composition/review-feature-adapter.js';
import { useChatImageAttachmentRequest } from '../../features/chat/hooks/useChatImageAttachmentRequest.js';
import {
  RuntimePluginNavigationProvider,
  type OpenRuntimePluginHandler,
} from '../../features/chat/plugin-usage/RuntimePluginNavigation.js';
import type { WorkspaceFileContextTarget } from '../../features/workspace/WorkspaceFileContextMenu.js';
import type { ChatWorkspaceMentionRequest } from '../types.js';
import {
  ChatConversationSurface,
  type ChatConversationSurfaceModel,
} from './ChatConversationSurface.js';
import {
  DesktopWorkspacePanelLayer,
  type DesktopWorkspacePanelModel,
} from './DesktopWorkspacePanelLayer.js';

export function AppChatSurface({
  conversation,
  onOpenPlugin,
  workspace,
}: Readonly<{
  conversation: ChatConversationSurfaceModel;
  onOpenPlugin: OpenRuntimePluginHandler;
  workspace: DesktopWorkspacePanelModel;
}>) {
  const {
    imageAttachmentRequest,
    requestImageAttachment,
    resolveImageAttachmentRequest,
  } = useChatImageAttachmentRequest(conversation.composerKey);
  const [scopedWorkspaceMentionRequest, setScopedWorkspaceMentionRequest] = useState<{
    composerKey: string;
    request: ChatWorkspaceMentionRequest;
  } | null>(null);
  const [workspaceFileContextTarget, setWorkspaceFileContextTarget] = useState<WorkspaceFileContextTarget | null>(null);
  const workspaceMentionRequestIdRef = useRef(0);
  const workspaceMentionRequest = scopedWorkspaceMentionRequest?.composerKey === conversation.composerKey
    ? scopedWorkspaceMentionRequest.request
    : null;
  const requestWorkspaceMention = useCallback((entry: WorkspaceEntrySearchItem) => {
    workspaceMentionRequestIdRef.current += 1;
    setScopedWorkspaceMentionRequest({
      composerKey: conversation.composerKey,
      request: { entry, requestId: workspaceMentionRequestIdRef.current },
    });
  }, [conversation.composerKey]);
  const consumeWorkspaceMentionRequest = useCallback((requestId: number) => {
    setScopedWorkspaceMentionRequest((current) => (
      current?.request.requestId === requestId ? null : current
    ));
  }, []);

  return (
    <ReviewFeatureGitCommitProvider
      activeProject={workspace.context.activeWorkspace}
      reviewLoading={workspace.context.reviewLoading}
      reviewState={workspace.context.reviewState}
      onReviewRefresh={workspace.actions.onReviewRefresh}
    >
      <ChatNavigationBoundaries
        onOpenBrowser={conversation.onOpenBrowser}
        onOpenPlugin={onOpenPlugin}
      >
        <ChatConversationSurface
          imageAttachmentRequest={imageAttachmentRequest}
          model={conversation}
          reviewControls={(
            <ReviewFeatureConversationGitControls
              activeProject={workspace.context.activeWorkspace}
              reviewError={workspace.context.reviewError}
              reviewLoading={workspace.context.reviewLoading}
              reviewState={workspace.context.reviewState}
              onReviewRefresh={workspace.actions.onReviewRefresh}
            />
          )}
          workspaceMentionRequest={workspaceMentionRequest}
          onImageAttachmentRequestConsumed={resolveImageAttachmentRequest}
          onOpenWorkspaceFileContextMenu={setWorkspaceFileContextTarget}
          onWorkspaceMentionRequestConsumed={consumeWorkspaceMentionRequest}
        />
        <DesktopWorkspacePanelLayer
          model={workspace}
          requestImageAttachment={requestImageAttachment}
          workspaceFileContextTarget={workspaceFileContextTarget}
          onAddWorkspaceMention={requestWorkspaceMention}
          onCloseFileContextMenu={() => setWorkspaceFileContextTarget(null)}
        />
      </ChatNavigationBoundaries>
    </ReviewFeatureGitCommitProvider>
  );
}

function ChatNavigationBoundaries({
  children,
  onOpenBrowser,
  onOpenPlugin,
}: Readonly<{
  children: ReactNode;
  onOpenBrowser(url?: string): void;
  onOpenPlugin: OpenRuntimePluginHandler;
}>) {
  return (
    <ArtifactFeatureNavigationBoundary onOpenBrowser={onOpenBrowser}>
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        {children}
      </RuntimePluginNavigationProvider>
    </ArtifactFeatureNavigationBoundary>
  );
}
