import { FileTreeToggle, ResizeHandle, TextField, Button } from '@setsuna-desktop/renderer-ui';

import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  type WorkspaceEntry,
  type WorkspaceEntryCreateInput,
  type WorkspaceEntrySearchItem,
  type WorkspaceFileRead,
  type WorkspaceProject,
  type RuntimeReviewFinding,
} from '@setsuna-desktop/contracts';
import type { DesktopReviewSource } from '@setsuna-desktop/feature-review/contracts';
import { Bug, ChevronDown, FileDiff, FolderOpen, GitBranch, MessageSquare, Search, SquareTerminal } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { BrowserFeatureIcon } from '../../composition/BrowserWorkspaceFeatureBoundary.js';
import { GitChangesFeaturePanel, ReviewFeaturePanel } from '../../composition/review-feature-panel-adapter.js';
import { CodeFileView } from '../../shared/code/PierreCode.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import type { KeyboardShortcutCommandId } from '../../shared/shortcuts/keyboardShortcutCommands.js';
import { ShortcutHint } from '../../shared/ui/ShortcutTooltip.js';
import { EmptyState } from '../../shared/ui/primitives.js';
import {
  useWorkspaceCodeViewSurface,
  workspaceCodeViewLayout,
  workspaceCodeViewUnsafeCSS,
} from './editor/useWorkspaceCodeViewSurface.js';
import { WorkspaceCodeViewScrollbar } from './editor/WorkspaceCodeViewScrollbar.js';
import type { WorkspaceFileTreeState } from './hooks/useWorkspaceFileTree.js';
import { useWorkspaceEntryDrag } from './hooks/useWorkspaceEntryDrag.js';
import { workspaceEntryParent } from './workspaceEntryPaths.js';
import { FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH, normalizeProjectTreePath } from './workspaceFileTree.js';
import type { WorkspaceFileDraftState } from './hooks/useWorkspaceFileDraft.js';
import type {
  DesktopDiffSummary,
  DesktopPanelSlot,
  DesktopPanelTab,
  DesktopReviewFocusRequest,
  DesktopReviewState,
  DesktopWorkspaceApp,
  ProjectTreeNode,
  WorkspaceFileFocusRequest,
} from './model.js';
import {
  WorkspaceFileContextMenu,
  type WorkspaceFileContextTarget,
} from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon, WorkspaceFilePath } from './WorkspaceFileIcon.js';
import { WorkspaceEntryDialog, type WorkspaceEntryDialogRequest } from './WorkspaceEntryDialog.js';
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
  entryOperationPending,
  fileDraft,
  fileTree,
  fileFocusRequest,
  filePreview: workspaceFilePreview,
  latestReviewSummary,
  latestReviewFindings,
  reviewError,
  reviewFocusRequest,
  reviewLoading,
  reviewState,
  selectedWorkspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onCreateEntry,
  onRenameEntry,
  onMoveEntry,
  onDeleteEntry,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenEntry,
  onOpenProjectFile,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenReviewPanel,
  onOpenChangesPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
  onReviewRefresh,
  onReviewBaseRefChange,
  onReviewSourceChange,
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
  entryOperationPending: boolean;
  fileDraft: WorkspaceFileDraftState;
  fileTree: WorkspaceFileTreeState;
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
  onAddFileToConversation: (entry: WorkspaceEntrySearchItem) => void;
  onCopyFilePath: (filePath: string) => void;
  onCreateEntry: (input: WorkspaceEntryCreateInput) => Promise<WorkspaceEntry | null>;
  onRenameEntry: (entryPath: string, name: string) => Promise<WorkspaceEntry | null>;
  onMoveEntry: (entryPath: string, parentPath: string) => Promise<WorkspaceEntry | null>;
  onDeleteEntry: (entryPath: string) => Promise<boolean>;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onOpenEntry: (entry: WorkspaceEntry) => void;
  onOpenProjectFile: (filePath: string, line?: number) => void;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenChangesPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
  onReviewRefresh: () => void;
  onReviewBaseRefChange: (baseRef: string) => void;
  onReviewSourceChange: (source: DesktopReviewSource) => void;
  onRevealFile: (filePath: string) => void;
  onResizeStep: (delta: number) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  resizeMax: number;
  resizeMin: number;
  resizeValue: number;
}) {
  const { t } = useI18n();
  const {
    tree, expandedPaths, loadingDirectoryPaths, treeError, treeQuery, treeSearching,
    treeTruncated, treeVisible, treeWidth, query, toggleDirectory, updateTreeQuery,
    toggleTreeVisible, setTreeWidth, fileListRef, onFileListScroll,
  } = fileTree;
  const [contextMenu, setContextMenu] = useState<WorkspaceFileContextTarget | null>(null);
  const [entryDialog, setEntryDialog] = useState<WorkspaceEntryDialogRequest | null>(null);
  const entryDrag = useWorkspaceEntryDrag({
    projectId: activeProject?.id,
    disabled: entryOperationPending || treeSearching || !activeProject,
    entries: fileTree.treeEntries,
    moveEntry: onMoveEntry,
    onMoved: fileTree.applyEntryChange,
  });
  const showsFileExplorer = activePanel.type === 'files' || activePanel.type === 'file';
  // Selection can change before its file read settles. Never render another tab's document or draft here.
  const filePreview = workspaceFilePreview && activePanel.type === 'file' && activePanel.filePath === workspaceFilePreview.path
    && activeProject?.id === workspaceFilePreview.projectId ? workspaceFilePreview : null;
  const activeProjectLabel = activeProject?.name ?? t('workspace.files.noProject');
  const editorPath = activePanel.type === 'file' && activePanel.filePath
    ? `${activeProjectLabel}/${activePanel.filePath}` : activeProjectLabel;
  const addReviewFileToConversation = useCallback(
    (filePath: string) => onAddFileToConversation(workspaceFileMentionEntry(filePath)),
    [onAddFileToConversation],
  );

  const startTreeResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = treeWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setTreeWidth(startWidth + startX - moveEvent.clientX);
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
    const selected = activePanel.type === 'file' && activePanel.filePath === node.path;
    return (
      <div className={`desktop-file-tree-node ${directory && entryDrag.dropPath === node.path ? 'is-drop-target' : ''}`} key={node.path}>
        <div className={`desktop-file-row-shell ${selected ? 'is-active' : ''} ${entryDrag.draggingPath === node.path ? 'is-dragging' : ''}`} style={{ '--desktop-file-tree-indent': `${level * FILE_TREE_INDENT_STEP_PX}px` } as CSSProperties}>
          <Button variant="ghost"
            className={`desktop-file-row desktop-file-row--${node.type}`}
            type="button"
            title={node.path}
            disabled={entryOperationPending}
            draggable={!entryOperationPending && !treeSearching}
            onDragStart={(event) => entryDrag.startDrag(event, node.entry)}
            onDragEnd={entryDrag.endDrag}
            onDragOver={(event) => entryDrag.dragOver(event, directory ? node.path : workspaceEntryParent(node.path))}
            onDragLeave={entryDrag.clearDropTarget}
            onDrop={(event) => entryDrag.drop(event, directory ? node.path : workspaceEntryParent(node.path))}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu({ filePath: node.path, type: node.type, x: event.clientX, y: event.clientY });
            }}
            onClick={() => (directory ? toggleDirectory(node.path) : onOpenEntry(node.entry))}
          >
            {directory ? <ChevronDown className={expanded ? '' : 'is-collapsed'} size={12} /> : <span className="desktop-file-row__spacer" />}
            <WorkspaceFileIcon path={node.path} type={node.type} />
            <span className="desktop-file-row__name" title={node.path}>{node.name}</span>
            {loading ? <span className="desktop-file-row__loading">...</span> : null}
          </Button>
        </div>
        {directory && expanded ? node.children.map((child) => renderTreeNode(child, level + 1)) : null}
      </div>
    );
  };

  const fileEditorHeader = showsFileExplorer ? (
    <div className="desktop-editor__crumb">
      <span className="desktop-editor__crumb-path">
        <WorkspaceFilePath path={editorPath} />
      </span>
      <span className="desktop-editor__crumb-actions">
        <FileTreeToggle
          className="app-shell-icon-control"
          label={t(treeVisible ? 'workspace.files.collapseTree' : 'workspace.files.expandTree')}
          expanded={treeVisible}
          onToggle={toggleTreeVisible}
        />
      </span>
    </div>
  ) : null;

  const mainPanel =
    activePanel.type === 'overview' ? (
      <WorkspaceOverviewPanel
        activeProject={activeProject}
        isGitRepository={reviewState?.isGitRepository === true}
        onOpenFilesPanel={onOpenFilesPanel}
        onOpenBrowser={onOpenBrowser}
        onOpenConversationDebug={onOpenConversationDebug}
        onOpenReviewPanel={onOpenReviewPanel}
        onOpenChangesPanel={onOpenChangesPanel}
        onOpenSideChat={onOpenSideChat}
        onOpenTerminalPanel={onOpenTerminalPanel}
      />
    ) : (activePanel.type === 'changes' || activePanel.type === 'commit-message') && activeProject?.path ? (
      <GitChangesFeaturePanel
        editingMessage={activePanel.type === 'commit-message'}
        workspaceRoot={activeProject.path}
        reviewState={reviewState}
        reviewError={reviewError}
        reviewLoading={reviewLoading}
        onRefresh={onReviewRefresh}
        actions={{
          workspaceApp: selectedWorkspaceApp,
          workspaceApps,
          onAddFileToConversation: addReviewFileToConversation,
          onCopyFilePath,
          onExternalOpenFile,
          onOpenFileWithApp,
          onOpenProjectFile,
          onRevealFile,
        }}
      />
    ) : activePanel.type === 'review' ? (
      <ReviewFeaturePanel
        activeProject={activeProject}
        error={reviewError}
        focusRequest={reviewFocusRequest}
        latestSummary={latestReviewSummary}
        findings={latestReviewFindings}
        loading={reviewLoading}
        reviewState={reviewState}
        workspaceApp={selectedWorkspaceApp}
        workspaceApps={workspaceApps}
        onAddFileToConversation={addReviewFileToConversation}
        onCopyFilePath={onCopyFilePath}
        onExternalOpenFile={onExternalOpenFile}
        onOpenFileWithApp={onOpenFileWithApp}
        onOpenProjectFile={onOpenProjectFile}
        onRefresh={onReviewRefresh}
        onSelectBaseRef={onReviewBaseRefChange}
        onSourceChange={onReviewSourceChange}
        onRevealFile={onRevealFile}
      />
    ) : (
      <section
        className={`desktop-editor ${filePreview && fileDraft.errorMessage ? 'has-save-error' : ''}`}
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
        {filePreview && fileDraft.errorMessage ? (
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
              <div className="desktop-file-tree" aria-hidden={!treeVisible} aria-busy={entryOperationPending}>
                <ResizeHandle
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
                      setTreeWidth(treeWidth - 16);
                    } else if (event.key === 'ArrowRight') {
                      event.preventDefault();
                      setTreeWidth(treeWidth + 16);
                    }
                  }}
                />
                <div className="desktop-file-search">
                  <Search size={13} />
                  <TextField
                    value={treeQuery}
                    disabled={entryOperationPending}
                    onChange={(event) => updateTreeQuery(event.target.value)}
                    placeholder={t('workspace.files.filter')}
                  />
                </div>
                {activeProject ? (
                  <div className={`desktop-file-list ${entryDrag.dropPath === '' ? 'is-drop-target' : ''}`} ref={fileListRef} onScroll={onFileListScroll}
                    onDragOver={(event) => entryDrag.dragOver(event, '')}
                    onDragLeave={entryDrag.clearDropTarget}
                    onDrop={(event) => entryDrag.drop(event, '')}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({ filePath: '', type: 'directory', x: event.clientX, y: event.clientY });
                    }}
                  >
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
                  <EmptyState title={t('workspace.files.noProject')} body={t('workspace.files.addProject')} />
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
        entryActionsDisabled={treeSearching || entryOperationPending || !activeProject}
        onCreateEntry={(parentPath, type) => setEntryDialog({ mode: 'create', parentPath, type })}
        onRenameEntry={(entryPath, type) => setEntryDialog({ mode: 'rename', entry: {
          name: entryPath.split('/').pop() ?? entryPath, path: entryPath, type,
        } })}
        onDeleteEntry={async (entryPath) => {
          if (await onDeleteEntry(entryPath)) fileTree.applyEntryDeletion(entryPath);
        }}
        onOpenWithApp={onOpenFileWithApp}
        onReveal={onRevealFile}
      />
      {entryDialog ? (
        <WorkspaceEntryDialog request={entryDialog} onClose={() => setEntryDialog(null)}
          onSubmit={async (name) => {
            const entry = entryDialog.mode === 'create'
              ? await onCreateEntry({ parentPath: entryDialog.parentPath, type: entryDialog.type, name })
              : await onRenameEntry(entryDialog.entry.path, name);
            if (!entry) return;
            fileTree.applyEntryChange(entry, entryDialog.mode === 'rename' ? entryDialog.entry.path : undefined);
            setEntryDialog(null);
            if (entryDialog.mode === 'create' && entry.type === 'file') onOpenProjectFile(entry.path);
          }}
        />
      ) : null}
    </>
  );
}

