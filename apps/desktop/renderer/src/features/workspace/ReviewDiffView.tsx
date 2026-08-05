import { Code2, PanelRightOpen } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { CodePatchView } from '../../shared/code/PierreCode.js';
import { codeDiffLinesToPatch } from '../../shared/code/diffPatch.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import type {
  DesktopDiffFile,
  DesktopDiffSummary,
  DesktopReviewFocusRequest,
  DesktopWorkspaceApp,
} from './model.js';
import {
  normalizeReviewFocusPath,
  reviewFilePathParts,
  reviewWorkspaceFilePath,
} from './review-paths.js';
import type { DesktopReviewDiffLayout, ReviewFileExpansionRequest, ReviewPathContext } from './review-types.js';
import { ReviewChangeCounts } from './ReviewChangeCounts.js';
import {
  WorkspaceFileContextMenu,
  type WorkspaceFileContextTarget,
} from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

const reviewFilePathCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});

function ReviewFilePath({ path }: { path: string }) {
  const { directory, filename } = reviewFilePathParts(path);
  // 目录通过 RTL 从左侧省略；分隔符独立渲染，避免双向文本把末尾 "/" 移到最前面。
  const directoryLabel = directory.slice(0, -1);
  return (
    <span className="desktop-review-file-card__path" title={path}>
      {directoryLabel ? (
        <span className="desktop-review-file-card__path-directory">
          {directoryLabel}
        </span>
      ) : null}
      {directory
        ? <span className="desktop-review-file-card__path-separator">/</span>
        : null}
      <span className="desktop-review-file-card__path-filename">
        {filename}
      </span>
    </span>
  );
}

