import type {
  DesktopRuntimeClient,
  RuntimeConfiguredModelReference,
  RuntimeConfigState,
  RuntimePluginSummary,
  RuntimeReviewFinding,
  RuntimeSkillSummary,
  RuntimeThread,
  RuntimeThreadSummary,
  WorkspaceEntry,
  WorkspaceEntrySearchItem,
  WorkspaceEntrySearchResponse,
  WorkspaceFileRead,
  WorkspaceProject,
} from '@setsuna-desktop/contracts';
import {
  BrowserWorkspaceFeatureBoundary,
  type BrowserNotify,
  type BrowserWorkspacePanelBinding,
  type BrowserWorkspacePanelHost,
  type BrowserScreenshotAttachmentHandler,
} from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import type { DesktopReviewSource, ReviewTarget } from '@setsuna-desktop/feature-review/contracts';
import {
  TerminalWorkspaceFeatureBoundary,
  type TerminalWorkspacePanelHost,
} from '../../composition/TerminalWorkspaceFeatureBoundary.js';
import { workspacePanelSlot } from '@setsuna-desktop/renderer-contracts/workspace';
import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  type ComponentProps,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { latestCompletedFeatureReview } from '../../composition/review-feature-adapter.js';
import { SideChatPanel } from '../../features/chat/SideChatPanel.js';
import { SubagentConversationPanel } from '../../features/chat/SubagentConversationPanel.js';
import type { ChatModelSelectionHandler } from '../../features/chat/chatModelSelection.js';
import type { DesktopBrowserPanelInstance } from '../../features/workspace/hooks/useDesktopWorkspacePanels.js';
import { desktopWorkspacePanelTargetContext } from '../../features/workspace/hooks/useDesktopWorkspacePanelSession.js';
import type { WorkspaceFileDraftState } from '../../features/workspace/hooks/useWorkspaceFileDraft.js';
import type {
  DesktopPanelDropPlacement,
  DesktopPanelSlot,
  DesktopPanelSlotState,
  DesktopPanelTab,
  DesktopPanelTabPatch,
  DesktopPanelType,
  DesktopReviewFocusRequest,
  DesktopReviewOpenHandler,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
  WorkspaceFileFocusRequest,
} from '../../features/workspace/model.js';
import { latestDesktopReviewSummaryFromMessages } from '../../features/workspace/runtimeReviewSummary.js';
import {
  WorkspaceFileContextMenu,
  type WorkspaceFileContextTarget,
} from '../../features/workspace/WorkspaceFileContextMenu.js';
import { WorkspaceResizeHandle } from '../../features/workspace/WorkspaceResizeHandle.js';
import { workspaceFileMentionEntry } from '../../features/workspace/workspaceFileMention.js';
import { RendererOwnedKeyedSlot } from '../../kernel/renderer-plugins/RendererKernelProvider.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { RuntimeAccessModeSelection } from '../../shared/lib/runtimeAccessMode.js';
import { CODE_APPEARANCE_CHANGE_EVENT_NAME } from '../../shared/preferences/useCodeAppearancePreferences.js';
import { useKeyboardShortcuts } from '../../shared/shortcuts/KeyboardShortcutsProvider.js';
import { SelectField } from '../../shared/ui/primitives.js';
import { useToast } from '../providers/ToastProvider.js';
import { FloatingWorkspacePanelSlot } from './FloatingWorkspacePanelSlot.js';

const ConversationDebugFeaturePanel = lazy(async () => {
  const module = await import('../../composition/conversation-debug-feature-panel.js');
  return { default: module.ConversationDebugFeaturePanel };
});
const BottomToolsPanel = lazy(async () => {
  const module = await import('../../features/workspace/BottomToolsPanel.js');
  return { default: module.BottomToolsPanel };
});
const WorkspacePanel = lazy(async () => {
  const module = await import('../../features/workspace/WorkspacePanel.js');
  return { default: module.WorkspacePanel };
});

type BrowserPanelMetadataHandler = (
  targetIdentity: DesktopBrowserPanelInstance['targetIdentity'],
  panelId: string,
  patch: DesktopPanelTabPatch,
) => void;

