import { ChevronsUpDown, Code2, PanelRightOpen } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  type UIEvent,
} from 'react';
import { useI18n } from '../../shared/i18n/I18nProvider.js';
import { IconButton } from '../../shared/ui/primitives.js';
import { fileLanguage, highlightedCodeLinesHtml } from './codeHighlight.js';
import type { DesktopDiffFile, DesktopDiffSummary, DesktopReviewFocusRequest, DesktopWorkspaceApp } from './model.js';
import { normalizeReviewFocusPath, reviewFilePathParts, reviewWorkspaceFilePath } from './review-paths.js';
import type {
  DesktopReviewDiffLayout,
  HighlightedReviewDiffLine,
  ReviewFileExpansionRequest,
  ReviewPathContext,
  SplitReviewDiffRow,
  WholeFileReviewChange,
} from './review-types.js';
import { ReviewChangeCounts } from './ReviewChangeCounts.js';
import { WorkspaceFileContextMenu, type WorkspaceFileContextTarget } from './WorkspaceFileContextMenu.js';
import { WorkspaceFileIcon } from './WorkspaceFileIcon.js';

const REVIEW_DIFF_VIRTUALIZE_THRESHOLD = 80;
const REVIEW_DIFF_ROW_OVERSCAN = 12;
const REVIEW_DIFF_LINE_HEIGHT_PX = 20;
const REVIEW_DIFF_GAP_HEIGHT_PX = 30;
const REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX = 320;
const REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS = 240;
const useReviewLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function ReviewFilePath({ path }: { path: string }) {
  const { directory, filename } = reviewFilePathParts(path);
  return (
    <span className="desktop-review-file-card__path" title={path}>
      {directory ? <span className="desktop-review-file-card__path-directory">{directory}</span> : null}
      <span className="desktop-review-file-card__path-filename">{filename}</span>
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
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
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
  onOpenFileWithApp: (appId: string, filePath: string, line?: number) => void;
  onOpenProjectFile: (filePath: string) => void;
  onRevealFile: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(fileExpansionRequest.expanded);
  const [focusHighlightVersion, setFocusHighlightVersion] = useState<number | null>(null);
  const [lineContextMenu, setLineContextMenu] = useState<WorkspaceFileContextTarget | null>(null);
  const fileCardRef = useRef<HTMLElement | null>(null);
  const workspaceFilePath = reviewWorkspaceFilePath(file.path, pathContext);
  const canOpenFile = Boolean(workspaceFilePath);
  const focusedByRequest = Boolean(
    focusRequest
      && normalizeReviewFocusPath(file.path) === normalizeReviewFocusPath(focusRequest.path),
  );
  const visibleLines = file.lines;
  const language = fileLanguage(file.path);
  const wholeFileChange = useMemo(
    () => (expanded ? reviewWholeFileChangeType(visibleLines) : null),
    [expanded, visibleLines],
  );
  const splitWholeFileChange = diffLayout === 'split' ? wholeFileChange : null;
  const highlightedVisibleLines = useMemo<HighlightedReviewDiffLine[]>(
    () => {
      // 折叠文件应保持低开销：在大型审查中预先高亮每个隐藏文件会产生明显成本。
      if (!expanded) return [];
      const highlightedLines = highlightedReviewDiffLines(visibleLines, language);
      return visibleLines.map((line, index) => ({
        highlighted: highlightedLines[index],
        key: `${file.path}:${line.lineNumber}:${index}`,
        line,
      }));
    },
    [expanded, file.path, language, visibleLines],
  );
  const splitRows = useMemo(
    () => (expanded && diffLayout === 'split'
      ? splitReviewDiffRows(highlightedVisibleLines)
      : []),
    [diffLayout, expanded, highlightedVisibleLines],
  );
  const diffRowEstimate = useCallback((index: number) => diffLayout === 'split' && !splitWholeFileChange
    ? estimatedSplitDiffRowHeight(splitRows[index])
    : estimatedUnifiedDiffLineHeight(highlightedVisibleLines[index]), [diffLayout, highlightedVisibleLines, splitRows, splitWholeFileChange]);

  useEffect(() => {
    setExpanded(fileExpansionRequest.expanded);
  }, [fileExpansionRequest.expanded, fileExpansionRequest.version]);

  useEffect(() => {
    if (!focusedByRequest || focusRequest?.version === undefined) return undefined;
    setExpanded(true);
    setFocusHighlightVersion(focusRequest.version);
    const frame = window.requestAnimationFrame(() => {
      fileCardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => {
      setFocusHighlightVersion((current) => (current === focusRequest.version ? null : current));
    }, 1400);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedByRequest, focusRequest?.version]);

  const openDiffLineContextMenu = (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => {
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
            setLineContextMenu({ filePath: workspaceFilePath, x: event.clientX, y: event.clientY });
          }}
        >
          <button
            className="desktop-review-file-card__path-main"
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'workspace.review.file.collapse' : 'workspace.review.file.expand', {
              path: file.path,
              action: file.action,
            })}
            onClick={() => setExpanded((value) => !value)}
          >
            <WorkspaceFileIcon path={file.path} type="file" />
            <ReviewFilePath path={file.path} />
            <ReviewChangeCounts additions={file.additions} deletions={file.deletions} />
          </button>
          <div className="desktop-review-file-card__meta">
            <IconButton
              disabled={!canOpenFile}
              label={canOpenFile ? t('workspace.review.file.openPanel') : t('workspace.review.file.outsideProject')}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) onOpenProjectFile(workspaceFilePath);
              }}
            >
              <PanelRightOpen size={13} />
            </IconButton>
            <IconButton
              disabled={!workspaceApp || !canOpenFile}
              label={!canOpenFile
                ? t('workspace.review.file.outsideProject')
                : workspaceApp
                  ? t('workspace.review.file.openInApp', { app: workspaceApp.label })
                  : t('workspace.review.file.noApp')}
              variant="ghost"
              onClick={() => {
                if (workspaceFilePath) onExternalOpenFile(workspaceFilePath);
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
              splitWholeFileChange ? 'desktop-review-diff--single-sided' : '',
              splitWholeFileChange ? `desktop-review-diff--single-sided-${splitWholeFileChange}` : '',
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
            {file.truncated ? <div className="desktop-review-truncated">{t('workspace.review.file.truncated')}</div> : null}
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

function ReviewDiffContent({
  children,
  className,
  diffLayout,
  highlightedLines,
  language,
  lineWrap,
  rowEstimate,
  splitRows,
  wholeFileChange,
  onLineContextMenu,
}: {
  children?: ReactNode;
  className: string;
  diffLayout: DesktopReviewDiffLayout;
  highlightedLines: HighlightedReviewDiffLine[];
  language: string;
  lineWrap: boolean;
  rowEstimate: (index: number) => number;
  splitRows: SplitReviewDiffRow[];
  wholeFileChange: WholeFileReviewChange | null;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const isTwoSidedSplit = diffLayout === 'split' && !wholeFileChange;
  const itemCount = isTwoSidedSplit ? splitRows.length : highlightedLines.length;
  const shouldVirtualize = canVirtualizeReviewDiff(itemCount);
  const intrinsicSizeStyle = useMemo<CSSProperties | undefined>(() => {
    if (shouldVirtualize) return undefined;
    let estimatedHeight = 0;
    for (let index = 0; index < itemCount; index += 1) {
      estimatedHeight += rowEstimate(index);
    }
    return {
      '--desktop-review-diff-intrinsic-block-size': `${Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, estimatedHeight)}px`,
    } as CSSProperties;
  }, [itemCount, rowEstimate, shouldVirtualize]);

  if (isTwoSidedSplit) {
    if (shouldVirtualize && !lineWrap) {
      return (
        <ReviewSplitVirtualDiffViewport
          className={className}
          language={language}
          rows={splitRows}
          rowEstimate={rowEstimate}
          onLineContextMenu={onLineContextMenu}
        >
          {children}
        </ReviewSplitVirtualDiffViewport>
      );
    }
    if (shouldVirtualize) {
      return (
        <VirtualReviewDiffViewport
          className={className}
          itemCount={itemCount}
          renderItem={(index) => (
            <ReviewSplitDiffRow
              language={language}
              lineWrap={lineWrap}
              row={splitRows[index]}
              onLineContextMenu={onLineContextMenu}
            />
          )}
          rowEstimate={rowEstimate}
          virtualizationKey={`split:${lineWrap ? 'wrap' : 'nowrap'}`}
        >
          {children}
        </VirtualReviewDiffViewport>
      );
    }
    return (
      <div className={className} style={intrinsicSizeStyle}>
        <ReviewSplitDiff
          language={language}
          lineWrap={lineWrap}
          rows={splitRows}
          onLineContextMenu={onLineContextMenu}
        />
        {children}
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div className={className} style={intrinsicSizeStyle}>
        <ReviewUnifiedDiff
          language={language}
          lineWrap={lineWrap}
          lines={highlightedLines}
          onLineContextMenu={onLineContextMenu}
        />
        {children}
      </div>
    );
  }

  return (
    <VirtualReviewDiffViewport
      className={className}
      itemCount={itemCount}
      renderItem={(index) => (
        <ReviewUnifiedDiffLine
          item={highlightedLines[index]}
          language={language}
          lineWrap={lineWrap}
          onLineContextMenu={onLineContextMenu}
        />
      )}
      rowEstimate={rowEstimate}
      virtualizationKey={`${diffLayout}:${wholeFileChange ?? 'unified'}:${lineWrap ? 'wrap' : 'nowrap'}`}
    >
      {children}
    </VirtualReviewDiffViewport>
  );
}

function ReviewSplitVirtualDiffViewport({
  children,
  className,
  language,
  rows,
  rowEstimate,
  onLineContextMenu,
}: {
  children?: ReactNode;
  className: string;
  language: string;
  rows: SplitReviewDiffRow[];
  rowEstimate: (index: number) => number;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const oldPaneRef = useRef<HTMLDivElement | null>(null);
  const newPaneRef = useRef<HTMLDivElement | null>(null);
  const splitMeasuredHeightsRef = useRef<Map<number, { new?: number; old?: number }>>(new Map());
  const previousRowsRef = useRef(rows);
  if (previousRowsRef.current !== rows) {
    previousRowsRef.current = rows;
    splitMeasuredHeightsRef.current.clear();
  }
  const {
    measureItem,
    onScroll,
    setVirtualScrollTop,
    setViewportElement,
    totalHeight,
    virtualItems,
  } = useReviewDiffVirtualizer({ itemCount: rows.length, rowEstimate });
  const measureSplitItem = useCallback((side: 'new' | 'old', index: number, height: number) => {
    const previous = splitMeasuredHeightsRef.current.get(index) ?? {};
    const next = { ...previous, [side]: height };
    splitMeasuredHeightsRef.current.set(index, next);
    measureItem(index, Math.max(next.old ?? 0, next.new ?? 0));
  }, [measureItem]);
  const measureOldItem = useCallback((index: number, height: number) => {
    measureSplitItem('old', index, height);
  }, [measureSplitItem]);
  const measureNewItem = useCallback((index: number, height: number) => {
    measureSplitItem('new', index, height);
  }, [measureSplitItem]);
  const syncPaneScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    const targetPane = event.currentTarget === oldPaneRef.current ? newPaneRef.current : oldPaneRef.current;
    if (targetPane && Math.abs(targetPane.scrollTop - nextScrollTop) > 1) targetPane.scrollTop = nextScrollTop;
    onScroll(event);
  }, [onScroll]);
  const scrollOldPaneVertically = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.deltaY || !newPaneRef.current) return;
    event.preventDefault();
    const pane = newPaneRef.current;
    const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
    const nextScrollTop = Math.min(maxScrollTop, Math.max(0, pane.scrollTop + event.deltaY));
    pane.scrollTop = nextScrollTop;
    if (oldPaneRef.current) oldPaneRef.current.scrollTop = nextScrollTop;
    setVirtualScrollTop(nextScrollTop);
  }, [setVirtualScrollTop]);

  useEffect(() => {
    if (oldPaneRef.current) oldPaneRef.current.scrollTop = 0;
    if (newPaneRef.current) newPaneRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div
      className={`${className} desktop-review-diff--virtual desktop-review-diff--split-independent`}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
    >
      <div
        className="desktop-review-diff-split-virtual-pane desktop-review-diff-split-virtual-pane--old"
        ref={oldPaneRef}
        onScroll={syncPaneScroll}
        onWheel={scrollOldPaneVertically}
      >
        <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
          <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
            {virtualItems.map((item) => (
              <ReviewVirtualStackRow
                index={item.index}
                key={item.index}
                minHeight={item.height}
                onMeasure={measureOldItem}
              >
                <ReviewSplitDiffCell
                  item={rows[item.index]?.oldLine ?? null}
                  language={language}
                  lineWrap={false}
                  side="old"
                  onLineContextMenu={onLineContextMenu}
                />
              </ReviewVirtualStackRow>
            ))}
          </ReviewVirtualStack>
        </div>
      </div>
      <div
        className="desktop-review-diff-split-virtual-pane desktop-review-diff-split-virtual-pane--new"
        ref={(element) => {
          newPaneRef.current = element;
          setViewportElement(element);
        }}
        onScroll={syncPaneScroll}
      >
        <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
          <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
            {virtualItems.map((item) => (
              <ReviewVirtualStackRow
                index={item.index}
                key={item.index}
                minHeight={item.height}
                onMeasure={measureNewItem}
              >
                <ReviewSplitDiffCell
                  item={rows[item.index]?.newLine ?? null}
                  language={language}
                  lineWrap={false}
                  side="new"
                  onLineContextMenu={onLineContextMenu}
                />
              </ReviewVirtualStackRow>
            ))}
          </ReviewVirtualStack>
        </div>
      </div>
      {children}
    </div>
  );
}

