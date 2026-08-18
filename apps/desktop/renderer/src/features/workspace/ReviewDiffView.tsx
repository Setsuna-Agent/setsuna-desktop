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
import { ActionTooltip, IconButton } from '../../shared/ui/primitives.js';
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
import { WorkspaceFileIcon, WorkspaceFilePath } from './WorkspaceFileIcon.js';
import {
  reviewFindingKey,
  reviewPathsMatch,
  resolveReviewFile,
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
  onOpenProjectFile: (filePath: string, line?: number) => void;
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
  // The focus request carries provider/workspace coordinates while diff files
  // are keyed by repository paths. Resolve before navigation so target keys
  // match the registered file cards even when git root ≠ workspace root.
  const resolvedFocusRequest = useMemo(() => {
    if (!focusRequest?.path) return focusRequest ?? null;
    const resolvedPath = resolveReviewFile(summary, focusRequest.path)?.path;
    return resolvedPath && resolvedPath !== focusRequest.path
      ? { ...focusRequest, path: resolvedPath }
      : focusRequest;
  }, [focusRequest, summary]);
  const { getDiffTargetRegistration, getTargetRef } = useReviewNavigation({
    findingTarget: focusedFindingTarget,
    focusRequest: resolvedFocusRequest,
  });
  const unanchoredFindingTarget = focusedFindingTarget
    && (!focusedFindingTarget.file || !focusedFindingTarget.anchor)
    ? focusedFindingTarget
    : null;
  const openReviewFile = useCallback((filePath: string, line?: number) => {
    // Provider output can be workspace-relative while git paths are rooted at
    // the repository. Resolve through the displayed diff before translating
    // the path into the active project's coordinate space.
    const resolvedFilePath = resolveReviewFile(summary, filePath)?.path ?? filePath;
    const targetPath = reviewWorkspaceFilePath(resolvedFilePath, pathContext);
    if (!targetPath) return;
    if (workspaceApp) {
      onExternalOpenFile(targetPath, line);
      return;
    }
    onOpenProjectFile(targetPath, line);
  }, [onExternalOpenFile, onOpenProjectFile, pathContext, summary, workspaceApp]);
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
  onOpenProjectFile: (filePath: string, line?: number) => void;
  onOpenWorkspaceFile: (filePath: string, line?: number) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const imagePreview = file.contentKind === 'image';
  const unsupportedPreview = file.contentKind === 'binary';
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
        && target.file === file
    )),
    [file, findingTargets],
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
    if (!expanded || imagePreview || unsupportedPreview) return '';
    // A raw patch cannot be sliced safely. Rebuild valid hunks from the retained
    // lines so truncated previews remain parseable and syntax-highlighted.
    if (file.truncated) return codeDiffLinesToPatch(file);
    return file.patch ?? codeDiffLinesToPatch(file);
  }, [expanded, file, imagePreview, unsupportedPreview]);

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
  const openPanelLabel = canOpenFile
    ? t('workspace.review.file.openPanel')
    : t('workspace.review.file.outsideProject');
  const openInAppLabel = !canOpenFile
    ? t('workspace.review.file.outsideProject')
    : workspaceApp
      ? t('workspace.review.file.openInApp', { app: workspaceApp.label })
      : t('workspace.review.file.noApp');

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
              <WorkspaceFilePath path={file.path} />
              {!file.contentKind ? (
                <ReviewChangeCounts
                  additions={file.additions}
                  deletions={file.deletions}
                />
              ) : null}
            </span>
          </button>
          <div className="desktop-review-file-card__meta">
            <ActionTooltip title={openPanelLabel}>
              <IconButton
                disabled={!canOpenFile}
                label={openPanelLabel}
                title=""
                variant="ghost"
                onClick={() => {
                  if (workspaceFilePath) {
                    onOpenProjectFile(workspaceFilePath);
                  }
                }}
              >
                <PanelRightOpen size={13} />
              </IconButton>
            </ActionTooltip>
            <ActionTooltip title={openInAppLabel}>
              <IconButton
                disabled={!workspaceApp || !canOpenFile}
                label={openInAppLabel}
                title=""
                variant="ghost"
                onClick={() => {
                  if (workspaceFilePath) {
                    onExternalOpenFile(workspaceFilePath);
                  }
                }}
              >
                <Code2 size={13} />
              </IconButton>
            </ActionTooltip>
          </div>
        </header>
        {imagePreview ? (
          <ReviewImageDiffPreview
            diffLayout={diffLayout}
            file={file}
            filePath={workspaceFilePath}
            pathContext={pathContext}
            visible={expanded}
          />
        ) : unsupportedPreview && expanded ? (
          <div className="desktop-review-unsupported-preview">
            <strong>{t('workspace.review.file.unsupportedTitle')}</strong>
            <span>{t('workspace.review.file.unsupportedDescription')}</span>
          </div>
        ) : expanded && visibleLines.length ? (
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
        ) : expanded && file.truncated ? (
          <div className="desktop-review-truncated">
            {t('workspace.review.file.truncated')}
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

type ReviewImagePreviewSide = 'before' | 'after';

function ReviewImageDiffPreview({
  diffLayout,
  file,
  filePath,
  pathContext,
  visible,
}: {
  diffLayout: DesktopReviewDiffLayout;
  file: DesktopDiffFile;
  filePath: string | null;
  pathContext: ReviewPathContext;
  visible: boolean;
}) {
  const { t } = useI18n();
  if (!visible) return null;
  const sides = reviewImagePreviewSides(file.action, diffLayout, pathContext.source);
  if (!sides.length) {
    return (
      <div className="desktop-review-image-preview__status is-error" role="status">
        {t('workspace.review.file.imageUnavailable')}
      </div>
    );
  }
  const split = diffLayout === 'split';
  return (
    <div className={`desktop-review-image-preview ${split ? 'is-split' : ''}`}>
      {sides.map((side) => {
        const sideFilePath = side === 'before' && file.previousPath
          ? reviewWorkspaceFilePath(file.previousPath, pathContext)
          : filePath;
        const label = t(side === 'before'
          ? 'workspace.review.file.imageBefore'
          : 'workspace.review.file.imageAfter');
        return (
          <ReviewImageVersion
            filePath={sideFilePath}
            fileVersion={file}
            key={`${pathContext.source}:${pathContext.baseRef ?? ''}:${side}:${sideFilePath ?? file.path}`}
            label={label}
            path={side === 'before' ? file.previousPath ?? file.path : file.path}
            pathContext={pathContext}
            side={side}
          />
        );
      })}
    </div>
  );
}

function ReviewImageVersion({
  filePath,
  fileVersion,
  label,
  path,
  pathContext,
  side,
}: {
  filePath: string | null;
  fileVersion: DesktopDiffFile;
  label: string;
  path: string;
  pathContext: ReviewPathContext;
  side: ReviewImagePreviewSide;
}) {
  const { t } = useI18n();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setPreviewUrl(null);
    setPreviewError(null);
    if (!pathContext.workspaceRoot || !filePath) {
      setPreviewError(t('workspace.review.file.imageUnavailable'));
      return undefined;
    }
    const createPreview = window.setsunaDesktop?.desktopReview?.createImagePreview;
    const releasePreview = window.setsunaDesktop?.desktopReview?.releaseImagePreview;
    if (!createPreview) {
      setPreviewError(t('workspace.review.file.imageUnavailable'));
      return undefined;
    }
    let cancelled = false;
    let previewId: string | null = null;
    void createPreview(pathContext.workspaceRoot, {
      baseRef: pathContext.baseRef,
      filePath,
      side,
      source: pathContext.source,
    })
      .then((result) => {
        if (result.ok) {
          if (cancelled) {
            void releasePreview?.(result.previewId).catch(() => undefined);
            return;
          }
          previewId = result.previewId;
          setPreviewUrl(result.url);
        } else {
          setPreviewError(t('workspace.review.file.imageUnavailable'));
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError(t('workspace.review.file.imageUnavailable'));
      });
    return () => {
      cancelled = true;
      if (previewId) void releasePreview?.(previewId).catch(() => undefined);
    };
  }, [
    filePath,
    fileVersion,
    pathContext.baseRef,
    pathContext.source,
    pathContext.workspaceRoot,
    side,
    t,
  ]);

  return (
    <div className="desktop-review-image-preview__version">
      <div className="desktop-review-image-preview__canvas">
        {previewUrl ? (
          <img
            alt={t('workspace.review.file.imageVersionAlt', { label, path })}
            draggable={false}
            src={previewUrl}
          />
        ) : (
          <div className={`desktop-review-image-preview__status ${previewError ? 'is-error' : ''}`} role="status">
            {previewError ?? t('workspace.review.file.imageLoading')}
          </div>
        )}
      </div>
    </div>
  );
}

function reviewImagePreviewSides(
  action: string,
  diffLayout: DesktopReviewDiffLayout,
  source: ReviewPathContext['source'],
): ReviewImagePreviewSide[] {
  const beforeAvailable = source !== 'latest' && action !== 'Created';
  const afterAvailable = action !== 'Deleted';
  if (diffLayout === 'split') {
    return [
      ...(beforeAvailable ? ['before' as const] : []),
      ...(afterAvailable ? ['after' as const] : []),
    ];
  }
  if (afterAvailable) return ['after'];
  return beforeAvailable ? ['before'] : [];
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
