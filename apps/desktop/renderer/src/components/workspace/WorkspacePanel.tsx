import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Code2, FileText, Folder, FolderOpen, MessageSquare, Search, Terminal } from 'lucide-react';
import type { WorkspaceEntry, WorkspaceEntrySearchItem, WorkspaceFileRead, WorkspaceProject } from '@setsuna-desktop/contracts';
import { EmptyState } from '../primitives.js';
import { fileLanguage, highlightedCodeLinesHtml } from './codeHighlight.js';
import { desktopPanelTitle } from './PanelChrome.js';
import { DesktopReviewPanel } from './ReviewPanel.js';
import { TerminalPane } from './TerminalPane.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';
import type { DesktopDiffSummary, DesktopPanelTab, DesktopReviewFocusRequest, DesktopReviewLoadOptions, DesktopReviewState, DesktopTerminalSession, DesktopWorkspaceApp, ProjectTreeNode } from './model.js';

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
  terminalSession,
  onAddFileToConversation,
  onExternalOpenFile,
  onSearchProjectEntries,
  onOpenEntry,
  onOpenProjectFile,
  onOpenFilesPanel,
  onOpenReviewPanel,
  onOpenTerminalPanel,
  onGoRoot,
  onReviewRefresh,
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
  terminalSession: DesktopTerminalSession | null;
  onAddFileToConversation: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onSearchProjectEntries: (query?: string, parent?: string | null) => Promise<WorkspaceEntrySearchItem[]>;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string) => void;
  onOpenFilesPanel: () => void;
  onOpenReviewPanel?: () => void;
  onOpenTerminalPanel: () => void;
  onGoRoot: () => void;
  onReviewRefresh: (options?: DesktopReviewLoadOptions) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const [treeEntries, setTreeEntries] = useState<WorkspaceEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [loadedDirectoryPaths, setLoadedDirectoryPaths] = useState<Set<string>>(() => new Set(['']));
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<Set<string>>(() => new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeQuery, setTreeQuery] = useState('');
  const [treeSearching, setTreeSearching] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  const [treeWidth, setTreeWidth] = useState(248);
  const [contextMenu, setContextMenu] = useState<{ entry: WorkspaceEntry; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
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
      setTreeQuery('');
      return undefined;
    }
    if (!showsFileExplorer) {
      setTreeSearching(false);
      setTreeError(null);
      return undefined;
    }

    let cancelled = false;
    const parent = query ? undefined : '';
    setTreeSearching(true);
    setTreeError(null);
    onSearchProjectEntries(query, parent)
      .then((items) => {
        if (cancelled) return;
        setTreeEntries(items.map(searchItemToWorkspaceEntry));
        setLoadedDirectoryPaths(query ? new Set() : new Set(['']));
        setLoadingDirectoryPaths(new Set());
      })
      .catch((unknownError) => {
        if (cancelled) return;
        setTreeEntries([]);
        setTreeError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      })
      .finally(() => {
        if (!cancelled) setTreeSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProject, onSearchProjectEntries, query, showsFileExplorer]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [contextMenu]);

  const loadDirectory = async (pathValue: string) => {
    const normalizedPath = normalizeProjectTreePath(pathValue);
    if (!activeProject || query || loadedDirectoryPaths.has(normalizedPath) || loadingDirectoryPaths.has(normalizedPath)) return;
    setLoadingDirectoryPaths((current) => new Set(current).add(normalizedPath));
    setTreeError(null);
    try {
      const incoming = await onSearchProjectEntries('', normalizedPath);
      setTreeEntries((current) => mergeProjectEntries(current, incoming.map(searchItemToWorkspaceEntry)));
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
        <div className={`desktop-file-row-shell ${selected ? 'is-active' : ''}`} style={{ '--desktop-file-tree-indent': `${level * 14}px` } as CSSProperties}>
          <button
            className={`desktop-file-row desktop-file-row--${node.type}`}
            type="button"
            title={node.path}
            onContextMenu={!directory ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ entry: node.entry, x: event.clientX, y: event.clientY });
            } : undefined}
            onClick={() => (directory ? toggleDirectory(node.path) : onOpenEntry(node.entry))}
          >
            {directory ? <ChevronDown className={expanded ? '' : 'is-collapsed'} size={12} /> : <span className="desktop-file-row__spacer" />}
            <WorkspaceFileIcon expanded={expanded} path={node.path} type={node.type} />
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
        onOpenReviewPanel={onOpenReviewPanel}
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
        onExternalOpenFile={onExternalOpenFile}
        onOpenProjectFile={onOpenProjectFile}
        onRefresh={onReviewRefresh}
      />
    ) : activePanel.type === 'terminal' ? (
      <section className="desktop-workspace-terminal-panel" aria-label={desktopPanelTitle(activePanel)}>
        <TerminalPane session={terminalSession} />
      </section>
    ) : (
      <section className="desktop-editor">
        <div className="desktop-editor__crumb">
          <span className="desktop-editor__crumb-path">
            <span>{activeProject?.name ?? 'No project'}</span>
            {filePreview ? <span>{filePreview.path}</span> : null}
          </span>
          <button
            className={`desktop-editor__tree-toggle ${treeVisible ? 'is-active' : ''}`}
            type="button"
            aria-label={treeVisible ? '收起文件目录' : '展开文件目录'}
            aria-pressed={treeVisible}
            title={treeVisible ? '收起文件目录' : '展开文件目录'}
            onClick={() => setTreeVisible((current) => !current)}
          >
            {treeVisible ? <FolderOpen size={14} /> : <Folder size={14} />}
          </button>
        </div>
        {filePreview ? (
          <CodeEditorPreview file={filePreview} onOpenLine={selectedWorkspaceApp ? (line) => onExternalOpenFile(filePreview.path, line) : undefined} openApp={selectedWorkspaceApp} />
        ) : (
          <EmptyState title="未打开文件" body="从右侧文件树选择文件后会在这里预览。" />
        )}
      </section>
    );

  const contextMenuStyle = contextMenu
    ? {
        left: Math.min(contextMenu.x, Math.max(8, window.innerWidth - 208)),
        top: Math.min(contextMenu.y, Math.max(8, window.innerHeight - 96)),
      }
    : undefined;

  return (
    <>
      <aside className="desktop-workspace-panel">
        <button
          className="desktop-workspace-panel__resize-handle"
          type="button"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右侧面板宽度"
          aria-valuemin={resizeMin}
          aria-valuemax={resizeMax}
          aria-valuenow={resizeValue}
          title="拖拽调整右侧面板宽度"
          onPointerDown={onResizeStart}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              onResizeStep(16);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              onResizeStep(-16);
            }
          }}
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
                  aria-label="调整文件目录宽度"
                  aria-valuemin={FILE_TREE_MIN_WIDTH}
                  aria-valuemax={FILE_TREE_MAX_WIDTH}
                  aria-valuenow={treeWidth}
                  title="拖拽调整文件目录宽度"
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
                    placeholder="筛选文件..."
                  />
                </div>
                {activeProject ? (
                  <>
                    <div className="desktop-file-explorer__project">
                      <button type="button" onClick={onGoRoot}>
                        <ChevronDown size={13} />
                        <WorkspaceFileIcon expanded path={activeProject.name} type="directory" />
                        <span>{activeProject.name}</span>
                      </button>
                    </div>
                    <div className="desktop-file-list">
                      {treeSearching ? <div className="desktop-file-tree__empty">正在搜索...</div> : null}
                      {treeError ? <div className="desktop-file-tree__empty">{treeError}</div> : null}
                      {!treeSearching && !treeError && tree.length ? (
                        tree.map((node) => renderTreeNode(node))
                      ) : !treeSearching && !treeError && query ? (
                        <div className="desktop-file-tree__empty">暂无匹配文件</div>
                      ) : !treeSearching && !treeError ? (
                        <EmptyState title="暂无文件" />
                      ) : null}
                    </div>
                  </>
                ) : (
                  <EmptyState title="未选择项目" body="先在左侧添加项目目录。" />
                )}
              </div>
            </section>
          ) : null}
        </div>
      </aside>
      {contextMenu
        ? createPortal(
            <div className="desktop-file-context-menu" ref={contextMenuRef} role="menu" style={contextMenuStyle}>
              <button
                type="button"
                role="menuitem"
                disabled={!selectedWorkspaceApp}
                onClick={() => {
                  const filePath = contextMenu.entry.path;
                  setContextMenu(null);
                  onExternalOpenFile(filePath);
                }}
              >
                <Code2 size={14} />
                <span>{selectedWorkspaceApp ? `用 ${selectedWorkspaceApp.label} 打开` : '未检测到打开方式'}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const filePath = contextMenu.entry.path;
                  setContextMenu(null);
                  onAddFileToConversation(filePath);
                }}
              >
                <MessageSquare size={14} />
                <span>添加到对话</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function WorkspaceOverviewPanel({
  activeProject,
  latestReviewSummary,
  onOpenFilesPanel,
  onOpenReviewPanel,
  onOpenTerminalPanel,
}: {
  activeProject?: WorkspaceProject;
  latestReviewSummary: DesktopDiffSummary | null;
  onOpenFilesPanel: () => void;
  onOpenReviewPanel?: () => void;
  onOpenTerminalPanel: () => void;
}) {
  const reviewMeta = latestReviewSummary?.files.length
    ? `${latestReviewSummary.files.length} 个文件  +${latestReviewSummary.additions} -${latestReviewSummary.deletions}`
    : '查看代码变更';
  const actions = [
    {
      key: 'review',
      label: '审查',
      meta: reviewMeta,
      icon: <FileText size={15} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
    },
    {
      key: 'files',
      label: '文件目录',
      meta: activeProject?.name ?? '未选择项目',
      icon: <FolderOpen size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenFilesPanel,
    },
    {
      key: 'terminal',
      label: '终端',
      meta: activeProject?.path ? '项目 Shell' : '未选择项目',
      icon: <Terminal size={15} />,
      disabled: !activeProject?.path,
      onClick: onOpenTerminalPanel,
    },
  ];

  return (
    <section className="desktop-workspace-overview" aria-label="汇总目录">
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

function CodeEditorPreview({
  file,
  onOpenLine,
  openApp,
}: {
  file: WorkspaceFileRead;
  onOpenLine?: (line: number) => void;
  openApp?: DesktopWorkspaceApp | null;
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
          <button
            className={`desktop-code-line ${onOpenLine ? 'desktop-code-line--clickable' : ''}`}
            key={`${file.path}:${index}`}
            title={openApp ? `用 ${openApp.label} 打开第 ${index + 1} 行` : undefined}
            type="button"
            onClick={() => onOpenLine?.(index + 1)}
          >
            <span className="desktop-code-line__number">{index + 1}</span>
            {highlighted !== undefined ? (
              <code className={`language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />
            ) : (
              <code>{line || ' '}</code>
            )}
          </button>
        );
      })}
      {file.truncated ? <div className="desktop-code-truncated">文件过大，已截断预览。</div> : null}
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