export type DesktopWorkspacePanelModel = Readonly<{
  context: Readonly<{
    activeProject?: WorkspaceProject;
    activeTurnId: string | null;
    activeWorkspace?: WorkspaceProject;
    config: RuntimeConfigState | null;
    currentThread: RuntimeThread | null;
    fileDraft: WorkspaceFileDraftState;
    fileFocusRequest: WorkspaceFileFocusRequest | null;
    filePreview: WorkspaceFileRead | null;
    plugins: RuntimePluginSummary[];
    reviewError: string | null;
    reviewFocusRequest: DesktopReviewFocusRequest | null;
    reviewLoading: boolean;
    reviewState: DesktopReviewState | null;
    runtimeClient: DesktopRuntimeClient;
    selectedWorkspaceApp: DesktopWorkspaceApp | null;
    skills: RuntimeSkillSummary[];
    threads: RuntimeThreadSummary[];
    workspaceApps: DesktopWorkspaceApp[];
  }>;
  panels: Readonly<{
    bottomActivePanel?: DesktopPanelTab | null;
    bottomPanelSlot: DesktopPanelSlotState;
    bottomPanelVisible: boolean;
    browserPanelInstances: DesktopBrowserPanelInstance[];
    conversationDebugEnabled: boolean;
    panelLauncherTypes: DesktopPanelType[];
    sideActivePanel?: DesktopPanelTab | null;
    sidePanelPresent: boolean;
    sidePanelSlot: DesktopPanelSlotState;
    terminalSessionsByPanelId: Record<string, DesktopTerminalSession>;
  }>;
  layout: Readonly<{
    terminalHeight: number;
    terminalMaxHeight: number;
    terminalMinHeight: number;
    workspaceMaxWidth: number;
    workspaceMinWidth: number;
    workspaceWidth: number;
    onTerminalResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void;
    onTerminalResizeStep(delta: number): void;
    onWorkspaceResizeStart(event: ReactPointerEvent<HTMLButtonElement>): void;
    onWorkspaceResizeStep(delta: number): void;
  }>;
  actions: Readonly<{
    onAccessModeChange(selection: RuntimeAccessModeSelection): void;
    onActivateBottomPanel(panelId: string): void;
    onCloseBottomSlot(): void;
    onClosePanel(placement: DesktopPanelSlot, panelId: string): void;
    onCopyFilePath(filePath: string): void;
    onExternalOpenFile(filePath?: string | null, line?: number): void;
    onMoveBottomPanel(panelId: string, targetPlacement: DesktopPanelSlot, targetPanelId: string | null, placement: DesktopPanelDropPlacement): void;
    onOpenBottomPanel(panel: DesktopPanelType): void;
    onOpenBrowser(url?: string): void;
    onOpenConversationDebug(): void;
    onOpenEntry(entry: WorkspaceEntry): void;
    onOpenFileReviewPanel?: DesktopReviewOpenHandler;
    onOpenFilesPanel(): void;
    onOpenFileWithApp(appId: string, filePath: string, line?: number): void;
    onOpenMarkdownWebLink(url: string): void;
    onOpenProjectFile(filePath: string, line?: number): void;
    onOpenSideChat(): void;
    onOpenSideTerminalPanel(): void;
    onOpenWorkspaceDirectory(directoryPath: string): void;
    onReloadThreads(): Promise<unknown>;
    onReorderBottomPanels(panelId: string, targetPanelId: string, placement: DesktopPanelDropPlacement): void;
    onReviewBaseRefChange(baseRef: string): void | Promise<void>;
    onReviewRefresh(): void | Promise<void>;
    onReviewSourceChange(source: DesktopReviewSource): void;
    onRevealFile(filePath: string): void;
    onSearchProjectEntries(query?: string, parent?: string | null): Promise<WorkspaceEntrySearchResponse>;
    onSelectModel: ChatModelSelectionHandler;
    onSetMultiAgentEnabled(enabled: boolean): void | Promise<unknown>;
    onSideChatError: Dispatch<SetStateAction<string | null>>;
    onStartThreadReview(target: ReviewTarget, modelSelection?: RuntimeConfiguredModelReference): Promise<unknown>;
    onUpdateBrowserPanel: BrowserPanelMetadataHandler;
    onUpdateDesktopPanel(panelId: string, patch: DesktopPanelTabPatch): void;
  }>;
}>;

