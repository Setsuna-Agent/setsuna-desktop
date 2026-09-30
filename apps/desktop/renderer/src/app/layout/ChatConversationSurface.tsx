import type {
  WorkspaceFileChangeAction,
  ThreadFileChangesResult,
  AnswerRuntimeApprovalInput,
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeSkillReference,
  RuntimeThread,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import type { ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import type { ReactNode } from 'react';
import type { ChatAttachmentStore } from '../../features/chat/composer/chatAttachmentStore.js';
import type { ChatComposerSendOptions } from '../../features/chat/composer/chatComposerSendOptions.js';
import { ChatWorkspace } from '../../features/chat/ChatWorkspace.js';
import type { ChatStarterLocationSelection, ChatStarterProjectSelection } from '../../features/chat/conversation/ChatStarterWorkspace.js';
import type { ChatModelSelectionHandler } from '../../features/chat/chatModelSelection.js';
import type { ChatStarterPresentation } from '../../features/chat/conversation/chat-workspace-types.js';
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
  ChatCapabilitySelectionRequest,
  ChatWorkspaceMentionRequest,
  ConversationOverviewVisibility,
} from '../types.js';

export type ChatConversationSurfaceModel = Readonly<{
  starterPresentation?: ChatStarterPresentation;
  starterProjectSelection: ChatStarterProjectSelection;
  starterLocationSelection: ChatStarterLocationSelection;
  activeTurnId: string | null;
  activeWorkspace?: WorkspaceProject;
  canClearContext: boolean;
  composerKey: string;
  attachmentStore?: ChatAttachmentStore;
  config: RuntimeConfigState | null;
  conversationOverviewVisibility: ConversationOverviewVisibility;
  contextCompacting: boolean;
  currentThread: RuntimeThread | null;
  draft: string;
  draftSkillReferences?: RuntimeSkillReference[];
  focusComposerRequest: number;
  findInChatRequest?: number;
  onFindInChatRequestConsumed?(requestId: number): void;
  plugins: RuntimePluginSummary[];
  queuedTurnActions: ChatQueuedTurnActions;
  reviewError: string | null;
  reviewState: DesktopReviewState | null;
  runtimeClient: DesktopRuntimeClient;
  capabilitySelectionRequest: ChatCapabilitySelectionRequest | null;
  skills: RuntimeSkillSummary[];
  onAccessModeChange(selection: RuntimeAccessModeSelection): void;
  onAnswerApproval(approvalId: string, input: AnswerRuntimeApprovalInput): void | Promise<void>;
  onCancelActiveTurn(): void;
  onCompactContext(): void;
  onClearContext(): void;
  onConversationOverviewRenderedChange(visible: boolean): void;
  onDeleteMessages(messageIds: string[]): void | Promise<void>;
  onFileChangesAction?(toolCallIds: string[], action: WorkspaceFileChangeAction): void | Promise<void | ThreadFileChangesResult>;
  onDraftChange(value: string, skillReferences?: RuntimeSkillReference[]): void;
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
  onSend(value?: string, options?: ChatComposerSendOptions): Promise<boolean>;
  onSetMultiAgentEnabled(enabled: boolean): void | Promise<unknown>;
  onCapabilitySelectionRequestConsumed(requestId: number): void;
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
  starterControls,
}: Readonly<{
  imageAttachmentRequest: ChatImageAttachmentRequest | null;
  model: ChatConversationSurfaceModel;
  onImageAttachmentRequestConsumed(requestId: number, outcome: ChatImageAttachmentOutcome): void;
  onOpenWorkspaceFileContextMenu(target: WorkspaceFileContextTarget): void;
  onWorkspaceMentionRequestConsumed(requestId: number): void;
  reviewControls?: ReactNode;
  starterControls?: ReactNode;
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
      onSearchWorkspaceEntries={model.onSearchProjectEntries}
    >
      <ChatWorkspace
        activeProject={model.activeWorkspace}
        activeTurnId={model.activeTurnId}
        canClearContext={model.canClearContext}
        client={model.runtimeClient}
        composerKey={model.composerKey}
        attachmentStore={model.attachmentStore}
        config={model.config}
        contextCompacting={model.contextCompacting}
        conversationOverviewVisibility={model.conversationOverviewVisibility}
        currentThread={model.currentThread}
        draft={model.draft}
        draftSkillReferences={model.draftSkillReferences}
        focusComposerOnReveal
        focusComposerRequest={model.focusComposerRequest}
        findInChatRequest={model.findInChatRequest}
        onFindInChatRequestConsumed={model.onFindInChatRequestConsumed}
        imageAttachmentRequest={imageAttachmentRequest}
        plugins={model.plugins}
        queuedTurnActions={model.queuedTurnActions}
        reviewControls={reviewControls}
        starterControls={starterControls}
        starterPresentation={model.starterPresentation}
        reviewError={model.reviewError}
        reviewState={model.reviewState}
        capabilitySelectionRequest={model.capabilitySelectionRequest}
        skills={model.skills}
        workspaceMentionRequest={workspaceMentionRequest}
        onAccessModeChange={model.onAccessModeChange}
        onAnswerApproval={model.onAnswerApproval}
        onCancelActiveTurn={model.onCancelActiveTurn}
        onClearContext={model.onClearContext}
        onCompactContext={model.onCompactContext}
        onConversationOverviewRenderedChange={model.onConversationOverviewRenderedChange}
        onDeleteMessages={model.onDeleteMessages}
        onFileChangesAction={model.onFileChangesAction}
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
        onCapabilitySelectionRequestConsumed={model.onCapabilitySelectionRequestConsumed}
        onStartThreadReview={model.onStartThreadReview}
        onWorkspaceMentionRequestConsumed={onWorkspaceMentionRequestConsumed}
      />
    </MarkdownNavigationProvider>
  );
}
