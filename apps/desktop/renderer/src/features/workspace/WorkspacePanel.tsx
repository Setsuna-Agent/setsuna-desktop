import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceEntry,
  type WorkspaceEntrySearchItem,
  type WorkspaceEntrySearchResponse,
  type WorkspaceFileRead,
  type WorkspaceProject,
  type RuntimeReviewFinding,
} from '@setsuna-desktop/contracts';
import { Bug, ChevronDown, FileDiff, Folder, FolderOpen, Globe2, MessageSquare, Pencil, Save, Search, Terminal, X } from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CodeFileView } from '../../shared/code/PierreCode.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { ShortcutHint } from '../../shared/ui/ShortcutTooltip.js';
import { EmptyState, IconButton } from '../../shared/ui/primitives.js';
import {
  useWorkspaceCodeViewSurface,
  workspaceCodeViewLayout,
  workspaceCodeViewUnsafeCSS,
} from './editor/useWorkspaceCodeViewSurface.js';
import { WorkspaceCodeViewScrollbar } from './editor/WorkspaceCodeViewScrollbar.js';
import type { WorkspaceFileDraftState } from './hooks/useWorkspaceFileDraft.js';
import type {
  DesktopDiffSummary,
  DesktopPanelSlot,
  DesktopPanelTab,
  DesktopReviewFocusRequest,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
  ProjectTreeNode,
  WorkspaceFileFocusRequest,
} from './model.js';
import { desktopPanelTitle } from './PanelChrome.js';
import { DesktopReviewPanel } from './ReviewPanel.js';
import { LazyTerminalPane } from './LazyTerminalPane.js';
import {
  WorkspaceFileContextMenu,
  type WorkspaceFileContextTarget,
} from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon, WorkspaceFilePath } from './WorkspaceFileIcon.js';
import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';
import {
  workspaceDirectoryMentionEntry,
  workspaceFileMentionEntry,
} from './workspaceFileMention.js';

const FILE_TREE_INDENT_STEP_PX = 8;
const LazyEditableWorkspaceFile = lazy(async () => {
  const module = await import('./editor/EditableWorkspaceFile.js');
  return { default: module.EditableWorkspaceFile };
});

