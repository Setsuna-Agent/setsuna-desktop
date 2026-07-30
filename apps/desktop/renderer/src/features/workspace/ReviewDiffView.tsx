import { Code2, PanelRightOpen } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { fileLanguage } from './codeHighlight.js';
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
import {
  estimatedSplitDiffRowHeight,
  estimatedUnifiedDiffLineHeight,
  highlightedReviewDiffLines,
  reviewWholeFileChangeType,
  splitReviewDiffRows,
} from './reviewDiffModel.js';
import type {
  DesktopReviewDiffLayout,
  HighlightedReviewDiffLine,
  ReviewFileExpansionRequest,
  ReviewPathContext,
} from './review-types.js';
import { ReviewChangeCounts } from './ReviewChangeCounts.js';
import { ReviewDiffContent } from './ReviewDiffContent.js';
import {
  WorkspaceFileContextMenu,
  type WorkspaceFileContextTarget,
} from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

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
  const files = summary?.files ?? [];
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
  const language = fileLanguage(file.path);
  const wholeFileChange = useMemo(
    () => (expanded ? reviewWholeFileChangeType(visibleLines) : null),
    [expanded, visibleLines],
  );
  const splitWholeFileChange = diffLayout === 'split'
    ? wholeFileChange
    : null;
  const highlightedVisibleLines = useMemo<HighlightedReviewDiffLine[]>(
    () => {
      // 折叠文件保持低开销：大型审查不应预先高亮每个隐藏文件。
      if (!expanded) return [];
      const highlightedLines = highlightedReviewDiffLines(
        visibleLines,
        language,
      );
      return visibleLines.map((line, index) => ({
        highlighted: highlightedLines[index],
        key: `${file.path}:${line.lineNumber}:${index}`,
        line,
      }));
    },
    [expanded, file.path, language, visibleLines],
  );
  const splitRows = useMemo(
    () => (
      expanded && diffLayout === 'split'
        ? splitReviewDiffRows(highlightedVisibleLines)
        : []
    ),
    [diffLayout, expanded, highlightedVisibleLines],
  );
  const diffRowEstimate = useCallback(
    (index: number) => (
      diffLayout === 'split' && !splitWholeFileChange
        ? estimatedSplitDiffRowHeight(splitRows[index])
        : estimatedUnifiedDiffLineHeight(highlightedVisibleLines[index])
    ),
    [
      diffLayout,
      highlightedVisibleLines,
      splitRows,
      splitWholeFileChange,
    ],
  );

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
        block: 'center',
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

  const openDiffLineContextMenu = (
    event: MouseEvent,
    line: DesktopDiffFile['lines'][number],
    preferredLine?: number,
  ) => {
    if (!workspaceFilePath) return;
    event.preventDefault();
    event.stopPropagation();
    setLineContextMenu({
      filePath: workspaceFilePath,
      line: preferredLine ?? line.newLine ?? line.oldLine,
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
            <WorkspaceFileIcon path={file.path} type="file" />
            <ReviewFilePath path={file.path} />
            <ReviewChangeCounts
              additions={file.additions}
              deletions={file.deletions}
            />
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
          <ReviewDiffContent
            className={[
              'desktop-review-diff',
              `desktop-review-diff--${diffLayout}`,
              lineWrap ? 'desktop-review-diff--wrap' : '',
              splitWholeFileChange
                ? 'desktop-review-diff--single-sided'
                : '',
              splitWholeFileChange
                ? `desktop-review-diff--single-sided-${splitWholeFileChange}`
                : '',
            ].filter(Boolean).join(' ')}
            diffLayout={diffLayout}
            highlightedLines={highlightedVisibleLines}
            language={language}
            lineWrap={lineWrap}
            rowEstimate={diffRowEstimate}
            splitRows={splitRows}
            wholeFileChange={splitWholeFileChange}
            onLineContextMenu={openDiffLineContextMenu}
          >
            {file.truncated ? (
              <div className="desktop-review-truncated">
                {t('workspace.review.file.truncated')}
              </div>
            ) : null}
          </ReviewDiffContent>
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

export {
  highlightedReviewDiffLines,
  reviewVirtualRange,
  reviewWholeFileChangeType,
  shouldWrapReviewDiffLine,
} from './reviewDiffModel.js';
