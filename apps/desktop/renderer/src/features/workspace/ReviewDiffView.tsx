import type { DiffLineAnnotation } from '@pierre/diffs/react';
import type { RuntimeReviewFinding } from '@setsuna-desktop/contracts';
import { Code2, PanelRightOpen } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefCallback,
} from 'react';
import { CodePatchView } from '../../shared/code/PierreCode.js';
import { codeDiffLinesToPatch } from '../../shared/code/diffPatch.js';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { MarkdownNavigationProvider } from '../chat/markdown/MarkdownNavigationProvider.js';
import { MarkdownRenderer } from '../chat/markdown/MarkdownRenderer.js';
import { WorkspaceFileLink } from '../chat/markdown/WorkspaceFileLink.js';
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
import {
  reviewFindingKey,
  reviewPathsMatch,
  resolveReviewFindingTarget,
  resolveReviewFindingTargets,
  type ReviewFindingTarget,
} from './review-findings.js';
import {
  reviewFileNavigationTargetKey,
  reviewFindingNavigationTargetKey,
  useReviewNavigation,
  type ReviewDiffNavigationRegistration,
} from './hooks/useReviewNavigation.js';

const reviewFilePathCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
});
const REVIEW_FOCUS_HIGHLIGHT_MS = 1_400;

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
  findings,
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
  findings: RuntimeReviewFinding[];
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
  const findingTargets = useMemo(
    () => resolveReviewFindingTargets(summary, findings),
    [findings, summary],
  );
  const focusedFindingTarget = useMemo(
    () => focusRequest?.finding
      ? resolveReviewFindingTarget(summary, focusRequest.finding)
      : null,
    [focusRequest?.finding, summary],
  );
  const { getDiffTargetRegistration, getTargetRef } = useReviewNavigation({
    findingTarget: focusedFindingTarget,
    focusRequest,
  });
  const unanchoredFindingTarget = focusedFindingTarget
    && (!focusedFindingTarget.file || !focusedFindingTarget.anchor)
    ? focusedFindingTarget
    : null;
  const openReviewFile = useCallback((filePath: string, line?: number) => {
    const targetPath = reviewWorkspaceFilePath(filePath, pathContext);
    if (!targetPath) return;
    if (workspaceApp) {
      onExternalOpenFile(targetPath, line);
      return;
    }
    onOpenProjectFile(targetPath);
  }, [onExternalOpenFile, onOpenProjectFile, pathContext, workspaceApp]);
  return (
    <section className="desktop-review-section">
      {unanchoredFindingTarget ? (
        <div className="desktop-review-unanchored-findings">
          <ReviewUnanchoredFindingCard
            focusRequest={focusRequest}
            onOpenWorkspaceFile={openReviewFile}
            target={unanchoredFindingTarget}
            targetRef={getTargetRef(
              reviewFindingNavigationTargetKey(unanchoredFindingTarget),
            )}
            workspaceRoot={pathContext.workspaceRoot}
          />
        </div>
      ) : null}
      {files.length ? (
        <div className="desktop-review-file-list">
          {files.map((file) => (
            <ReviewFileCard
              diffLayout={diffLayout}
              fileExpansionRequest={fileExpansionRequest}
              file={file}
              findingTargets={findingTargets}
              fileTargetRef={getTargetRef(
                reviewFileNavigationTargetKey(file.path),
              )}
              focusRequest={focusRequest}
              getDiffTargetRegistration={getDiffTargetRegistration}
              getNavigationTargetRef={getTargetRef}
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
              onOpenWorkspaceFile={openReviewFile}
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
  findingTargets,
  fileTargetRef,
  focusRequest,
  getDiffTargetRegistration,
  getNavigationTargetRef,
  lineWrap,
  pathContext,
  workspaceApp,
  workspaceApps,
  onAddFileToConversation,
  onCopyFilePath,
  onExternalOpenFile,
  onOpenFileWithApp,
  onOpenProjectFile,
  onOpenWorkspaceFile,
  onRevealFile,
}: {
  diffLayout: DesktopReviewDiffLayout;
  fileExpansionRequest: ReviewFileExpansionRequest;
  file: DesktopDiffFile;
  findingTargets: ReviewFindingTarget[];
  fileTargetRef: RefCallback<HTMLElement>;
  focusRequest?: DesktopReviewFocusRequest | null;
  getDiffTargetRegistration: (
    key: string,
  ) => ReviewDiffNavigationRegistration;
  getNavigationTargetRef: (key: string) => RefCallback<HTMLElement>;
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
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(fileExpansionRequest.expanded);
  const [lineContextMenu, setLineContextMenu] = useState<
    WorkspaceFileContextTarget | null
  >(null);
  const workspaceFilePath = reviewWorkspaceFilePath(file.path, pathContext);
  const canOpenFile = Boolean(workspaceFilePath);
  const focusedByRequest = Boolean(
    focusRequest
      && reviewPathsMatch(file.path, focusRequest.path),
  );
  const fileFocusHighlighted = useTransientReviewFocusHighlight(
    focusedByRequest && !focusRequest?.finding
      ? focusRequest?.version
      : undefined,
  );
  const focusedFindingKey = focusRequest?.finding
    ? reviewFindingKey(focusRequest.finding)
    : null;
  const visibleLines = file.lines;
  const fileFindingTargets = useMemo(
    () => findingTargets.filter((target) => (
      target.anchor && target.file
        && reviewPathsMatch(target.file.path, file.path)
    )),
    [file.path, findingTargets],
  );
  const lineAnnotations = useMemo<DiffLineAnnotation<ReactNode>[]>(() => (
    fileFindingTargets.flatMap((target) => {
      if (!target.anchor) return [];
      return [{
        ...target.anchor,
        metadata: (
          <ReviewFindingAnnotation
            finding={target.finding}
            focusVersion={focusedFindingKey === target.key
              ? focusRequest?.version
              : undefined}
            key={target.key}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
            targetRef={getNavigationTargetRef(
              reviewFindingNavigationTargetKey(target),
            )}
            workspaceRoot={pathContext.workspaceRoot}
          />
        ),
      }];
    })
  ), [
    fileFindingTargets,
    focusedFindingKey,
    focusRequest?.version,
    getNavigationTargetRef,
    onOpenWorkspaceFile,
    pathContext.workspaceRoot,
  ]);
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
    return undefined;
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
          fileFocusHighlighted ? 'is-focused' : '',
        ].filter(Boolean).join(' ')}
        data-review-file-path={normalizeReviewFocusPath(file.path) ?? file.path}
        ref={fileTargetRef}
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
              lineAnnotations={lineAnnotations}
              onPostRender={getDiffTargetRegistration(
                reviewFileNavigationTargetKey(file.path),
              )}
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

function ReviewUnanchoredFindingCard({
  focusRequest,
  onOpenWorkspaceFile,
  target,
  targetRef,
  workspaceRoot,
}: {
  focusRequest?: DesktopReviewFocusRequest | null;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  target: ReviewFindingTarget;
  targetRef: RefCallback<HTMLElement>;
  workspaceRoot?: string | null;
}) {
  return (
    <div className="desktop-review-unanchored-finding">
      <ReviewFindingAnnotation
        finding={target.finding}
        focusVersion={focusRequest?.version}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
        targetRef={targetRef}
        workspaceRoot={workspaceRoot}
      />
    </div>
  );
}

function ReviewFindingAnnotation({
  finding,
  focusVersion,
  onOpenWorkspaceFile,
  targetRef,
  workspaceRoot,
}: {
  finding: RuntimeReviewFinding;
  focusVersion?: number;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  targetRef: RefCallback<HTMLElement>;
  workspaceRoot?: string | null;
}) {
  const focusHighlighted = useTransientReviewFocusHighlight(focusVersion);
  const lineLabel = finding.endLine && finding.endLine !== finding.startLine
    ? `${finding.startLine}-${finding.endLine}`
    : String(finding.startLine);
  return (
    <MarkdownNavigationProvider
      workspaceRoot={workspaceRoot ?? undefined}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    >
      <article
        className={[
          'desktop-review-finding',
          focusHighlighted ? 'is-focused' : '',
        ].filter(Boolean).join(' ')}
        data-review-finding-line={finding.startLine}
        data-review-finding-path={
          normalizeReviewFocusPath(finding.path) ?? finding.path
        }
        ref={targetRef}
      >
        <header className="desktop-review-finding__header">
          <strong>[{finding.priority}] {finding.title}</strong>
          <WorkspaceFileLink
            className="desktop-review-finding__location"
            filePath={finding.path}
            href={`${finding.path}:${finding.startLine}`}
            line={finding.startLine}
            linkKind="workspace"
          >
            {reviewFilePathParts(finding.path).filename}:{lineLabel}
          </WorkspaceFileLink>
        </header>
        {finding.body ? (
          <div className="desktop-review-finding__body">
            <MarkdownRenderer content={finding.body} streaming={false} />
          </div>
        ) : null}
      </article>
    </MarkdownNavigationProvider>
  );
}

function useTransientReviewFocusHighlight(
  focusVersion: number | undefined,
): boolean {
  const [highlightVersion, setHighlightVersion] = useState<number | null>(null);
  useEffect(() => {
    if (focusVersion === undefined) return undefined;
    setHighlightVersion(focusVersion);
    const timer = window.setTimeout(() => {
      setHighlightVersion((current) => (
        current === focusVersion ? null : current
      ));
    }, REVIEW_FOCUS_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focusVersion]);
  return focusVersion !== undefined && highlightVersion === focusVersion;
}

function pierreLineNumberFromEvent(event: MouseEvent): number | undefined {
  for (const target of event.nativeEvent.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    const line = Number(target.dataset.line);
    if (Number.isSafeInteger(line) && line > 0) return line;
  }
  return undefined;
}