export function WorkspacePanel({
  activePanel,
  placement = 'side',
  activeProject,
  fileDraft,
  fileFocusRequest,
  filePreview,
  latestReviewSummary,
  latestReviewFindings,
  reviewError,
  reviewFocusRequest,
  reviewLoading,
  reviewState,
  selectedWorkspaceApp,
  workspaceApps,
  terminalSession,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onSearchProjectEntries,
  onOpenEntry,
  onOpenProjectFile,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenReviewPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
  onTerminalTitleChange,
  onReviewRefresh,
  onReviewBaseRefChange,
  onRevealFile,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  activePanel: DesktopPanelTab;
  placement?: DesktopPanelSlot;
  activeProject?: WorkspaceProject;
  fileDraft: WorkspaceFileDraftState;
  fileFocusRequest: WorkspaceFileFocusRequest | null;
  filePreview: WorkspaceFileRead | null;
  latestReviewSummary: DesktopDiffSummary | null;
  latestReviewFindings: RuntimeReviewFinding[];
  reviewError: string | null;
  reviewFocusRequest: DesktopReviewFocusRequest | null;
  reviewLoading: boolean;
  reviewState: DesktopReviewState | null;
  selectedWorkspaceApp: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  terminalSession: DesktopTerminalSession | null;
  onAddFileToConversation: (entry: WorkspaceEntrySearchItem) => void;
  onCopyFilePath: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchResponse>;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string, line?: number) => void;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
  onTerminalTitleChange?: (panelId: string, title: string) => void;
  onReviewRefresh: () => void;
  onReviewBaseRefChange: (baseRef: string) => void;
  onRevealFile: (filePath: string) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const { t } = useI18n();
  const [treeEntries, setTreeEntries] = useState<WorkspaceEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [loadedDirectoryPaths, setLoadedDirectoryPaths] = useState<Set<string>>(() => new Set(['']));
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<Set<string>>(() => new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeQuery, setTreeQuery] = useState('');
  const [treeSearching, setTreeSearching] = useState(false);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState(248);
  const [contextMenu, setContextMenu] = useState<WorkspaceFileContextTarget | null>(null);
  const showsFileExplorer = activePanel.type === 'files' || activePanel.type === 'file';
  const tree = useMemo(() => buildProjectEntryTree(treeEntries), [treeEntries]);
  const query = treeQuery.trim().toLowerCase();
  const activeProjectLabel = activeProject?.name ?? t('workspace.files.noProject');
  const editorPath = filePreview ? `${activeProjectLabel}/${filePreview.path}` : activeProjectLabel;

  useEffect(() => {
    if (!activeProject) {
      setTreeSearching(false);
      setTreeEntries([]);
      setExpandedPaths(new Set());
      setLoadedDirectoryPaths(new Set());
      setLoadingDirectoryPaths(new Set());
      setTreeError(null);
      setTreeTruncated(false);
      setTreeQuery('');
      return undefined;
    }
    if (!showsFileExplorer) {
      setTreeSearching(false);
      setTreeError(null);
      setTreeTruncated(false);
      return undefined;
    }

    let cancelled = false;
    const parent = query ? undefined : '';
    setTreeSearching(true);
    setTreeError(null);
    setTreeTruncated(false);
    onSearchProjectEntries(query, parent)
      .then((result) => {
        if (cancelled) return;
        setTreeEntries(result.entries.map(searchItemToWorkspaceEntry));
        setTreeTruncated(result.truncated);
        setLoadedDirectoryPaths(query ? new Set() : new Set(['']));
        setLoadingDirectoryPaths(new Set());
      })
      .catch((unknownError) => {
        if (cancelled) return;
        setTreeEntries([]);
        setTreeTruncated(false);
        setTreeError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (!cancelled) setTreeSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject, onSearchProjectEntries, query, showsFileExplorer]);

  const loadDirectory = async (pathValue: string) => {
    const normalizedPath = normalizeProjectTreePath(pathValue);
    if (!activeProject || query || loadedDirectoryPaths.has(normalizedPath) || loadingDirectoryPaths.has(normalizedPath)) return;
    setLoadingDirectoryPaths((current) => new Set(current).add(normalizedPath));
    setTreeError(null);
    try {
      const incoming = await onSearchProjectEntries('', normalizedPath);
      setTreeEntries((current) => mergeProjectEntries(current, incoming.entries.map(searchItemToWorkspaceEntry)));
      if (incoming.truncated) setTreeTruncated(true);
      setLoadedDirectoryPaths((current) => new Set(current).add(normalizedPath));
    } catch (unknownError) {
      setTreeError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setLoadingDirectoryPaths((current) => {
        const next = new Set(current);
        next.delete(normalizedPath);
        return next;
      });
    }
  };

  const toggleDirectory = (pathValue: string) => {
    const normalizedPath = normalizeProjectTreePath(pathValue);
    const expanding = !expandedPaths.has(normalizedPath);
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(normalizedPath)) {
        next.delete(normalizedPath);
      } else {
        next.add(normalizedPath);
      }
      return next;
    });
    if (expanding) void loadDirectory(pathValue);
  };

  const updateTreeQuery = (value: string) => {
    setTreeQuery(value);
  };

  const startTreeResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = treeWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setTreeWidth(clampFileTreeWidth(startWidth + startX - moveEvent.clientX));
    };
    const stopResize = () => {
      document.body.classList.remove('desktop-file-tree-resizing');
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
    document.body.classList.add('desktop-file-tree-resizing');
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  };

  const renderTreeNode = (node: ProjectTreeNode, level = 0): ReactNode => {
    const directory = node.type === 'directory';
    const normalizedPath = normalizeProjectTreePath(node.path);
    const expanded = Boolean(query) || expandedPaths.has(normalizedPath);
    const loading = loadingDirectoryPaths.has(normalizedPath);
    const selected = filePreview?.path === node.path;
    return (
      <div className="desktop-file-tree-node" key={node.path}>
        <div className={`desktop-file-row-shell ${selected ? 'is-active' : ''}`} style={{ '--desktop-file-tree-indent': `${level * FILE_TREE_INDENT_STEP_PX}px` } as CSSProperties}>
          <button
            className={`desktop-file-row desktop-file-row--${node.type}`}
            type="button"
            title={node.path}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ filePath: node.path, type: node.type, x: event.clientX, y: event.clientY });
            }}
            onClick={() => (directory ? toggleDirectory(node.path) : onOpenEntry(node.entry))}
          >
            {directory ? <ChevronDown className={expanded ? '' : 'is-collapsed'} size={12} /> : <span className="desktop-file-row__spacer" />}
            <WorkspaceFileIcon path={node.path} type={node.type} />
            <span title={node.path}>{node.name}</span>
            {loading ? <span className="desktop-file-row__loading">...</span> : null}
          </button>
        </div>
        {directory && expanded ? node.children.map((child) => renderTreeNode(child, level + 1)) : null}
      </div>
    );
  };

  const fileEditorHeader = showsFileExplorer ? (
    <div className="desktop-editor__crumb">
      <span className="desktop-editor__crumb-path">
        <WorkspaceFilePath path={editorPath} />
        {fileDraft.dirty ? <i aria-label={t('workspace.files.unsaved')}>●</i> : null}
      </span>
      <span className="desktop-editor__crumb-actions">
        {filePreview?.preview?.kind === 'text' ? (
          fileDraft.editing ? (
            <>
              <IconButton
                className="app-shell-icon-control"
                disabled={fileDraft.saving}
                label={t('workspace.files.cancelEdit')}
                onClick={fileDraft.cancelEditing}
              >
                <X size={15} />
              </IconButton>
              <IconButton
                className="app-shell-icon-control"
                disabled={!fileDraft.dirty || fileDraft.saving}
                label={t(fileDraft.saving ? 'workspace.files.saving' : 'workspace.files.save')}
                onClick={() => void fileDraft.save()}
              >
                <Save size={15} />
              </IconButton>
            </>
          ) : (
            <IconButton
              className="app-shell-icon-control"
              disabled={!fileDraft.canEdit || fileDraft.preparing}
              label={t(fileDraft.preparing
                ? 'workspace.files.loadingEditor'
                : fileDraft.canEdit
                  ? 'workspace.files.edit'
                  : 'workspace.files.editUnavailable')}
              onClick={() => void fileDraft.startEditing()}
            >
              <Pencil size={14} />
            </IconButton>
          )
        ) : null}
        <IconButton
          className="app-shell-icon-control desktop-editor__tree-toggle"
          label={t(treeVisible ? 'workspace.files.collapseTree' : 'workspace.files.expandTree')}
          aria-pressed={treeVisible}
          onClick={() => setTreeVisible((current) => !current)}
        >
          {treeVisible ? <FolderOpen size={16} /> : <Folder size={16} />}
        </IconButton>
      </span>
    </div>
  ) : null;

  const mainPanel =
    activePanel.type === 'overview' ? (
      <WorkspaceOverviewPanel
        activeProject={activeProject}
        onOpenFilesPanel={onOpenFilesPanel}
        onOpenBrowser={onOpenBrowser}
        onOpenConversationDebug={onOpenConversationDebug}
        onOpenReviewPanel={onOpenReviewPanel}
        onOpenSideChat={onOpenSideChat}
        onOpenTerminalPanel={onOpenTerminalPanel}
      />
    ) : activePanel.type === 'review' ? (
      <DesktopReviewPanel
        activeProject={activeProject}
        error={reviewError}
        focusRequest={reviewFocusRequest}
        latestSummary={latestReviewSummary}
        findings={latestReviewFindings}
        loading={reviewLoading}
        reviewState={reviewState}
        workspaceApp={selectedWorkspaceApp}
        workspaceApps={workspaceApps}
        onAddFileToConversation={(filePath) => onAddFileToConversation(workspaceFileMentionEntry(filePath))}
        onCopyFilePath={onCopyFilePath}
        onExternalOpenFile={onExternalOpenFile}
        onOpenFileWithApp={onOpenFileWithApp}
        onOpenProjectFile={onOpenProjectFile}
        onRefresh={onReviewRefresh}
        onSelectBaseRef={onReviewBaseRefChange}
        onRevealFile={onRevealFile}
      />
    ) : activePanel.type === 'terminal' ? (
      <section className="desktop-workspace-terminal-panel" aria-label={desktopPanelTitle(activePanel, t)}>
        <LazyTerminalPane
          session={terminalSession}
          onTitleChange={(title) => onTerminalTitleChange?.(activePanel.id, title)}
        />
      </section>
    ) : (
      <section
        className={`desktop-editor ${fileDraft.errorMessage ? 'has-save-error' : ''}`}
        onContextMenu={filePreview ? (event) => {
          event.preventDefault();
          const line = workspaceFileLineNumberFromEvent(event);
          setContextMenu({
            filePath: filePreview.path,
            line,
            x: event.clientX,
            y: event.clientY,
          });
        } : undefined}
      >
        {fileDraft.errorMessage ? (
          <div className="desktop-editor__save-error" role="alert">
            {fileDraft.errorMessage}
          </div>
        ) : null}
        {filePreview ? (
          <WorkspaceFilePreviewContent
            file={filePreview}
            fileDraft={fileDraft}
            fileFocusRequest={fileFocusRequest}
          />
        ) : (
          <EmptyState title={t('workspace.files.noneOpen')} body={t('workspace.files.noneOpenDescription')} />
        )}
      </section>
    );

  return (
    <>
      <aside className={`desktop-workspace-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-embedded' : ''}`}>
        {placement === 'side' ? (
          <WorkspaceResizeHandle
            max={resizeMax}
            min={resizeMin}
            value={resizeValue}
            onResizeStart={onResizeStart}
            onResizeStep={onResizeStep}
          />
        ) : null}
        <div
          className={`desktop-workspace-body ${showsFileExplorer ? 'desktop-workspace-body--file-explorer' : 'desktop-workspace-body--single'}`}
          style={showsFileExplorer ? ({ '--desktop-file-tree-width': `${treeVisible ? treeWidth : 0}px` } as CSSProperties) : undefined}
        >
          {fileEditorHeader}
          {mainPanel}
          {showsFileExplorer ? (
            <section className={`desktop-file-explorer ${treeVisible ? '' : 'desktop-file-explorer--tree-collapsed'}`}>
              <div className="desktop-file-tree" aria-hidden={!treeVisible}>
                <button
                  className="desktop-file-tree__resize-handle"
                  type="button"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('workspace.files.resizeTree')}
                  aria-valuemin={FILE_TREE_MIN_WIDTH}
                  aria-valuemax={FILE_TREE_MAX_WIDTH}
                  aria-valuenow={treeWidth}
                  title={t('workspace.files.resizeTreeHint')}
                  onPointerDown={startTreeResize}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                      event.preventDefault();
                      setTreeWidth((current) => clampFileTreeWidth(current - 16));
                    } else if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      setTreeWidth((current) => clampFileTreeWidth(current + 16));
                    }
                  }}
                />
                <div className="desktop-file-search">
                  <Search size={13} />
                  <input
                    value={treeQuery}
                    onChange={(event) => updateTreeQuery(event.target.value)}
                    placeholder={t('workspace.files.filter')}
                  />
                </div>
                {activeProject ? (
                  <div className="desktop-file-list">
                    {treeSearching ? <div className="desktop-file-tree__empty">{t('workspace.files.searching')}</div> : null}
                    {treeError ? <div className="desktop-file-tree__empty">{treeError}</div> : null}
                    {!treeSearching && !treeError && tree.length ? (
                      tree.map((node) => renderTreeNode(node))
                    ) : !treeSearching && !treeError && query ? (
                      <div className="desktop-file-tree__empty">{t('workspace.files.noMatch')}</div>
                    ) : !treeSearching && !treeError ? (
                      <EmptyState title={t('workspace.files.empty')} />
                    ) : null}
                    {!treeSearching && !treeError && treeTruncated ? (
                      <div className="desktop-file-tree__empty">
                        {t(query ? 'workspace.files.searchLimit' : 'workspace.files.scanLimit')}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <EmptyState title={t('workspace.review.noProject')} body={t('workspace.review.addProject')} />
                )}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
      <WorkspaceFileContextMenu
        selectedWorkspaceApp={selectedWorkspaceApp}
        target={contextMenu}
        workspaceApps={workspaceApps}
        onAddToConversation={(entryPath, type) => onAddFileToConversation(
          type === 'directory'
            ? workspaceDirectoryMentionEntry(entryPath)
            : workspaceFileMentionEntry(entryPath),
        )}
        onClose={() => setContextMenu(null)}
        onCopyPath={onCopyFilePath}
        onOpenWithApp={onOpenFileWithApp}
        onReveal={onRevealFile}
      />
    </>
  );
}

