import { WorkspaceOverviewPanel } from './WorkspaceOverviewPanel.js';
import { FileTreeToggle, FileTreeSurface, FileTreeRow, ResizeHandle, TextField, Button } from '@setsuna-desktop/renderer-ui';

import {
  WORKSPACE_TEXT_FILE_EDIT_MAX_BYTES,
  getDocumentPreviewFormat,
  workspaceFileKey,
  workspaceTarget,
  type WorkspaceEntry,
  type WorkspaceEntryCreateInput,
  type WorkspaceEntrySearchItem,
  type WorkspaceFileRead,
  type WorkspaceProject,
  type RuntimeReviewFinding,
} from '@setsuna-desktop/contracts';
import type { DesktopReviewSource } from '@setsuna-desktop/feature-review/contracts';
import { Folders, Search } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GitChangesFeaturePanel, ReviewFeaturePanel } from '../../composition/review-feature-panel-adapter.js';
import { CodeFileView } from '../../shared/code/PierreCode.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { EmptyState } from '../../shared/ui/primitives.js';
import {
  useWorkspaceCodeViewSurface,
  workspaceCodeViewLayout,
  workspaceCodeViewUnsafeCSS,
} from './editor/useWorkspaceCodeViewSurface.js';
import { WorkspaceCodeViewScrollbar } from './editor/WorkspaceCodeViewScrollbar.js';
import type { WorkspaceFileTreeState } from './hooks/useWorkspaceFileTree.js';
import { useWorkspaceEntryDrag } from './hooks/useWorkspaceEntryDrag.js';
import { useWorkspaceImageCopy } from './hooks/useWorkspaceImageCopy.js';
import { isWorkspaceImagePath } from './media/workspaceImageClipboard.js';
import { workspaceEntryParent } from './workspaceEntryPaths.js';
import { FILE_TREE_MIN_WIDTH, FILE_TREE_MAX_WIDTH, normalizeProjectTreePath } from './workspaceFileTree.js';
import type { WorkspaceFileDraftState } from './hooks/useWorkspaceFileDraft.js';
import { useWorkspaceFileViewMode, type WorkspaceFileViewMode } from './hooks/useWorkspaceFileViewMode.js';
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
import { WorkspaceDocumentPreview } from './documents/WorkspaceDocumentPreview.js';
import {
  workspaceDirectoryMentionEntry,
  workspaceFileMentionEntry,
} from './workspaceFileMention.js';

const LazyEditableWorkspaceFile = lazy(async () => {
  const module = await import('./editor/EditableWorkspaceFile.js');
  return { default: module.EditableWorkspaceFile };
});

const LazyWorkspaceMarkdownPreview = lazy(async () => {
  const module = await import('./markdown/WorkspaceMarkdownPreview.js');
  return { default: module.WorkspaceMarkdownPreview };
});

const LazyWorkspaceVideoPreview = lazy(() => import('./media/WorkspaceVideoPreview.js'));