export function ReviewSummarySection({
  diffLayout,
  emptyText,
  fileExpansionRequest,
  focusRequest,
  lineWrap,
  pathContext,
  summary,
  workspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenProjectFile,
  onRevealFile,
}: {
  diffLayout: DesktopReviewDiffLayout;
  emptyText: { title: string; description: string };
  fileExpansionRequest: ReviewFileExpansionRequest;
  focusRequest?: DesktopReviewFocusRequest | null;
  lineWrap: boolean;
  pathContext: ReviewPathContext;
  summary: DesktopDiffSummary | null;
  workspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddFileToConversation: (filePath: string) => void;
  onCopyFilePath: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (
    appId: string,
    filePath: string,
    line?: number,
  ) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const files = useMemo(() => [...(summary?.files ?? [])].sort((left, right) => (
    reviewFilePathCollator.compare(left.path, right.path)
  )), [summary?.files]);
  return (
    <section className="desktop-review-section">
      {files.length ? (
        <div className="desktop-review-file-list">
          {files.map((file) => (
            <ReviewFileCard
              diffLayout={diffLayout}
              fileExpansionRequest={fileExpansionRequest}
              file={file}
              focusRequest={focusRequest}
              key={file.path}
              lineWrap={lineWrap}
              pathContext={pathContext}
              workspaceApp={workspaceApp}
              workspaceApps={workspaceApps}
              onAddFileToConversation={onAddFileToConversation}
              onCopyFilePath={onCopyFilePath}
              onExternalOpenFile={onExternalOpenFile}
              onOpenFileWithApp={onOpenFileWithApp}
              onOpenProjectFile={onOpenProjectFile}
              onRevealFile={onRevealFile}
            />
          ))}
        </div>
      ) : (
        <div className="desktop-review-empty desktop-review-empty--panel">
          <strong>{emptyText.title}</strong>
          <span>{emptyText.description}</span>
        </div>
      )}
    </section>
  );
}

function ReviewFileCard({
  diffLayout,
  fileExpansionRequest,
  file,
  focusRequest,
  lineWrap,
  pathContext,
  workspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenProjectFile,
  onRevealFile,
}: {
  diffLayout: DesktopReviewDiffLayout;
  fileExpansionRequest: ReviewFileExpansionRequest;
  file: DesktopDiffFile;
  focusRequest?: DesktopReviewFocusRequest | null;
  lineWrap: boolean;
  pathContext: ReviewPathContext;
  workspaceApp?: DesktopWorkspaceApp | null;
  workspaceApps: DesktopWorkspaceApp[];
  onAddFileToConversation: (filePath: string) => void;
  onCopyFilePath: (filePath: string) => void;
  onExternalOpenFile: (filePath?: string | null, line?: number) => void;
  onOpenFileWithApp: (
    appId: string,
    filePath: string,
    line?: number,
  ) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(fileExpansionRequest.expanded);
  const [focusHighlightVersion, setFocusHighlightVersion] = useState<
    number | null
  >(null);
  const [lineContextMenu, setLineContextMenu] = useState<
    WorkspaceFileContextTarget | null
  >(null);
  const fileCardRef = useRef<HTMLElement | null>(null);
  const workspaceFilePath = reviewWorkspaceFilePath(file.path, pathContext);
  const canOpenFile = Boolean(workspaceFilePath);
  const focusedByRequest = Boolean(
    focusRequest
      && normalizeReviewFocusPath(file.path)
        === normalizeReviewFocusPath(focusRequest.path),
  );
  const visibleLines = file.lines;
  // Keep collapsed files cheap; Pierre/Shiki only receives a patch after expansion.
  const patch = useMemo(() => {
    if (!expanded) return '';
    // A raw patch cannot be sliced safely. Rebuild valid hunks from the retained
    // lines so truncated previews remain parseable and syntax-highlighted.
    if (file.truncated) return codeDiffLinesToPatch(file);
    return file.patch ?? codeDiffLinesToPatch(file);
  }, [expanded, file]);

  useEffect(() => {
    setExpanded(fileExpansionRequest.expanded);
  }, [fileExpansionRequest.expanded, fileExpansionRequest.version]);

  useEffect(() => {
    if (!focusedByRequest || focusRequest?.version === undefined) {
      return undefined;
    }
    setExpanded(true);
    setFocusHighlightVersion(focusRequest.version);
    const frame = window.requestAnimationFrame(() => {
      fileCardRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      });
    });
    const timer = window.setTimeout(() => {
      setFocusHighlightVersion((current) => (
        current === focusRequest.version ? null : current
      ));
    }, 1400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedByRequest, focusRequest?.version]);

  const openDiffLineContextMenu = (event: MouseEvent) => {
    if (!workspaceFilePath) return;
    event.preventDefault();
    event.stopPropagation();
    setLineContextMenu({
      filePath: workspaceFilePath,
      line: pierreLineNumberFromEvent(event),
      x: event.clientX,
      y: event.clientY,
    });
  };

  return (
    <>
      <article
        className={[
          'desktop-review-file-card',
          expanded ? 'is-open' : '',
          focusHighlightVersion === focusRequest?.version ? 'is-focused' : '',
        ].filter(Boolean).join(' ')}
        ref={fileCardRef}
      >
        <header
          className="desktop-review-file-card__summary"
          onContextMenu={(event) => {
            if (!workspaceFilePath) return;
            event.preventDefault();
            setLineContextMenu({
              filePath: workspaceFilePath,
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <button
            className="desktop-review-file-card__path-main"
            type="button"
            aria-expanded={expanded}
            aria-label={t(
              expanded
                ? 'workspace.review.file.collapse'
                : 'workspace.review.file.expand',
              { path: file.path, action: file.action },
            )}
            onClick={() => setExpanded((value) => !value)}
          >
            <WorkspaceFileIcon className="desktop-review-file-card__icon" path={file.path} type="file" />
            <span className="desktop-review-file-card__file-info">
              <ReviewFilePath path={file.path} />
              <ReviewChangeCounts
                additions={file.additions}
                deletions={file.deletions}
              />
            </span>
          </button>
          <div className="desktop-review-file-card__meta">
            <IconButton
              disabled={!canOpenFile}
              label={canOpenFile
                ? t('workspace.review.file.openPanel')
                : t('workspace.review.file.outsideProject')}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) {
                  onOpenProjectFile(workspaceFilePath);
                }
              }}
            >
              <PanelRightOpen size={13} />
            </IconButton>
            <IconButton
              disabled={!workspaceApp || !canOpenFile}
              label={!canOpenFile
                ? t('workspace.review.file.outsideProject')
                : workspaceApp
                  ? t('workspace.review.file.openInApp', {
                    app: workspaceApp.label,
                  })
                  : t('workspace.review.file.noApp')}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) {
                  onExternalOpenFile(workspaceFilePath);
                }
              }}
            >
              <Code2 size={13} />
            </IconButton>
          </div>
        </header>
        {expanded && visibleLines.length ? (
          <div
            className="desktop-review-diff-shell"
            onContextMenu={openDiffLineContextMenu}
          >
            <CodePatchView
              className={[
                'desktop-review-diff',
                `desktop-review-diff--${diffLayout}`,
                lineWrap ? 'desktop-review-diff--wrap' : '',
              ].filter(Boolean).join(' ')}
              layout={diffLayout}
              patch={patch}
              wrap={lineWrap}
            />
            {file.truncated ? (
              <div className="desktop-review-truncated">
                {t('workspace.review.file.truncated')}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
      <WorkspaceFileContextMenu
        selectedWorkspaceApp={workspaceApp ?? null}
        target={lineContextMenu}
        workspaceApps={workspaceApps}
        onAddToConversation={onAddFileToConversation}
        onClose={() => setLineContextMenu(null)}
        onCopyPath={onCopyFilePath}
        onOpenWithApp={onOpenFileWithApp}
        onReveal={onRevealFile}
      />
    </>
  );
}

function pierreLineNumberFromEvent(event: MouseEvent): number | undefined {
  for (const target of event.nativeEvent.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const line = Number(target.dataset.line);
    if (Number.isSafeInteger(line) && line > 0) return line;
  }
  return undefined;
}
