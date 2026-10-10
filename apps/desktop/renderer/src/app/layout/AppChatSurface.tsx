import { resolveWorkspaceFileReference, type WorkspaceEntrySearchItem } from '@setsuna-desktop/contracts';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ArtifactFeatureNavigationBoundary } from '../../composition/ArtifactFeatureBoundary.js';
import {
  ReviewFeatureConversationGitControls,
  ReviewFeatureGitCommitProvider,
} from '../../composition/review-feature-adapter.js';
import { useChatImageAttachmentRequest } from '../../features/chat/hooks/useChatImageAttachmentRequest.js';
import { chatThreadModelSelection } from '../../features/chat/chatModelSelection.js';
import { ChatStarterWorkspace } from '../../features/chat/conversation/ChatStarterWorkspace.js';
import {
  RuntimePluginNavigationProvider,
  type OpenRuntimePluginHandler,
} from '../../features/chat/plugin-usage/RuntimePluginNavigation.js';
import type { WorkspaceFileContextTarget } from '../../features/workspace/WorkspaceFileContextMenu.js';
import type { WorkspaceFileRevealRequest } from '../../features/workspace/hooks/useWorkspaceFileTree.js';
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
  const [fileRevealRequest, setFileRevealRequest] = useState<WorkspaceFileRevealRequest | null>(null);
  const activeWorkspace = workspace.context.activeWorkspace;
  const showInFiles = useCallback(async (filePath: string) => {
    if (!activeWorkspace) return;
    const reference = resolveWorkspaceFileReference(activeWorkspace, filePath);
    if (!reference || !await workspace.actions.onOpenProjectFile(`${reference.root.path}/${reference.path}`)) return;
    setFileRevealRequest((current) => ({
      workspaceKey: JSON.stringify([activeWorkspace.id, reference.root.path]),
      path: reference.path,
      version: (current?.version ?? 0) + 1,
    }));
  }, [activeWorkspace, workspace.actions.onOpenProjectFile]);
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
      threadId={conversation.currentThread?.id}
      activeProject={workspace.context.activeWorkspace}
      conversationModelSelection={chatThreadModelSelection(conversation.config, conversation.currentThread).reference ?? undefined}
      reviewLoading={workspace.context.reviewLoading}
      reviewState={workspace.context.reviewState}
      onReviewRefresh={workspace.actions.onReviewRefresh}
      onOpenMessageEditor={workspace.actions.onOpenCommitMessageEditor}
    >
      <ChatNavigationBoundaries
        onOpenBrowser={conversation.onOpenBrowser}
        projectId={activeWorkspace?.id}
        onShowInFiles={showInFiles}
        onOpenPlugin={onOpenPlugin}
      >
        <ChatConversationSurface
          imageAttachmentRequest={imageAttachmentRequest}
          model={conversation}
          starterControls={(
            <ChatStarterWorkspace
              activeProject={conversation.activeWorkspace}
              locationSelection={conversation.starterLocationSelection}
              {...conversation.starterProjectSelection}
            >
              <ReviewFeatureConversationGitControls
                key={conversation.activeWorkspace?.id ?? 'global'}
                variant="compact"
                activeProject={conversation.activeWorkspace}
                reviewError={workspace.context.reviewError}
                reviewLoading={workspace.context.reviewLoading}
                reviewState={workspace.context.reviewState}
                onReviewRefresh={workspace.actions.onReviewRefresh}
              />
            </ChatStarterWorkspace>
          )}
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
          fileRevealRequest={fileRevealRequest}
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
  projectId,
  onShowInFiles,
}: Readonly<{
  children: ReactNode;
  onOpenBrowser(url?: string): void;
  onOpenPlugin: OpenRuntimePluginHandler;
  projectId?: string;
  onShowInFiles(filePath: string): Promise<void>;
}>) {
  return (
    <ArtifactFeatureNavigationBoundary onOpenBrowser={onOpenBrowser} projectId={projectId} onShowInFiles={onShowInFiles}>
      <RuntimePluginNavigationProvider onOpenPlugin={onOpenPlugin}>
        {children}
      </RuntimePluginNavigationProvider>
    </ArtifactFeatureNavigationBoundary>
  );
}