export function WorkspacePanel({
  activePanel,
  placement = 'side',
  activeProject,
  entryOperationPending,
  sourceRootPicker,
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
}: {
  activePanel: DesktopPanelTab;
  placement?: DesktopPanelSlot;
  activeProject?: WorkspaceProject;
  sourceRootPicker?: ReactNode;
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
  onOpenBrowser: (url?: string) => void;
  onOpenConversationDebug?: () => void;
  onOpenReviewPanel?: () => void;
  onOpenChangesPanel?: () => void;
  onOpenSideChat: () => void;
  onOpenTerminalPanel: () => void;
  onReviewRefresh: () => void;
  onReviewBaseRefChange: (baseRef: string) => void;
  onReviewSourceChange: (source: DesktopReviewSource) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const copyImage = useWorkspaceImageCopy();
  const {
    tree, expandedPaths, loadingDirectoryPaths, treeError, treeQuery, treeSearching,
    treeTruncated, treeVisible, treeWidth, query, toggleDirectory, updateTreeQuery,
    toggleTreeVisible, setTreeWidth, fileListRef, onFileListScroll,
  } = fileTree;
  const treeLayoutDependency = useMemo(() => ({ tree, expandedPaths, query }), [tree, expandedPaths, query]);
  const [contextMenu, setContextMenu] = useState<WorkspaceFileContextTarget | null>(null);
  const [entryDialog, setEntryDialog] = useState<WorkspaceEntryDialogRequest | null>(null);
  const entryDrag = useWorkspaceEntryDrag({
    projectId: activeProject?.id,
    workspaceRoot: activeProject?.path,
    disabled: entryOperationPending || treeSearching || !activeProject,
    entries: fileTree.treeEntries,
    moveEntry: onMoveEntry,
    onMoved: fileTree.applyEntryChange,
  });
  const showsFileExplorer = activePanel.type === 'files' || activePanel.type === 'file';
  const revealedFileRef = useRef<HTMLButtonElement>(null);
  const revealTarget = fileTree.revealTarget;
  useEffect(() => {
    if (!treeVisible || !revealTarget || activePanel.type !== 'file' || activePanel.filePath !== revealTarget.path) return;
    revealedFileRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    revealedFileRef.current?.focus({ preventScroll: true });
  }, [activePanel.filePath, activePanel.type, revealTarget, treeVisible]);
  // Selection can change before its file read settles. Never render another tab's document or draft here.
  const filePreview = workspaceFilePreview && activePanel.type === 'file' && activePanel.filePath === workspaceFilePreview.path
    && activeProject?.id === workspaceFilePreview.projectId && activePanel.rootId === workspaceFilePreview.rootId ? workspaceFilePreview : null;
  const fileView = useWorkspaceFileViewMode(filePreview, fileFocusRequest);
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
        <FileTreeRow
          ref={node.path === revealTarget?.path ? revealedFileRef : undefined}
          className={`desktop-file-row ${entryDrag.draggingPath === node.path ? 'is-dragging' : ''}`}
          depth={level}
          animateEntry={level > 0}
          expanded={directory ? expanded : undefined}
          selected={selected}
          label={node.name}
          icon={directory ? undefined : <WorkspaceFileIcon path={node.path} type={node.type} />}
          extra={loading ? <span className="sd-spinner" aria-hidden="true" /> : undefined}
          aria-busy={loading || undefined}
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
            setContextMenu({ filePath: node.path, type: node.type, x: event.clientX, y: event.clientY,
              image: !directory && activeProject && isWorkspaceImagePath(node.path)
                ? { filePath: node.path, workspace: workspaceTarget(activeProject.id, activePanel.rootId) } : undefined,
            });
          }}
          onClick={() => (directory ? toggleDirectory(node.path) : onOpenEntry(node.entry))}
        />
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
        {fileView.canPreview ? (
          <span className="sd-markdown-view-toggle desktop-editor__view-toggle" role="group" aria-label={t('workspace.files.previewMode')}>
            {(['source', 'preview'] as const).map((mode) => (
              <Button key={mode} variant="ghost" type="button" aria-pressed={fileView.mode === mode}
                className="sd-markdown-view-option" onClick={() => fileView.setMode(mode)}>
                {t(mode === 'source' ? 'workspace.files.viewSource' : 'workspace.files.viewPreview')}
              </Button>
            ))}
          </span>
        ) : null}
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
        sourceRootPicker={sourceRootPicker}
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
        sourceRootPicker={sourceRootPicker}
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
            image: filePreview.preview?.kind === 'image'
              ? { filePath: filePreview.path, dataUrl: `data:${filePreview.preview.mimeType};base64,${filePreview.preview.base64}` } : undefined,
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
            workspaceRoot={activeProject?.path}
            fileDraft={fileDraft}
            fileFocusRequest={fileFocusRequest}
            viewMode={fileView.mode}
            onOpenFile={onOpenProjectFile}
          />
        ) : (
          <div className="desktop-editor__empty">
            <Folders size={28} strokeWidth={1.75} aria-hidden="true" />
            <EmptyState title={t('workspace.files.noneOpen')} body={t('workspace.files.noneOpenDescription')} />
          </div>
        )}
      </section>
    );

  return (
    <>
      <aside className={`desktop-workspace-panel${placement === 'bottom' ? ' desktop-workspace-panel--bottom-embedded' : ''}`}>
        <div
          className={`desktop-workspace-body ${showsFileExplorer ? 'desktop-workspace-body--file-explorer' : 'desktop-workspace-body--single'}`}
          style={showsFileExplorer ? ({
            '--desktop-file-tree-width': `${treeWidth}px`,
            '--desktop-file-tree-track-width': `${treeVisible ? treeWidth : 0}px`,
          } as CSSProperties) : undefined}
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
                <div className="desktop-file-tree__controls">
                  {sourceRootPicker}
                  <TextField
                    appearance="search"
                    leadingIcon={<Search size={13} />}
                    aria-label={t('workspace.files.filter')}
                    value={treeQuery}
                    disabled={entryOperationPending}
                    onChange={(event) => updateTreeQuery(event.target.value)}
                    placeholder={t('workspace.files.filter')}
                  />
                </div>
                {activeProject ? (
                  <FileTreeSurface className={`desktop-file-list ${entryDrag.dropPath === '' ? 'is-drop-target' : ''}`} ref={fileListRef} onScroll={onFileListScroll}
                    layoutDependency={treeLayoutDependency}
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
                  </FileTreeSurface>
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
        onCopyImage={copyImage}
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

export function WorkspaceFilePreviewContent({
  file,
  workspaceRoot,
  fileDraft,
  fileFocusRequest,
  viewMode = 'source',
  onOpenFile,
}: {
  file: WorkspaceFileRead;
  workspaceRoot?: string;
  fileDraft?: WorkspaceFileDraftState;
  fileFocusRequest?: WorkspaceFileFocusRequest | null;
  viewMode?: WorkspaceFileViewMode;
  onOpenFile?: (path: string, line?: number) => void;
}) {
  const { t } = useI18n();
  const activeFocusRequest = fileFocusRequest?.path === file.path
    ? fileFocusRequest
    : undefined;
  const documentFormat = getDocumentPreviewFormat(file.path);
  if (documentFormat && documentFormat !== 'csv') {
    return <WorkspaceDocumentPreview file={file} workspaceRoot={workspaceRoot} />;
  }
  if (file.preview?.kind === 'video') {
    return <Suspense fallback={<div role="status">{t('workspace.files.loadingPreview')}</div>}>
      <LazyWorkspaceVideoPreview file={file} workspaceRoot={workspaceRoot} />
    </Suspense>;
  }
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
  const previewing = viewMode === 'preview';
  const source = fileDraft?.editing ? (
    <Suspense fallback={(
      <CodeEditorPreview file={file} fileFocusRequest={activeFocusRequest} />
    )}>
      <LazyEditableWorkspaceFile
        key={workspaceFileKey(file)}
        content={fileDraft.content}
        file={file}
        fileFocusRequest={activeFocusRequest}
        active={!previewing}
        onChange={fileDraft.updateContent}
        onSave={fileDraft.save}
      />
    </Suspense>
  ) : <CodeEditorPreview file={file} fileFocusRequest={activeFocusRequest} />;
  return (
    <div className="desktop-file-document">
      {/* Keep the editor and its measured viewport alive, including undo and caret state. */}
      <div className="desktop-file-document__source" aria-hidden={previewing || undefined}
        style={{ visibility: previewing ? 'hidden' : undefined }}>
        {source}
      </div>
      {previewing ? (
        <Suspense fallback={<div className="desktop-markdown-preview" role="status">{t('workspace.files.loadingPreview')}</div>}>
          {documentFormat === 'csv' ? <div className="desktop-file-document__preview">
            <WorkspaceDocumentPreview file={file} workspaceRoot={workspaceRoot}
              content={fileDraft?.editing ? fileDraft.content : !file.truncated ? file.content : undefined} />
          </div> : <LazyWorkspaceMarkdownPreview key={workspaceFileKey(file)} file={file}
            content={fileDraft?.editing ? fileDraft.content : file.content} onOpenFile={onOpenFile} />}
        </Suspense>
      ) : null}
    </div>
  );
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
          cacheKey={`${workspaceFileKey(file)}:${file.revision ?? file.modifiedAt ?? file.size}`}
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