function VirtualReviewDiffViewport({
  children,
  className,
  itemCount,
  renderItem,
  rowEstimate,
  virtualizationKey,
}: {
  children?: ReactNode;
  className: string;
  itemCount: number;
  renderItem: (index: number) => ReactNode;
  rowEstimate: (index: number) => number;
  virtualizationKey: string;
}) {
  const {
    containerRef,
    measureItem,
    onScroll,
    totalHeight,
    virtualItems,
  } = useReviewDiffVirtualizer({ itemCount, rowEstimate, virtualizationKey });

  return (
    <div
      className={`${className} desktop-review-diff--virtual`}
      ref={containerRef}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
      onScroll={onScroll}
    >
      <div className="desktop-review-diff-virtual-spacer" style={{ height: totalHeight }}>
        <ReviewVirtualStack top={virtualItems[0]?.top ?? 0}>
          {virtualItems.map((item) => (
            <ReviewVirtualStackRow
              index={item.index}
              key={item.index}
              minHeight={item.height}
              onMeasure={measureItem}
            >
              {renderItem(item.index)}
            </ReviewVirtualStackRow>
          ))}
        </ReviewVirtualStack>
      </div>
      {children}
    </div>
  );
}

function ReviewVirtualStack({ children, top }: { children: ReactNode; top: number }) {
  return (
    <div
      className="desktop-review-diff-virtual-stack"
      style={{ transform: `translateY(${top}px)` }}
    >
      {children}
    </div>
  );
}

