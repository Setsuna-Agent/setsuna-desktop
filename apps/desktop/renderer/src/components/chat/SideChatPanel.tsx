import type { Dispatch, PointerEvent as ReactPointerEvent, SetStateAction } from 'react';
import type {
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimeSkillSummary,
  RuntimeThreadSummary,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChatWorkspace } from './ChatWorkspace.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { useSideChat } from '../../hooks/useSideChat.js';

export function SideChatPanel({
  activeProjectId,
  activeWorkspace,
  client,
  config,
  hidden,
  skills,
  threads,
  onApprovalPolicyChange,
  onError,
  onOpenMarkdownWebLink,
  onOpenProjectFile,
  onOpenSideChat,
  onReloadThreads,
  onSearchProjectEntries,
  onSelectModel,
  onSetMultiAgentEnabled,
  onWorkspaceResizeStep,
  onWorkspaceResizeStart,
  workspaceMaxWidth,
  workspaceMinWidth,
  workspaceWidth,
}: {
  activeProjectId: string | null;
  activeWorkspace?: WorkspaceProject;
  client: DesktopRuntimeClient;
  config: RuntimeConfigState | null;
  hidden: boolean;
  skills: RuntimeSkillSummary[];
  threads: RuntimeThreadSummary[];
  onApprovalPolicyChange: (policy: RuntimeConfigState['approvalPolicy']) => void;
  onError: Dispatch<SetStateAction<string | null>>;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenProjectFile: (filePath: string) => void;
  onOpenSideChat: () => void;
  onReloadThreads: () => Promise<unknown>;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onSelectModel: (providerId: string, modelId: string) => void;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onWorkspaceResizeStep: (delta: number) => void;
  onWorkspaceResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}) {
  const sideChat = useSideChat({
    activeProjectId,
    client,
    reloadThreads: onReloadThreads,
    setError: onError,
  });

  return (
    <aside className="desktop-workspace-panel desktop-side-chat-panel" aria-label="侧边任务" hidden={hidden}>
      <WorkspaceResizeHandle
        max={workspaceMaxWidth}
        min={workspaceMinWidth}
        value={workspaceWidth}
        onResizeStart={onWorkspaceResizeStart}
        onResizeStep={onWorkspaceResizeStep}
      />
      <MarkdownNavigationProvider
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={activeWorkspace?.path}
        onOpenWorkspaceFile={onOpenProjectFile}
      >
        <ChatWorkspace
          activeProject={activeWorkspace}
          activeTurnId={sideChat.activeTurnId}
          canClearContext={Boolean(sideChat.currentThread?.messages.length)}
          config={config}
          contextCompacting={sideChat.contextCompacting}
          currentThread={sideChat.currentThread}
          draft={sideChat.draft}
          skillSelectionRequest={null}
          skills={skills}
          threadUsage={sideChat.threadUsage}
          threads={threads}
          variant="side"
          onAnswerApproval={sideChat.answerApproval}
          onApprovalPolicyChange={onApprovalPolicyChange}
          onCancelActiveTurn={() => void sideChat.actions.cancelActiveTurn()}
          onClearContext={() => void sideChat.clearContext()}
          onClearThreadGoal={sideChat.clearGoal}
          onCompactContext={() => void sideChat.compactContext()}
          onDeleteMessages={sideChat.actions.deleteMessages}
          onDraftChange={sideChat.setDraft}
          onEditUserMessage={sideChat.actions.editUserMessage}
          onOpenSideChat={onOpenSideChat}
          onOpenThread={() => undefined}
          onPlanDecision={(decision) => void sideChat.actions.sendInput('', { planDecision: decision })}
          onSearchProjectEntries={onSearchProjectEntries}
          onSelectModel={onSelectModel}
          onSend={(value, options) => void sideChat.actions.sendInput(value, options)}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onStartThreadReview={() => sideChat.startReview({ type: 'uncommittedChanges' })}
          onSkillSelectionRequestConsumed={() => undefined}
          onThreadMemoryModeChange={(mode) => void sideChat.updateMemoryMode(mode)}
        />
      </MarkdownNavigationProvider>
    </aside>
  );
}