export function DesktopWorkspacePanelLayer({
  model,
  onAddWorkspaceMention,
  onCloseFileContextMenu,
  requestImageAttachment,
  workspaceFileContextTarget,
}: Readonly<{
  model: DesktopWorkspacePanelModel;
  onAddWorkspaceMention(entry: WorkspaceEntrySearchItem): void;
  onCloseFileContextMenu(): void;
  requestImageAttachment: BrowserScreenshotAttachmentHandler;
  workspaceFileContextTarget: WorkspaceFileContextTarget | null;
}>) {
  const { actions, context, layout, panels } = model;
  const toast = useToast();
  const { bindingsFor } = useKeyboardShortcuts();
  const latestReviewSummary = useMemo(
    () => latestDesktopReviewSummaryFromMessages(context.currentThread?.messages ?? []),
    [context.currentThread?.messages],
  );
  const latestReviewFindings = useMemo<RuntimeReviewFinding[]>(
    () => latestCompletedFeatureReview(
      context.currentThread?.messages ?? [],
      context.activeTurnId,
    )?.findings ?? [],
    [context.activeTurnId, context.currentThread?.messages],
  );
  const currentThreadId = context.currentThread?.id;
  const currentThreadProjectId = context.currentThread?.projectId;
  const projectIdByThreadId = useMemo(() => {
    const projects = new Map(context.threads.map((thread) => [thread.id, thread.projectId] as const));
    if (currentThreadId) projects.set(currentThreadId, currentThreadProjectId);
    return projects;
  }, [context.threads, currentThreadId, currentThreadProjectId]);
  const chatPanelInstances = panelInstances(panels, 'chat');
  const subagentPanelInstances = panelInstances(panels, 'subagent').filter(({ panel }) => panel.subagent);
  const activeDebugPanel = panels.sidePanelPresent && panels.sideActivePanel?.type === 'conversation-debug'
    ? { panel: panels.sideActivePanel, placement: 'side' as const }
    : panels.bottomPanelVisible && panels.bottomActivePanel?.type === 'conversation-debug'
      ? { panel: panels.bottomActivePanel, placement: 'bottom' as const }
      : null;
  const workspacePanelProps = {
    activeProject: context.activeWorkspace,
    fileDraft: context.fileDraft,
    fileFocusRequest: context.fileFocusRequest,
    filePreview: context.filePreview,
    latestReviewFindings,
    latestReviewSummary,
    reviewError: context.reviewError,
    reviewFocusRequest: context.reviewFocusRequest,
    reviewLoading: context.reviewLoading,
    reviewState: context.reviewState,
    selectedWorkspaceApp: context.selectedWorkspaceApp,
    workspaceApps: context.workspaceApps,
    onAddFileToConversation: onAddWorkspaceMention,
    onCopyFilePath: actions.onCopyFilePath,
    onExternalOpenFile: actions.onExternalOpenFile,
    onOpenBrowser: actions.onOpenBrowser,
    onOpenConversationDebug: panels.conversationDebugEnabled ? actions.onOpenConversationDebug : undefined,
    onOpenEntry: actions.onOpenEntry,
    onOpenFilesPanel: actions.onOpenFilesPanel,
    onOpenFileWithApp: actions.onOpenFileWithApp,
    onOpenProjectFile: actions.onOpenProjectFile,
    onOpenReviewPanel: actions.onOpenFileReviewPanel,
    onOpenSideChat: actions.onOpenSideChat,
    onOpenTerminalPanel: actions.onOpenSideTerminalPanel,
    onResizeStart: layout.onWorkspaceResizeStart,
    onResizeStep: layout.onWorkspaceResizeStep,
    onReviewBaseRefChange: actions.onReviewBaseRefChange,
    onReviewRefresh: actions.onReviewRefresh,
    onReviewSourceChange: actions.onReviewSourceChange,
    onRevealFile: actions.onRevealFile,
    onSearchProjectEntries: actions.onSearchProjectEntries,
    resizeMax: layout.workspaceMaxWidth,
    resizeMin: layout.workspaceMinWidth,
    resizeValue: layout.workspaceWidth,
  } satisfies Omit<ComponentProps<typeof WorkspacePanel>, 'activePanel' | 'placement'>;

  const browserBindings = useMemo(() => new Map<string, BrowserWorkspacePanelBinding>(
    panels.browserPanelInstances.map((instance) => {
      const surfaceInstanceId = JSON.stringify([instance.targetIdentity, instance.panel.id]);
      return [surfaceInstanceId, {
        panel: { browser: instance.panel.browser, id: instance.panel.id, title: instance.panel.title },
        resizeHandle: (
          <WorkspaceResizeHandle
            max={layout.workspaceMaxWidth}
            min={layout.workspaceMinWidth}
            value={layout.workspaceWidth}
            onResizeStart={layout.onWorkspaceResizeStart}
            onResizeStep={layout.onWorkspaceResizeStep}
          />
        ),
        onPanelMetadataChange: (panelId, patch) => actions.onUpdateBrowserPanel(instance.targetIdentity, panelId, patch),
        onScreenshotAttachment: requestImageAttachment,
      }];
    }),
  ), [actions, layout, panels.browserPanelInstances, requestImageAttachment]);
  const notifyBrowser = useCallback<BrowserNotify>((tone, message) => toast.show(message, { tone }), [toast]);
  const browserHost = useMemo<BrowserWorkspacePanelHost>(() => ({
    bridge: window.setsunaDesktop?.browser ?? null,
    notify: notifyBrowser,
    openExternal: (url) => { void window.setsunaDesktop?.links.openExternal(url); },
    reloadShortcutBindings: {
      hard: bindingsFor('browser.hardReload')[0] ?? null,
      normal: bindingsFor('browser.reload')[0] ?? null,
    },
    resolveBinding: (surfaceInstanceId) => browserBindings.get(surfaceInstanceId) ?? null,
    selectField: SelectField,
  }), [bindingsFor, browserBindings, notifyBrowser]);
  const terminalHost = useMemo<TerminalWorkspacePanelHost>(() => ({
    bridge: window.setsunaDesktop?.terminal ?? null,
    openExternal: window.setsunaDesktop?.links.openExternal,
    resolveSession: (panelId) => panels.terminalSessionsByPanelId[panelId] ?? null,
    subscribeAppearanceChange,
    updateTitle: (panelId, title) => actions.onUpdateDesktopPanel(panelId, { title }),
  }), [actions, panels.terminalSessionsByPanelId]);

  return (
    <BrowserWorkspaceFeatureBoundary host={browserHost}>
      <TerminalWorkspaceFeatureBoundary host={terminalHost}>
        <WorkspaceFileContextMenu
          selectedWorkspaceApp={context.selectedWorkspaceApp}
          target={workspaceFileContextTarget}
          workspaceApps={context.workspaceApps}
          onAddToConversation={(filePath) => onAddWorkspaceMention(workspaceFileMentionEntry(filePath))}
          onClose={onCloseFileContextMenu}
          onCopyPath={actions.onCopyFilePath}
          onOpenWithApp={actions.onOpenFileWithApp}
          onReveal={actions.onRevealFile}
        />
        {panels.sidePanelPresent && panels.sideActivePanel && !isFloatingPanelType(panels.sideActivePanel.type) ? (
          <SideWorkspacePanelSlot>
            <Suspense fallback={null}>
              <WorkspacePanelRenderer panel={panels.sideActivePanel} placement="side" projectId={context.activeProject?.id ?? null} threadId={context.currentThread?.id ?? null} visible>
                <WorkspacePanel {...workspacePanelProps} activePanel={panels.sideActivePanel} placement="side" />
              </WorkspacePanelRenderer>
            </Suspense>
          </SideWorkspacePanelSlot>
        ) : null}
        {panels.bottomPanelVisible && panels.bottomActivePanel ? (
          <Suspense fallback={null}>
            <BottomToolsPanel
              activePanel={panels.bottomActivePanel}
              availablePanelTypes={panels.panelLauncherTypes}
              panels={panels.bottomPanelSlot.panels}
              resizeMax={layout.terminalMaxHeight}
              resizeMin={layout.terminalMinHeight}
              resizeValue={layout.terminalHeight}
              onActivatePanel={actions.onActivateBottomPanel}
              onClosePanel={(panelId) => actions.onClosePanel('bottom', panelId)}
              onCloseSlot={actions.onCloseBottomSlot}
              onMovePanel={actions.onMoveBottomPanel}
              onOpenPanel={actions.onOpenBottomPanel}
              onReorderPanels={actions.onReorderBottomPanels}
              onResizeStart={layout.onTerminalResizeStart}
              onResizeStep={layout.onTerminalResizeStep}
            >
              {!isFloatingPanelType(panels.bottomActivePanel.type) ? (
                <WorkspacePanelRenderer panel={panels.bottomActivePanel} placement="bottom" projectId={context.activeProject?.id ?? null} threadId={context.currentThread?.id ?? null} visible>
                  <WorkspacePanel {...workspacePanelProps} activePanel={panels.bottomActivePanel} placement="bottom" />
                </WorkspacePanelRenderer>
              ) : null}
            </BottomToolsPanel>
          </Suspense>
        ) : null}
        {chatPanelInstances.map(({ panel, placement }) => {
          const hidden = panelHidden(panels, panel.id, placement);
          return (
            <FloatingWorkspacePanelSlot hidden={hidden} key={panel.id} placement={placement}>
              <WorkspacePanelRenderer panel={panel} placement={placement} projectId={context.activeProject?.id ?? null} threadId={context.currentThread?.id ?? null} visible={!hidden}>
                <SideChatPanel
                  activeProjectId={context.activeProject?.id ?? null}
                  activeWorkspace={context.activeWorkspace}
                  client={context.runtimeClient}
                  config={context.config}
                  hidden={hidden}
                  parentThread={context.currentThread}
                  placement={placement}
                  plugins={context.plugins}
                  selectedWorkspaceApp={context.selectedWorkspaceApp}
                  skills={context.skills}
                  workspaceMaxWidth={layout.workspaceMaxWidth}
                  workspaceMinWidth={layout.workspaceMinWidth}
                  workspaceWidth={layout.workspaceWidth}
                  onAccessModeChange={actions.onAccessModeChange}
                  onError={actions.onSideChatError}
                  onOpenFileReview={actions.onOpenFileReviewPanel}
                  onOpenInAppBrowser={actions.onOpenBrowser}
                  onOpenMarkdownWebLink={actions.onOpenMarkdownWebLink}
                  onOpenSideChat={actions.onOpenSideChat}
                  onOpenWorkspaceDirectory={actions.onOpenWorkspaceDirectory}
                  onOpenWorkspaceFile={actions.onOpenProjectFile}
                  onReloadThreads={actions.onReloadThreads}
                  onSelectModel={actions.onSelectModel}
                  onSetMultiAgentEnabled={actions.onSetMultiAgentEnabled}
                  onWorkspaceResizeStart={layout.onWorkspaceResizeStart}
                  onWorkspaceResizeStep={layout.onWorkspaceResizeStep}
                />
              </WorkspacePanelRenderer>
            </FloatingWorkspacePanelSlot>
          );
        })}
        {subagentPanelInstances.map(({ panel, placement }) => {
          const hidden = panelHidden(panels, panel.id, placement);
          const subagent = panel.subagent;
          return (
            <FloatingWorkspacePanelSlot hidden={hidden} key={panel.id} placement={placement}>
              <WorkspacePanelRenderer panel={panel} placement={placement} projectId={context.activeProject?.id ?? null} threadId={context.currentThread?.id ?? null} visible={!hidden}>
                {subagent ? (
                  <SubagentConversationPanel
                    childThreadId={subagent.threadId}
                    client={context.runtimeClient}
                    config={context.config}
                    hidden={hidden}
                    initialDisplayName={panel.title ?? ''}
                    parentThreadId={subagent.parentThreadId}
                    placement={placement}
                    plugins={context.plugins}
                    skills={context.skills}
                    workspaceMaxWidth={layout.workspaceMaxWidth}
                    workspaceMinWidth={layout.workspaceMinWidth}
                    workspaceRoot={context.activeWorkspace?.path}
                    workspaceWidth={layout.workspaceWidth}
                    onClose={() => actions.onClosePanel(placement, panel.id)}
                    onError={actions.onSideChatError}
                    onOpenFileReview={actions.onOpenFileReviewPanel}
                    onOpenInAppBrowser={actions.onOpenBrowser}
                    onOpenMarkdownWebLink={actions.onOpenMarkdownWebLink}
                    onResizeStart={layout.onWorkspaceResizeStart}
                    onResizeStep={layout.onWorkspaceResizeStep}
                  />
                ) : null}
              </WorkspacePanelRenderer>
            </FloatingWorkspacePanelSlot>
          );
        })}
        {panels.browserPanelInstances.map((instance) => {
          const target = desktopWorkspacePanelTargetContext(instance.targetIdentity, projectIdByThreadId);
          const surfaceInstanceId = JSON.stringify([instance.targetIdentity, instance.panel.id]);
          return (
            <FloatingWorkspacePanelSlot hidden={!instance.active} key={surfaceInstanceId} placement={instance.placement}>
              <WorkspacePanelRenderer panel={instance.panel} placement={instance.placement} projectId={target.projectId} surfaceInstanceId={surfaceInstanceId} threadId={target.threadId} visible={instance.active}>
                {null}
              </WorkspacePanelRenderer>
            </FloatingWorkspacePanelSlot>
          );
        })}
        {activeDebugPanel && panels.conversationDebugEnabled ? (
          <FloatingWorkspacePanelSlot key={activeDebugPanel.panel.id} placement={activeDebugPanel.placement}>
            <Suspense fallback={null}>
              <WorkspacePanelRenderer panel={activeDebugPanel.panel} placement={activeDebugPanel.placement} projectId={context.activeProject?.id ?? null} threadId={context.currentThread?.id ?? null} visible>
                <ConversationDebugFeaturePanel
                  eventSource={context.runtimeClient}
                  placement={activeDebugPanel.placement}
                  resizeMax={layout.workspaceMaxWidth}
                  resizeMin={layout.workspaceMinWidth}
                  resizeValue={layout.workspaceWidth}
                  thread={context.currentThread}
                  onResizeStart={layout.onWorkspaceResizeStart}
                  onResizeStep={layout.onWorkspaceResizeStep}
                />
              </WorkspacePanelRenderer>
            </Suspense>
          </FloatingWorkspacePanelSlot>
        ) : null}
      </TerminalWorkspaceFeatureBoundary>
    </BrowserWorkspaceFeatureBoundary>
  );
}

