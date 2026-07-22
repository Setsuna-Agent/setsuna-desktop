import {
  isTemporaryWorkspaceProjectId,
  type WorkspaceEntry,
  type WorkspaceEntrySearchItem,
  type WorkspaceEntrySearchResponse,
  type WorkspaceFileRead,
  type WorkspaceProject,
} from '@setsuna-desktop/contracts';
import { ChevronDown, FileText, Folder, FolderOpen, Globe2, MessageSquare, Search, Terminal } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useI18n, type Translate } from '../../shared/i18n/I18nProvider.js';
import { EmptyState, IconButton } from '../../shared/ui/primitives.js';
import { fileLanguage, highlightedCodeLinesHtml } from './codeHighlight.js';
import type {
  DesktopDiffSummary,
  DesktopPanelTab,
  DesktopReviewFocusRequest,
  DesktopReviewLoadOptions,
  DesktopReviewState,
  DesktopTerminalSession,
  DesktopWorkspaceApp,
  ProjectTreeNode,
} from './model.js';
import { desktopPanelTitle } from './PanelChrome.js';
import { DesktopReviewPanel } from './ReviewPanel.js';
import { TerminalPane } from './TerminalPane.js';
import {
  WorkspaceFileContextMenu,
  workspaceFileMentionEntry,
  type WorkspaceFileContextTarget,
} from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';
import { WorkspaceResizeHandle } from './WorkspaceResizeHandle.js';

const FILE_TREE_INDENT_STEP_PX = 8;

