import { useCallback, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import type {
  DesktopWorkspaceApp,
  DesktopRuntimeClient,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThreadSummary,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChatWorkspace } from './ChatWorkspace.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { useSideChat } from '../../hooks/useSideChat.js';
import { useThreadWorkspace } from '../../hooks/useThreadWorkspace.js';
import { openSideWorkspaceFileAtRoot } from './sideWorkspaceFileOpening.js';
import type { RuntimeAccessModeSelection } from '../../utils/runtimeAccessMode.js';

export function SideChatPanel({
  activeProjectId,
  activeWorkspace,
  client,
  config,
  hidden,
  plugins,
  selectedWorkspaceApp,
  skills,
  threads,
  onAccessModeChange,
  onError,
  onOpenInAppBrowser,
  onOpenMarkdownWebLink,
  onOpenWorkspaceFile,
  onOpenSideChat,
  onReloadThreads,
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
  plugins: RuntimePluginSummary[];
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  skills: RuntimeSkillSummary[];
  threads: RuntimeThreadSummary[];
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onError: Dispatch<SetStateAction<string | null>>;
  onOpenInAppBrowser: (url: string) => void;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  onOpenSideChat: () => void;
  onReloadThreads: () => Promise<unknown>;
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
  const sideWorkspaceState = useThreadWorkspace({
    client,
    projectWorkspace: activeProjectId ? activeWorkspace : undefined,
    setError: onError,
    thread: sideChat.currentThread,
  });
  const sideWorkspace = sideWorkspaceState.workspace;
  const searchSideWorkspaceEntries = useCallback(
    async (query = '', parent?: string | null): Promise<WorkspaceEntrySearchResponse> => {
      if (!sideWorkspace) {
        return { entries: [], query: query.trim().toLowerCase(), scanned: 0, truncated: false, workspaceRoot: '' };
      }
      return client.searchProjectEntries(sideWorkspace.id, query, parent);
    },
    [client, sideWorkspace],
  );
  const openSideWorkspaceFile = useCallback((filePath: string, line?: number) => {
    if (!sideWorkspace) return;
    if (sideWorkspace.id === activeWorkspace?.id) {
      onOpenWorkspaceFile(filePath, line);
      return;
    }
    void openSideWorkspaceFileAtRoot({
      filePath,
      line,
      openInWorkspaceApp: window.setsunaDesktop?.workspaceApps.open,
      openWithDefaultApp: window.setsunaDesktop?.desktop?.openWorkspaceFile,
      selectedWorkspaceApp,
      workspaceRoot: sideWorkspace.path,
    }).then((openError) => {
      if (openError) onError(openError);
    }).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [activeWorkspace?.id, onError, onOpenWorkspaceFile, selectedWorkspaceApp, sideWorkspace]);

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
        onOpenInAppBrowser={onOpenInAppBrowser}
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={sideWorkspace?.path}
        onOpenWorkspaceFile={openSideWorkspaceFile}
      >
        <ChatWorkspace
          activeProject={sideWorkspace}
          activeTurnId={sideChat.activeTurnId}
          canClearContext={Boolean(sideChat.currentThread?.messages.length)}
          client={client}
          composerKey={sideChat.composerKey}
          config={config}
          contextCompacting={sideChat.contextCompacting}
          currentThread={sideChat.currentThread}
          draft={sideChat.draft}
          plugins={plugins}
          skillSelectionRequest={null}
          skills={skills}
          threadUsage={sideChat.threadUsage}
          threads={threads}
          variant="side"
          onAnswerApproval={sideChat.answerApproval}
          onAccessModeChange={onAccessModeChange}
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
          onSearchProjectEntries={searchSideWorkspaceEntries}
          onSelectModel={onSelectModel}
          onSend={(value, options) => sideChat.actions.sendInput(value, options)}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onStartThreadReview={() => sideChat.startReview({ type: 'uncommittedChanges' })}
          onSkillSelectionRequestConsumed={() => undefined}
          onThreadMemoryModeChange={(mode) => void sideChat.updateMemoryMode(mode)}
        />
      </MarkdownNavigationProvider>
    </aside>
  );
}
