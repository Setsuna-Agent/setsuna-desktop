import type {
  DesktopRuntimeClient,
  DesktopWorkspaceApp,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeSkillSummary,
  RuntimeThread,
  WorkspaceEntrySearchResponse,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { useCallback, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import { useThreadWorkspace } from '../workspace/hooks/useThreadWorkspace.js';
import type {
  DesktopPanelSlot,
  DesktopReviewOpenHandler,
} from '../workspace/model.js';
import { WorkspaceResizeHandle } from '../workspace/WorkspaceResizeHandle.js';
import { ChatWorkspace } from './ChatWorkspace.js';
import type { ChatModelSelectionHandler } from './chatModelSelection.js';
import { useSideChat } from './hooks/useSideChat.js';
import { MarkdownNavigationProvider } from './markdown/MarkdownNavigationProvider.js';
import {
  openSideWorkspaceDirectoryAtRoot,
  openSideWorkspaceFileAtRoot,
} from './mentions/sideWorkspaceFileOpening.js';

export function SideChatPanel({
  activeProjectId,
  activeWorkspace,
  client,
  config,
  hidden,
  parentThread,
  placement = 'side',
  plugins,
  selectedWorkspaceApp,
  skills,
  onAccessModeChange,
  onError,
  onOpenInAppBrowser,
  onOpenFileReview,
  onOpenMarkdownWebLink,
  onOpenWorkspaceDirectory,
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
  parentThread: RuntimeThread | null;
  placement?: DesktopPanelSlot;
  plugins: RuntimePluginSummary[];
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  skills: RuntimeSkillSummary[];
  onAccessModeChange: (selection: RuntimeAccessModeSelection) => void;
  onError: Dispatch<SetStateAction<string | null>>;
  onOpenInAppBrowser: (url: string) => void;
  onOpenFileReview?: DesktopReviewOpenHandler;
  onOpenMarkdownWebLink: (url: string) => void;
  onOpenWorkspaceDirectory: (directoryPath: string) => void;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  onOpenSideChat: () => void;
  onReloadThreads: () => Promise<unknown>;
  onSelectModel: ChatModelSelectionHandler;
  onSetMultiAgentEnabled: (enabled: boolean) => void | Promise<unknown>;
  onWorkspaceResizeStep: (delta: number) => void;
  onWorkspaceResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  workspaceMaxWidth: number;
  workspaceMinWidth: number;
  workspaceWidth: number;
}) {
  const { t } = useI18n();
  const sideChat = useSideChat({
    activeProjectId,
    client,
    config,
    parentThread,
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
  // Review state belongs to the main workspace panel. Keep findings static
  // when a global side chat points elsewhere instead of opening the wrong diff.
  const openSideWorkspaceReview = sideWorkspace && activeWorkspace
    && sideWorkspace.id === activeWorkspace.id
    ? onOpenFileReview
    : undefined;
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
    if (!sideWorkspace?.path) return;
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
      t,
      workspaceRoot: sideWorkspace.path,
    }).then((openError) => {
      if (openError) onError(openError);
    }).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [activeWorkspace?.id, onError, onOpenWorkspaceFile, selectedWorkspaceApp, sideWorkspace, t]);
  const openSideWorkspaceDirectory = useCallback((directoryPath: string) => {
    if (!sideWorkspace?.path) return;
    if (sideWorkspace.id === activeWorkspace?.id) {
      onOpenWorkspaceDirectory(directoryPath);
      return;
    }
    void openSideWorkspaceDirectoryAtRoot({
      directoryPath,
      openDirectory: window.setsunaDesktop?.desktop?.openWorkspaceDirectory,
      t,
      workspaceRoot: sideWorkspace.path,
    }).then((openError) => {
      if (openError) onError(openError);
    }).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error));
    });
  }, [activeWorkspace?.id, onError, onOpenWorkspaceDirectory, sideWorkspace, t]);

  return (
    <aside
      className={`desktop-workspace-panel desktop-side-chat-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-floating' : ''}`}
      aria-label={t('chat.sideChat.label')}
      hidden={hidden}
    >
      {placement === 'side' ? (
        <WorkspaceResizeHandle
          max={workspaceMaxWidth}
          min={workspaceMinWidth}
          value={workspaceWidth}
          onResizeStart={onWorkspaceResizeStart}
          onResizeStep={onWorkspaceResizeStep}
        />
      ) : null}
      <MarkdownNavigationProvider
        onOpenInAppBrowser={onOpenInAppBrowser}
        onOpenWebLink={onOpenMarkdownWebLink}
        workspaceRoot={sideWorkspace?.path}
        onOpenWorkspaceDirectory={openSideWorkspaceDirectory}
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
          focusComposerOnReveal={!hidden}
          plugins={plugins}
          skillSelectionRequest={null}
          skills={skills}
          threadUsage={sideChat.threadUsage}
          variant="side"
          onAnswerApproval={sideChat.answerApproval}
          onAccessModeChange={onAccessModeChange}
          onCancelActiveTurn={() => void sideChat.actions.cancelActiveTurn()}
          onClearContext={() => void sideChat.clearContext()}
          onCompactContext={() => void sideChat.compactContext()}
          onDeleteMessages={sideChat.actions.deleteMessages}
          onDraftChange={sideChat.setDraft}
          onEditUserMessage={sideChat.actions.editUserMessage}
          onOpenSideChat={onOpenSideChat}
          onOpenFileReview={openSideWorkspaceReview}
          onSearchProjectEntries={searchSideWorkspaceEntries}
          onSelectModel={onSelectModel}
          onSend={(value, options) => sideChat.actions.sendInput(value, options)}
          queuedTurnActions={sideChat.actions}
          onSetMultiAgentEnabled={onSetMultiAgentEnabled}
          onStartThreadReview={sideChat.startReview}
          onSkillSelectionRequestConsumed={() => undefined}
        />
      </MarkdownNavigationProvider>
    </aside>
  );
}