function ReviewVirtualStackRow({
  children,
  index,
  minHeight,
  onMeasure,
}: {
  children: ReactNode;
  index: number;
  minHeight: number;
  onMeasure: (index: number, height: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);

  useReviewLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    // 测量内容的固有高度，而不是包装元素预留的最小高度。测量包装元素会把临时的
    // 过大数值不断反馈给自身。
    const content = row.firstElementChild ?? row;
    const measure = () => onMeasure(index, content.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [index, onMeasure]);

  return (
    <div
      className="desktop-review-diff-virtual-stack-row"
      ref={rowRef}
      style={{ minHeight }}
    >
      {children}
    </div>
  );
}

function ReviewUnifiedDiff({
  language,
  lineWrap,
  lines,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  lines: HighlightedReviewDiffLine[];
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  return (
    <>
      {lines.map((item) => (
        <ReviewUnifiedDiffLine
          item={item}
          key={item.key}
          language={language}
          lineWrap={lineWrap}
          onLineContextMenu={onLineContextMenu}
        />
      ))}
    </>
  );
}

function ReviewUnifiedDiffLine({
  item,
  language,
  lineWrap,
  onLineContextMenu,
}: {
  item: HighlightedReviewDiffLine;
  language: string;
  lineWrap: boolean;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (item.line.type === 'gap') {
    return (
      <div className={`desktop-review-diff-line desktop-review-diff-line--gap ${lineWrap ? 'desktop-review-diff-line--wrap' : ''}`}>
        <ReviewDiffGapContent content={item.line.content} />
      </div>
    );
  }
  const targetLine = item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={`desktop-review-diff-line desktop-review-diff-line--${item.line.type} ${lineWrap ? 'desktop-review-diff-line--wrap' : ''}`}
      onContextMenu={(event) => onLineContextMenu(event, item.line, targetLine)}
    >
      <span className="desktop-review-diff-line__number">{targetLine ?? ''}</span>
      <ReviewDiffCode content={item.line.content} highlighted={item.highlighted} language={language} lineWrap={lineWrap} />
    </div>
  );
}

function ReviewSplitDiff({
  language,
  lineWrap,
  rows,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  rows: SplitReviewDiffRow[];
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (!lineWrap) {
    return (
      <>
        <div className="desktop-review-diff-split-pane desktop-review-diff-split-pane--old">
          {rows.map((row) => (
            <ReviewSplitDiffCell
              item={row.oldLine}
              key={`${row.key}:old`}
              language={language}
              lineWrap={false}
              side="old"
              onLineContextMenu={onLineContextMenu}
            />
          ))}
        </div>
        <div className="desktop-review-diff-split-pane desktop-review-diff-split-pane--new">
          {rows.map((row) => (
            <ReviewSplitDiffCell
              item={row.newLine}
              key={`${row.key}:new`}
              language={language}
              lineWrap={false}
              side="new"
              onLineContextMenu={onLineContextMenu}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <ReviewSplitDiffRow
          key={row.key}
          language={language}
          lineWrap={lineWrap}
          row={row}
          onLineContextMenu={onLineContextMenu}
        />
      ))}
    </>
  );
}

function ReviewSplitDiffRow({
  language,
  lineWrap,
  row,
  onLineContextMenu,
}: {
  language: string;
  lineWrap: boolean;
  row: SplitReviewDiffRow;
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  const isGapRow = row.oldLine?.line.type === 'gap' && !row.newLine;
  return (
    <div className={`desktop-review-diff-split-row ${isGapRow ? 'desktop-review-diff-split-row--gap' : ''}`}>
      <ReviewSplitDiffCell
        item={row.oldLine}
        language={language}
        lineWrap={lineWrap}
        side="old"
        onLineContextMenu={onLineContextMenu}
      />
      {isGapRow ? null : (
        <ReviewSplitDiffCell
          item={row.newLine}
          language={language}
          lineWrap={lineWrap}
          side="new"
          onLineContextMenu={onLineContextMenu}
        />
      )}
    </div>
  );
}

function ReviewSplitDiffCell({
  item,
  language,
  lineWrap,
  side,
  onLineContextMenu,
}: {
  item: HighlightedReviewDiffLine | null;
  language: string;
  lineWrap: boolean;
  side: 'old' | 'new';
  onLineContextMenu: (event: MouseEvent, line: DesktopDiffFile['lines'][number], preferredLine?: number) => void;
}) {
  if (!item) {
    return <span aria-hidden="true" className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--empty ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`} />;
  }
  if (item.line.type === 'gap') {
    return (
      <span className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--gap ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`}>
        <ReviewDiffGapContent content={item.line.content} />
      </span>
    );
  }
  const targetLine = side === 'old' ? item.line.oldLine ?? item.line.newLine : item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={`desktop-review-diff-split-cell desktop-review-diff-split-cell--${side} desktop-review-diff-split-cell--${item.line.type} ${lineWrap ? 'desktop-review-diff-split-cell--wrap' : ''}`}
      onContextMenu={(event) => onLineContextMenu(event, item.line, targetLine)}
    >
      <span className="desktop-review-diff-line__number">{targetLine ?? ''}</span>
      <ReviewDiffCode content={item.line.content} highlighted={item.highlighted} language={language} lineWrap={lineWrap} />
    </div>
  );
}

function ReviewDiffGapContent({ content }: { content: string }) {
  return (
    <span className="desktop-review-diff-gap-content">
      <span aria-hidden="true" className="desktop-review-diff-line__number desktop-review-diff-gap-content__gutter">
        <ChevronsUpDown size={11} />
      </span>
      <span className="desktop-review-diff-gap-content__label">{content}</span>
    </span>
  );
}

export function highlightedReviewDiffLines(lines: DesktopDiffFile['lines'], language: string): Array<string | undefined> {
  const highlightedLines = Array<string | undefined>(lines.length).fill(undefined);
  let segmentStart = 0;

  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index]?.type !== 'gap') continue;
    highlightReviewDiffSegment(lines, segmentStart, index, language, highlightedLines);
    segmentStart = index + 1;
  }

  return highlightedLines;
}

