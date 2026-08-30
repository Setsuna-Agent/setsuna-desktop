import type {
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import type { ReactNode } from 'react';
import { ChatWorkspace } from '../../features/chat/ChatWorkspace.js';
import type { ChatModelSelectionHandler } from '../../features/chat/chatModelSelection.js';
import type { ChatQueuedTurnActions } from '../../features/chat/hooks/useQueuedTurnInputActions.js';
import { MarkdownNavigationProvider } from '../../features/chat/markdown/MarkdownNavigationProvider.js';
import type { WorkspaceFileContextTarget } from '../../features/workspace/WorkspaceFileContextMenu.js';
import type {
  DesktopReviewOpenHandler,
  DesktopReviewState,
} from '../../features/workspace/model.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import type {
  ChatImageAttachmentOutcome,
  ChatImageAttachmentRequest,
  ChatSkillSelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../types.js';

export type ChatConversationSurfaceModel = Readonly<{
  activeTurnId: string | null;
  activeWorkspace?: WorkspaceProject;
  canClearContext: boolean;
  composerKey: string;
  config: RuntimeConfigState | null;
  conversationOverviewShowRequest: number;
  conversationOverviewVisibility: ConversationOverviewVisibility;
  contextCompacting: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  focusComposerRequest: number;
  plugins: RuntimePluginSummary[];
  queuedTurnActions: ChatQueuedTurnActions;
  reviewError: string | null;
  reviewState: DesktopReviewState | null;
  runtimeClient: DesktopRuntimeClient;
  skillSelectionRequest: ChatSkillSelectionRequest | null;
  skills: RuntimeSkillSummary[];
  onAccessModeChange(selection: RuntimeAccessModeSelection): void;
  onAnswerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): void | Promise<void>;
  onCancelActiveTurn(): void;
  onCompactContext(): void;
  onClearContext(): void;
  onConversationOverviewRenderedChange(visible: boolean): void;
  onDeleteMessages(messageIds: string[]): void | Promise<void>;
  onDiscardFileChanges?(filePaths: string[]): void | Promise<void>;
  onDraftChange(value: string): void;
  onEditUserMessage(messageId: string, content: string): void | Promise<void>;
  onFocusComposerRequestConsumed(requestId: number): void;
  onOpenBrowser(url?: string): void;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenMarkdownWebLink(url: string): void;
  onOpenModelSettings(): void;
  onOpenProjectFile(filePath: string, line?: number): void;
  onOpenSideChat(): void;
  onOpenWorkspaceDirectory(directoryPath: string): void;
  onSearchProjectEntries(query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
  onSelectModel: ChatModelSelectionHandler;
  onSend(value?: string, options?: {
    attachments?: RuntimeThread['messages'][number]['attachments'];
    goalMode?: boolean;
    skillIds?: string[];
    skillReferences?: RuntimeThread['messages'][number]['skillReferences'];
    thinking?: boolean;
    thinkingEffort?: string;
  }): Promise<boolean>;
  onSetMultiAgentEnabled(enabled: boolean): void | Promise<unknown>;
  onSkillSelectionRequestConsumed(requestId: number): void;
  onStartThreadReview(
    target: ReviewTarget,
    modelSelection?: RuntimeConfiguredModelReference,
  ): Promise<unknown>;
}>;

export function ChatConversationSurface({
  imageAttachmentRequest,
  model,
  onImageAttachmentRequestConsumed,
  onOpenWorkspaceFileContextMenu,
  onWorkspaceMentionRequestConsumed,
  workspaceMentionRequest,
  reviewControls,
}: Readonly<{
  imageAttachmentRequest: ChatImageAttachmentRequest | null;
  model: ChatConversationSurfaceModel;
  onImageAttachmentRequestConsumed(requestId: number, outcome: ChatImageAttachmentOutcome): void;
  onOpenWorkspaceFileContextMenu(target: WorkspaceFileContextTarget): void;
  onWorkspaceMentionRequestConsumed(requestId: number): void;
  reviewControls?: ReactNode;
  workspaceMentionRequest: ChatWorkspaceMentionRequest | null;
}>) {
  return (
    <MarkdownNavigationProvider
      onOpenInAppBrowser={model.onOpenBrowser}
      onOpenWebLink={model.onOpenMarkdownWebLink}
      workspaceRoot={model.activeWorkspace?.path}
      onOpenWorkspaceDirectory={model.onOpenWorkspaceDirectory}
      onOpenWorkspaceFile={model.onOpenProjectFile}
      onOpenWorkspaceFileContextMenu={onOpenWorkspaceFileContextMenu}
    >
      <ChatWorkspace
        activeProject={model.activeWorkspace}
        activeTurnId={model.activeTurnId}
        canClearContext={model.canClearContext}
        client={model.runtimeClient}
        composerKey={model.composerKey}
        config={model.config}
        contextCompacting={model.contextCompacting}
        conversationOverviewShowRequest={model.conversationOverviewShowRequest}
        conversationOverviewVisibility={model.conversationOverviewVisibility}
        currentThread={model.currentThread}
        draft={model.draft}
        focusComposerOnReveal
        focusComposerRequest={model.focusComposerRequest}
        imageAttachmentRequest={imageAttachmentRequest}
        plugins={model.plugins}
        queuedTurnActions={model.queuedTurnActions}
        reviewControls={reviewControls}
        reviewError={model.reviewError}
        reviewState={model.reviewState}
        skillSelectionRequest={model.skillSelectionRequest}
        skills={model.skills}
        workspaceMentionRequest={workspaceMentionRequest}
        onAccessModeChange={model.onAccessModeChange}
        onAnswerApproval={model.onAnswerApproval}
        onCancelActiveTurn={model.onCancelActiveTurn}
        onClearContext={model.onClearContext}
        onCompactContext={model.onCompactContext}
        onConversationOverviewRenderedChange={model.onConversationOverviewRenderedChange}
        onDeleteMessages={model.onDeleteMessages}
        onDiscardFileChanges={model.onDiscardFileChanges}
        onDraftChange={model.onDraftChange}
        onEditUserMessage={model.onEditUserMessage}
        onFocusComposerRequestConsumed={model.onFocusComposerRequestConsumed}
        onImageAttachmentRequestConsumed={onImageAttachmentRequestConsumed}
        onOpenFileReview={model.onOpenFileReview}
        onOpenModelSettings={model.onOpenModelSettings}
        onOpenSideChat={model.onOpenSideChat}
        onSearchProjectEntries={model.onSearchProjectEntries}
        onSelectModel={model.onSelectModel}
        onSend={model.onSend}
        onSetMultiAgentEnabled={model.onSetMultiAgentEnabled}
        onSkillSelectionRequestConsumed={model.onSkillSelectionRequestConsumed}
        onStartThreadReview={model.onStartThreadReview}
        onWorkspaceMentionRequestConsumed={onWorkspaceMentionRequestConsumed}
      />
    </MarkdownNavigationProvider>
  );
}