export function WorkspaceOverviewPanel({
  activeProject,
  isGitRepository,
  onOpenFilesPanel,
  onOpenBrowser,
  onOpenConversationDebug,
  onOpenReviewPanel,
  onOpenChangesPanel,
  onOpenSideChat,
  onOpenTerminalPanel,
}: {
  activeProject?: WorkspaceProject;
  isGitRepository: boolean;
  onOpenFilesPanel: () => void;
  onOpenBrowser: () => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenChangesPanel?: () => void;
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
    shortcutCommandId?: KeyboardShortcutCommandId;
  }> = [
    {
      key: 'review',
      label: t('workspace.overview.review'),
      icon: <FileDiff size={15} />,
      disabled: !activeProject || !onOpenReviewPanel,
      onClick: () => onOpenReviewPanel?.(),
      shortcutCommandId: 'workspace.openReview',
    },
    ...(isGitRepository ? [{
      key: 'changes',
      label: t('workspace.panel.changes'),
      icon: <GitBranch size={15} />,
      disabled: !activeProject?.path || !onOpenChangesPanel,
      onClick: () => onOpenChangesPanel?.(),
      shortcutCommandId: 'workspace.openChanges' as const,
    }] : []),
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
      icon: <SquareTerminal size={15} />,
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
      icon: <BrowserFeatureIcon size={15} />,
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
          <Button variant="ghost"
            className="desktop-workspace-overview__action"
            data-workspace-overview-action={action.key}
            disabled={action.disabled}
            key={action.key}
            type="button"
            onClick={action.onClick}
          >
            <span className="desktop-workspace-overview__action-icon">{action.icon}</span>
            <span className="desktop-workspace-overview__action-label">{action.label}</span>
            {action.shortcutCommandId ? <ShortcutHint
              className="desktop-workspace-overview__action-shortcut"
              commandId={action.shortcutCommandId}
            /> : null}
          </Button>
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
          key={`${file.projectId}:${file.path}`}
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