export function reviewWholeFileChangeType(lines: DesktopDiffFile['lines']): WholeFileReviewChange | null {
  const contentLines = lines.filter((line) => line.type !== 'gap');
  if (!contentLines.length) return null;
  if (contentLines.every((line) => line.type === 'added')) return 'added';
  if (contentLines.every((line) => line.type === 'removed')) return 'removed';
  return null;
}

function highlightReviewDiffSegment(
  lines: DesktopDiffFile['lines'],
  start: number,
  end: number,
  language: string,
  output: Array<string | undefined>,
): void {
  if (start >= end) return;
  const oldSourceLines: Array<{ content: string; index: number }> = [];
  const newSourceLines: Array<{ content: string; index: number }> = [];

  // 分别将新旧两侧解析为连续源码，既保留多行语法上下文，又不会混合变更块的两个版本。
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (!line || line.type === 'gap') continue;
    if (line.type !== 'added') oldSourceLines.push({ content: line.content, index });
    if (line.type !== 'removed') newSourceLines.push({ content: line.content, index });
  }

  const oldHighlightedLines = highlightedCodeLinesHtml(oldSourceLines.map((line) => line.content).join('\n'), language);
  oldSourceLines.forEach((line, index) => {
    if (lines[line.index]?.type === 'removed') output[line.index] = oldHighlightedLines[index];
  });

  const newHighlightedLines = highlightedCodeLinesHtml(newSourceLines.map((line) => line.content).join('\n'), language);
  newSourceLines.forEach((line, index) => {
    output[line.index] = newHighlightedLines[index];
  });
}