function WorkspacePanelRenderer({ children, panel, placement, projectId, surfaceInstanceId: explicitSurfaceInstanceId, threadId, visible }: Readonly<{
  children: ReactNode;
  panel: DesktopPanelTab;
  placement: DesktopPanelSlot;
  projectId: string | null;
  surfaceInstanceId?: string;
  threadId: string | null;
  visible: boolean;
}>) {
  const { t } = useI18n();
  const surfaceInstanceId = explicitSurfaceInstanceId ?? `${placement}:${panel.id}`;
  return (
    <RendererOwnedKeyedSlot
      entryKey={panel.type}
      instanceKey={JSON.stringify([projectId, threadId, surfaceInstanceId])}
      slot={workspacePanelSlot}
      props={{ panelId: panel.id, panelType: panel.type, placement, projectId, renderDefault: () => children, surfaceInstanceId, threadId, translate: t, visible }}
    />
  );
}

function panelInstances(panels: DesktopWorkspacePanelModel['panels'], type: DesktopPanelType) {
  return [
    ...panels.sidePanelSlot.panels.filter((panel) => panel.type === type).map((panel) => ({ panel, placement: 'side' as const })),
    ...panels.bottomPanelSlot.panels.filter((panel) => panel.type === type).map((panel) => ({ panel, placement: 'bottom' as const })),
  ];
}

function panelHidden(panels: DesktopWorkspacePanelModel['panels'], panelId: string, placement: DesktopPanelSlot): boolean {
  return placement === 'side'
    ? !panels.sidePanelPresent || panels.sideActivePanel?.id !== panelId
    : !panels.bottomPanelVisible || panels.bottomActivePanel?.id !== panelId;
}

function SideWorkspacePanelSlot({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="desktop-workspace-panel-slot">{children}</div>;
}

function isFloatingPanelType(type: DesktopPanelType): boolean {
  return type === 'browser' || type === 'chat' || type === 'subagent' || type === 'conversation-debug';
}

function subscribeAppearanceChange(listener: () => void): () => void {
  window.addEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, listener);
  return () => window.removeEventListener(CODE_APPEARANCE_CHANGE_EVENT_NAME, listener);
}