export function WorkspacePanel({
  activePanel,
  activeProject,
  filePreview,
  latestReviewSummary,
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
  onOpenReviewPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
  onReviewRefresh,
  onRevealFile,
  onResizeStep,
  onResizeStart,
  resizeMax,
  resizeMin,
  resizeValue,
}: {
  activePanel: DesktopPanelTab;
  activeProject?: WorkspaceProject;
  filePreview: WorkspaceFileRead | null;
  latestReviewSummary: DesktopDiffSummary | null;
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
  onOpenProjectFile: (filePath: string) => void;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenReviewPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
  onReviewRefresh: (options?: DesktopReviewLoadOptions) => void;
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
            onContextMenu={!directory ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ filePath: node.path, x: event.clientX, y: event.clientY });
            } : undefined}
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

  const mainPanel =
    activePanel.type === 'overview' ? (
      <WorkspaceOverviewPanel
        activeProject={activeProject}
        latestReviewSummary={latestReviewSummary}
        onOpenFilesPanel={onOpenFilesPanel}
        onOpenBrowser={onOpenBrowser}
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
        onRevealFile={onRevealFile}
      />
    ) : activePanel.type === 'terminal' ? (
      <section className="desktop-workspace-terminal-panel" aria-label={desktopPanelTitle(activePanel, t)}>
        <TerminalPane session={terminalSession} />
      </section>
    ) : (
      <section
        className="desktop-editor"
        onContextMenu={filePreview ? (event) => {
          event.preventDefault();
          const lineElement = (event.target as Element).closest<HTMLElement>('[data-workspace-file-line]');
          const line = Number(lineElement?.dataset.workspaceFileLine);
          setContextMenu({
            filePath: filePreview.path,
            line: Number.isSafeInteger(line) && line > 0 ? line : undefined,
            x: event.clientX,
            y: event.clientY,
          });
        } : undefined}
      >
        <div className="desktop-editor__crumb">
          <span className="desktop-editor__crumb-path">
            <span>{activeProject?.name ?? t('workspace.files.noProject')}</span>
            {filePreview ? <span>{filePreview.path}</span> : null}
          </span>
          <IconButton
            className="app-shell-icon-control desktop-editor__tree-toggle"
            label={t(treeVisible ? 'workspace.files.collapseTree' : 'workspace.files.expandTree')}
            aria-pressed={treeVisible}
            onClick={() => setTreeVisible((current) => !current)}
          >
            {treeVisible ? <FolderOpen size={16} /> : <Folder size={16} />}
          </IconButton>
        </div>
        {filePreview ? (
          <WorkspaceFilePreviewContent file={filePreview} />
        ) : (
          <EmptyState title={t('workspace.files.noneOpen')} body={t('workspace.files.noneOpenDescription')} />
        )}
      </section>
    );

  return (
    <>
      <aside className="desktop-workspace-panel">
        <WorkspaceResizeHandle
          max={resizeMax}
          min={resizeMin}
          value={resizeValue}
          onResizeStart={onResizeStart}
          onResizeStep={onResizeStep}
        />
        <div
          className={`desktop-workspace-body ${showsFileExplorer ? '' : 'desktop-workspace-body--single'}`}
          style={showsFileExplorer ? ({ '--desktop-file-tree-width': `${treeVisible ? treeWidth : 0}px` } as CSSProperties) : undefined}
        >
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
        onAddToConversation={(filePath) => onAddFileToConversation(workspaceFileMentionEntry(filePath))}
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
  latestReviewSummary,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenReviewPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
}: {
  activeProject?: WorkspaceProject;
  latestReviewSummary: DesktopDiffSummary | null;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenReviewPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
}) {
  const { t } = useI18n();
  const temporaryWorkspace = activeProject ? isTemporaryWorkspaceProjectId(activeProject.id) : false;
  const reviewMeta = latestReviewSummary?.files.length
    ? t(latestReviewSummary.files.length === 1
      ? 'workspace.overview.reviewFiles.one'
      : 'workspace.overview.reviewFiles.many', { count: latestReviewSummary.files.length })
    : t('workspace.overview.reviewDescription');
  const actions = [
    {
      key: 'review',
      label: t('workspace.overview.review'),
      meta: reviewMeta,
      icon: <FileText size={15} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
    },
    {
      key: 'files',
      label: t('workspace.overview.files'),
      meta: activeProject?.name ?? t('workspace.overview.noProject'),
      icon: <FolderOpen size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenFilesPanel,
    },
    {
      key: 'terminal',
      label: t('workspace.overview.terminal'),
      meta: activeProject?.path
        ? t(temporaryWorkspace ? 'workspace.overview.temporaryShell' : 'workspace.overview.projectShell')
        : t('workspace.overview.noProject'),
      icon: <Terminal size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenTerminalPanel,
    },
    {
      key: 'side-chat',
      label: t('workspace.overview.sideChat'),
      meta: t('workspace.overview.sideChatDescription'),
      icon: <MessageSquare size={15} />,
      disabled: false,
      onClick: onOpenSideChat,
    },
    {
      key: 'browser',
      label: t('workspace.overview.browser'),
      meta: t('workspace.overview.browserDescription'),
      icon: <Globe2 size={15} />,
      disabled: false,
      onClick: () => onOpenBrowser(),
    },
  ];

  return (
    <section className="desktop-workspace-overview" aria-label={t('workspace.overview.label')}>
      <div className="desktop-workspace-overview__actions">
        {actions.map((action) => (
          <button
            className="desktop-workspace-overview__action"
            disabled={action.disabled}
            key={action.key}
            type="button"
            onClick={action.onClick}
          >
            <span className="desktop-workspace-overview__action-icon">{action.icon}</span>
            <span className="desktop-workspace-overview__action-body">
              <span>{action.label}</span>
              <em>{action.meta}</em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function WorkspaceFilePreviewContent({
  file,
}: {
  file: WorkspaceFileRead;
}) {
  const { t } = useI18n();
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
  return <CodeEditorPreview file={file} t={t} />;
}

function CodeEditorPreview({
  file,
  t,
}: {
  file: WorkspaceFileRead;
  t: Translate;
}) {
  const content = useMemo(() => file.content.replace(/\r\n/g, '\n'), [file.content]);
  const language = fileLanguage(file.path);
  const lines = useMemo(() => content.split('\n'), [content]);
  const highlightedLines = useMemo(() => highlightedCodeLinesHtml(content, language), [content, language]);
  return (
    <div className="desktop-code-editor" role="region" aria-label={file.path} data-language={language || 'text'}>
      {lines.map((line, index) => {
        const highlighted = highlightedLines[index];
        return (
          <div
            className="desktop-code-line desktop-code-line--contextual"
            data-workspace-file-line={index + 1}
            key={`${file.path}:${index}`}
          >
            <span className="desktop-code-line__number">{index + 1}</span>
            {highlighted !== undefined ? (
              <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
            ) : (
              <code>{line || ' '}</code>
            )}
          </div>
        );
      })}
      {file.truncated ? <div className="desktop-code-truncated">{t('workspace.files.previewTruncated')}</div> : null}
    </div>
  );
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