function ReviewDiffCode({ content, highlighted, language, lineWrap }: { content: string; highlighted?: string; language: string; lineWrap: boolean }) {
  const shouldWrap = shouldWrapReviewDiffLine(content, lineWrap);
  const className = [
    'desktop-review-diff-code',
    shouldWrap ? 'desktop-review-diff-code--wrap' : '',
    lineWrap && !shouldWrap ? 'desktop-review-diff-code--long-line' : '',
  ].filter(Boolean).join(' ');
  if (highlighted !== undefined) {
    return <code className={`${className} language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted || ' ' }} />;
  }
  return <code className={className}>{content || ' '}</code>;
}

export function shouldWrapReviewDiffLine(content: string, lineWrap: boolean): boolean {
  return lineWrap && content.length <= REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS;
}

function splitReviewDiffRows(lines: HighlightedReviewDiffLine[]): SplitReviewDiffRow[] {
  const rows: SplitReviewDiffRow[] = [];
  let removedLines: HighlightedReviewDiffLine[] = [];
  let addedLines: HighlightedReviewDiffLine[] = [];
  const flushChangedLines = () => {
    const rowCount = Math.max(removedLines.length, addedLines.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        key: `change:${rows.length}:${removedLines[index]?.key ?? ''}:${addedLines[index]?.key ?? ''}`,
        oldLine: removedLines[index] ?? null,
        newLine: addedLines[index] ?? null,
      });
    }
    removedLines = [];
    addedLines = [];
  };

  for (const line of lines) {
    if (line.line.type === 'removed') {
      removedLines.push(line);
      continue;
    }
    if (line.line.type === 'added') {
      addedLines.push(line);
      continue;
    }
    flushChangedLines();
    rows.push({
      key: `${line.line.type}:${line.key}`,
      oldLine: line,
      newLine: line.line.type === 'gap' ? null : line,
    });
  }
  flushChangedLines();
  return rows;
}

type ReviewVirtualItem = {
  height: number;
  index: number;
  top: number;
};

function useReviewDiffVirtualizer({
  itemCount,
  rowEstimate,
  virtualizationKey = 'default',
}: {
  itemCount: number;
  rowEstimate: (index: number) => number;
  virtualizationKey?: string;
}): {
  containerRef: (element: HTMLDivElement | null) => void;
  measureItem: (index: number, height: number) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  setVirtualScrollTop: (scrollTop: number) => void;
  setViewportElement: (element: HTMLDivElement | null) => void;
  totalHeight: number;
  virtualItems: ReviewVirtualItem[];
} {
  const containerElementRef = useRef<HTMLDivElement | null>(null);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const [measuredVersion, setMeasuredVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportElement, setViewportElementState] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const setViewportElement = useCallback((element: HTMLDivElement | null) => {
    containerElementRef.current = element;
    setViewportElementState(element);
  }, []);

  useEffect(() => {
    measuredHeightsRef.current = new Map();
    setMeasuredVersion((version) => version + 1);
    setScrollTop(0);
    if (containerElementRef.current) containerElementRef.current.scrollTop = 0;
  }, [itemCount, rowEstimate, virtualizationKey]);

  useReviewLayoutEffect(() => {
    const container = viewportElement;
    if (!container) return undefined;
    const updateViewportSize = () => {
      const nextHeight = container.clientHeight;
      const nextWidth = container.clientWidth;
      setViewportHeight(nextHeight);
      setViewportWidth((previousWidth) => {
        if (previousWidth === nextWidth) return previousWidth;
        measuredHeightsRef.current = new Map();
        setMeasuredVersion((version) => version + 1);
        return nextWidth;
      });
    };
    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [viewportElement]);

  const offsets = useMemo(() => {
    const nextOffsets = new Array<number>(itemCount + 1);
    nextOffsets[0] = 0;
    for (let index = 0; index < itemCount; index += 1) {
      const measuredHeight = measuredHeightsRef.current.get(index);
      nextOffsets[index + 1] = nextOffsets[index] + (measuredHeight ?? rowEstimate(index));
    }
    return nextOffsets;
  }, [itemCount, measuredVersion, rowEstimate]);

  const visibleRange = useMemo(
    () => reviewVirtualRange(offsets, scrollTop, viewportHeight),
    [offsets, scrollTop, viewportHeight, viewportWidth],
  );

  const virtualItems = useMemo(() => {
    const items: ReviewVirtualItem[] = [];
    for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
      const top = offsets[index] ?? 0;
      items.push({ height: Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, (offsets[index + 1] ?? top) - top), index, top });
    }
    return items;
  }, [offsets, visibleRange.end, visibleRange.start]);

  const measureItem = useCallback((index: number, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const roundedHeight = Math.ceil(height);
    const previousHeight = measuredHeightsRef.current.get(index);
    if (previousHeight === roundedHeight) return;
    measuredHeightsRef.current.set(index, roundedHeight);
    setMeasuredVersion((version) => version + 1);
  }, []);

  const setVirtualScrollTop = useCallback((nextScrollTop: number) => {
    setScrollTop(nextScrollTop);
  }, []);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setVirtualScrollTop(event.currentTarget.scrollTop);
  }, [setVirtualScrollTop]);

  return {
    containerRef: setViewportElement,
    measureItem,
    onScroll,
    setVirtualScrollTop,
    setViewportElement,
    totalHeight: offsets[itemCount] ?? 0,
    virtualItems,
  };
}

export function reviewVirtualRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = REVIEW_DIFF_ROW_OVERSCAN,
): { end: number; start: number } {
  const itemCount = Math.max(0, offsets.length - 1);
  if (!itemCount) return { start: 0, end: 0 };
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, viewportHeight);
  const start = Math.max(0, offsetIndexForPosition(offsets, safeScrollTop) - overscan);
  const end = Math.min(itemCount, offsetIndexForPosition(offsets, safeScrollTop + safeViewportHeight) + overscan + 1);
  return { start, end: Math.max(start, end) };
}

function offsetIndexForPosition(offsets: number[], position: number): number {
  let low = 0;
  let high = Math.max(0, offsets.length - 2);
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if ((offsets[middle + 1] ?? 0) <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function canVirtualizeReviewDiff(itemCount: number): boolean {
  return itemCount > REVIEW_DIFF_VIRTUALIZE_THRESHOLD
    && typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof ResizeObserver !== 'undefined';
}

function estimatedUnifiedDiffLineHeight(item?: HighlightedReviewDiffLine | null): number {
  return item?.line.type === 'gap' ? REVIEW_DIFF_GAP_HEIGHT_PX : REVIEW_DIFF_LINE_HEIGHT_PX;
}

function estimatedSplitDiffRowHeight(row?: SplitReviewDiffRow | null): number {
  const oldHeight = estimatedUnifiedDiffLineHeight(row?.oldLine);
  const newHeight = estimatedUnifiedDiffLineHeight(row?.newLine);
  return Math.max(oldHeight, newHeight);
}