export function WorkspaceOverviewPanel({
  activeProject,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenReviewPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
}: {
  activeProject?: WorkspaceProject;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
}) {
  const { t } = useI18n();
  const actions: Array<{
    key: string;
    label: string;
    icon: JSX.Element;
    disabled: boolean;
    onClick: () => void;
    shortcutCommandId: KeyboardShortcutCommandId;
  }> = [
    {
      key: 'review',
      label: t('workspace.overview.review'),
      icon: <FileDiff size={15} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
      shortcutCommandId: 'workspace.openReview',
    },
    {
      key: 'files',
      label: t('workspace.overview.files'),
      icon: <FolderOpen size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenFilesPanel,
      shortcutCommandId: 'workspace.openFiles',
    },
    {
      key: 'terminal',
      label: t('workspace.overview.terminal'),
      icon: <Terminal size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenTerminalPanel,
      shortcutCommandId: 'workspace.openTerminal',
    },
    {
      key: 'side-chat',
      label: t('workspace.overview.sideChat'),
      icon: <MessageSquare size={15} />,
      disabled: false,
      onClick: onOpenSideChat,
      shortcutCommandId: 'workspace.openSideChat',
    },
    {
      key: 'browser',
      label: t('workspace.overview.browser'),
      icon: <Globe2 size={15} />,
      disabled: false,
      onClick: () => onOpenBrowser(),
      shortcutCommandId: 'workspace.openBrowser',
    },
    ...(onOpenConversationDebug ? [{
      key: 'conversation-debug',
      label: t('workspace.overview.conversationDebug'),
      icon: <Bug size={15} />,
      disabled: false,
      onClick: onOpenConversationDebug,
      shortcutCommandId: 'workspace.openConversationDebug' as const,
    }] : []),
  ];

  return (
    <section className="desktop-workspace-overview" aria-label={t('workspace.overview.label')}>
      <div className="desktop-workspace-overview__actions">
        {actions.map((action) => (
          <button
            className="desktop-workspace-overview__action"
            data-workspace-overview-action={action.key}
            disabled={action.disabled}
            key={action.key}
            type="button"
            onClick={action.onClick}
          >
            <span className="desktop-workspace-overview__action-icon">{action.icon}</span>
            <span className="desktop-workspace-overview__action-label">{action.label}</span>
            <ShortcutHint
              className="desktop-workspace-overview__action-shortcut"
              commandId={action.shortcutCommandId}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceFilePreviewContent({
  file,
  fileDraft,
  fileFocusRequest,
}: {
  file: WorkspaceFileRead;
  fileDraft?: WorkspaceFileDraftState;
  fileFocusRequest?: WorkspaceFileFocusRequest | null;
}) {
  const { t } = useI18n();
  const activeFocusRequest = fileFocusRequest?.path === file.path
    ? fileFocusRequest
    : undefined;
  if (file.preview?.kind === 'image') {
    return (
      <div className="desktop-file-preview desktop-file-preview--image">
        <img
          className="desktop-file-preview__image"
          src={`data:${file.preview.mimeType};base64,${file.preview.base64}`}
          alt={t('workspace.files.previewAlt', { path: file.path })}
          draggable={false}
        />
      </div>
    );
  }
  if (file.preview?.kind === 'unsupported') {
    const imageTooLarge = file.preview.reason === 'image-too-large';
    return (
      <div className="desktop-file-preview desktop-file-preview--unsupported">
        <EmptyState
          title={t(imageTooLarge ? 'workspace.files.imageTooLarge' : 'workspace.files.binaryUnsupported')}
          body={t('workspace.files.openExternally')}
        />
      </div>
    );
  }
  if (fileDraft?.editing) {
    return (
      <Suspense fallback={(
        <CodeEditorPreview file={file} fileFocusRequest={activeFocusRequest} />
      )}>
        <LazyEditableWorkspaceFile
          content={fileDraft.content}
          file={file}
          fileFocusRequest={activeFocusRequest}
          onChange={fileDraft.updateContent}
          onSave={fileDraft.save}
        />
      </Suspense>
    );
  }
  return <CodeEditorPreview file={file} fileFocusRequest={activeFocusRequest} />;
}

function CodeEditorPreview({
  file,
  fileFocusRequest,
}: {
  file: WorkspaceFileRead;
  fileFocusRequest?: WorkspaceFileFocusRequest;
}) {
  const { t } = useI18n();
  const codeViewSurface = useWorkspaceCodeViewSurface();
  return (
    <div
      className="desktop-code-editor desktop-code-editor--code-view"
      role="region"
      aria-label={file.path}
    >
      <div className="desktop-code-editor__viewport">
        <CodeFileView
          cacheKey={`${file.projectId}:${file.path}:${file.revision ?? file.modifiedAt ?? file.size}`}
          className="desktop-code-editor__pierre"
          codeViewLayout={workspaceCodeViewLayout}
          containerRef={codeViewSurface.codeViewContainerRef}
          contents={file.content}
          lineFocusRequest={fileFocusRequest}
          name={file.path}
          unsafeCSS={workspaceCodeViewUnsafeCSS}
          virtualized
        />
        <WorkspaceCodeViewScrollbar surface={codeViewSurface} />
        {file.truncated ? (
          <div className="desktop-code-editor__truncated-notice" role="status">
            {t('workspace.files.previewTruncated', {
              limit: `${WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES / (1024 * 1024)} MB`,
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function workspaceFileLineNumberFromEvent(event: ReactMouseEvent<HTMLElement>): number | undefined {
  for (const target of event.nativeEvent.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const line = Number(target.dataset.line ?? target.dataset.workspaceFileLine);
    if (Number.isSafeInteger(line) && line > 0) return line;
  }
  return undefined;
}

const FILE_TREE_MIN_WIDTH = 190;
const FILE_TREE_MAX_WIDTH = 360;

function clampFileTreeWidth(value: number): number {
  return Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, Math.round(value)));
}

function normalizeProjectTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/?$/, '').replace(/\/+$/, '');
}

function searchItemToWorkspaceEntry(item: WorkspaceEntrySearchItem): WorkspaceEntry {
  return {
    name: item.name,
    path: item.path,
    type: item.kind,
  };
}

function mergeProjectEntries(current: WorkspaceEntry[], incoming: WorkspaceEntry[]): WorkspaceEntry[] {
  const byPath = new Map(current.map((entry) => [entry.path, entry]));
  incoming.forEach((entry) => byPath.set(entry.path, entry));
  return [...byPath.values()].sort(compareWorkspaceEntry);
}

function compareWorkspaceEntry(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name);
}

function buildProjectEntryTree(entries: WorkspaceEntry[]): ProjectTreeNode[] {
  const root: ProjectTreeNode = {
    children: [],
    entry: { name: '', path: '', type: 'directory' },
    name: '',
    path: '',
    type: 'directory',
  };
  [...entries].sort(compareWorkspaceEntry).forEach((entry) => {
    const parts = normalizeProjectTreePath(entry.path).split('/').filter(Boolean);
    let parent = root;
    let currentPath = '';
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const last = index === parts.length - 1;
      const type = last ? entry.type : 'directory';
      let node = parent.children.find((item) => item.path === currentPath);
      if (!node) {
        node = {
          children: [],
          entry: last ? entry : { name: part, path: currentPath, type: 'directory' },
          name: last ? entry.name : part,
          path: currentPath,
          type,
        };
        parent.children.push(node);
      } else if (last) {
        node.entry = entry;
        node.name = entry.name;
        node.type = entry.type;
      }
      if (node.type === 'directory') parent = node;
    });
  });

  const sortNode = (node: ProjectTreeNode) => {
    node.children.sort((left, right) => compareWorkspaceEntry(left.entry, right.entry));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root.children;
}
