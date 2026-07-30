import { ChevronsUpDown } from 'lucide-react';
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
  type UIEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { DesktopDiffFile } from './model.js';
import {
  canVirtualizeReviewDiff,
  REVIEW_DIFF_LINE_HEIGHT_PX,
  REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX,
  reviewVirtualRange,
  shouldWrapReviewDiffLine,
} from './reviewDiffModel.js';
import type {
  DesktopReviewDiffLayout,
  HighlightedReviewDiffLine,
  SplitReviewDiffRow,
  WholeFileReviewChange,
} from './review-types.js';

type ReviewDiffLineContextMenuHandler = (
  event: MouseEvent,
  line: DesktopDiffFile['lines'][number],
  preferredLine?: number,
) => void;

const useReviewLayoutEffect = typeof window === 'undefined'
  ? useEffect
  : useLayoutEffect;

export function ReviewDiffContent({
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
}) {
  const isTwoSidedSplit = diffLayout === 'split' && !wholeFileChange;
  const itemCount = isTwoSidedSplit
    ? splitRows.length
    : highlightedLines.length;
  const shouldVirtualize = canVirtualizeReviewDiff(itemCount);
  const intrinsicSizeStyle = useMemo<CSSProperties | undefined>(() => {
    if (shouldVirtualize) return undefined;
    let estimatedHeight = 0;
    for (let index = 0; index < itemCount; index += 1) {
      estimatedHeight += rowEstimate(index);
    }
    return {
      '--desktop-review-diff-intrinsic-block-size': `${
        Math.max(REVIEW_DIFF_LINE_HEIGHT_PX, estimatedHeight)
      }px`,
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
      virtualizationKey={[
        diffLayout,
        wholeFileChange ?? 'unified',
        lineWrap ? 'wrap' : 'nowrap',
      ].join(':')}
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
}) {
  const oldPaneRef = useRef<HTMLDivElement | null>(null);
  const newPaneRef = useRef<HTMLDivElement | null>(null);
  const splitMeasuredHeightsRef = useRef<
    Map<number, { new?: number; old?: number }>
  >(new Map());
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
  } = useReviewDiffVirtualizer({
    itemCount: rows.length,
    rowEstimate,
  });
  const measureSplitItem = useCallback((
    side: 'new' | 'old',
    index: number,
    height: number,
  ) => {
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
    const targetPane = event.currentTarget === oldPaneRef.current
      ? newPaneRef.current
      : oldPaneRef.current;
    if (
      targetPane
      && Math.abs(targetPane.scrollTop - nextScrollTop) > 1
    ) {
      targetPane.scrollTop = nextScrollTop;
    }
    onScroll(event);
  }, [onScroll]);
  const scrollOldPaneVertically = useCallback((
    event: ReactWheelEvent<HTMLDivElement>,
  ) => {
    if (!event.deltaY || !newPaneRef.current) return;
    event.preventDefault();
    const pane = newPaneRef.current;
    const maxScrollTop = Math.max(
      0,
      pane.scrollHeight - pane.clientHeight,
    );
    const nextScrollTop = Math.min(
      maxScrollTop,
      Math.max(0, pane.scrollTop + event.deltaY),
    );
    pane.scrollTop = nextScrollTop;
    if (oldPaneRef.current) {
      oldPaneRef.current.scrollTop = nextScrollTop;
    }
    setVirtualScrollTop(nextScrollTop);
  }, [setVirtualScrollTop]);

  useEffect(() => {
    if (oldPaneRef.current) oldPaneRef.current.scrollTop = 0;
    if (newPaneRef.current) newPaneRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div
      className={[
        className,
        'desktop-review-diff--virtual',
        'desktop-review-diff--split-independent',
      ].join(' ')}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
    >
      <div
        className={[
          'desktop-review-diff-split-virtual-pane',
          'desktop-review-diff-split-virtual-pane--old',
        ].join(' ')}
        ref={oldPaneRef}
        onScroll={syncPaneScroll}
        onWheel={scrollOldPaneVertically}
      >
        <ReviewVirtualSpacer totalHeight={totalHeight}>
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
        </ReviewVirtualSpacer>
      </div>
      <div
        className={[
          'desktop-review-diff-split-virtual-pane',
          'desktop-review-diff-split-virtual-pane--new',
        ].join(' ')}
        ref={(element) => {
          newPaneRef.current = element;
          setViewportElement(element);
        }}
        onScroll={syncPaneScroll}
      >
        <ReviewVirtualSpacer totalHeight={totalHeight}>
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
        </ReviewVirtualSpacer>
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
  } = useReviewDiffVirtualizer({
    itemCount,
    rowEstimate,
    virtualizationKey,
  });

  return (
    <div
      className={`${className} desktop-review-diff--virtual`}
      ref={containerRef}
      style={{ height: REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX }}
      onScroll={onScroll}
    >
      <ReviewVirtualSpacer totalHeight={totalHeight}>
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
      </ReviewVirtualSpacer>
      {children}
    </div>
  );
}

function ReviewVirtualSpacer({
  children,
  totalHeight,
}: {
  children: ReactNode;
  totalHeight: number;
}) {
  return (
    <div
      className="desktop-review-diff-virtual-spacer"
      style={{ height: totalHeight }}
    >
      {children}
    </div>
  );
}

function ReviewVirtualStack({
  children,
  top,
}: {
  children: ReactNode;
  top: number;
}) {
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
    // 只测量内容固有高度，避免包装元素的临时 min-height 反馈给虚拟列表。
    const content = row.firstElementChild ?? row;
    const measure = () => {
      onMeasure(index, content.getBoundingClientRect().height);
    };
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
}) {
  if (item.line.type === 'gap') {
    return (
      <div
        className={[
          'desktop-review-diff-line',
          'desktop-review-diff-line--gap',
          lineWrap ? 'desktop-review-diff-line--wrap' : '',
        ].filter(Boolean).join(' ')}
      >
        <ReviewDiffGapContent content={item.line.content} />
      </div>
    );
  }
  const targetLine = item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={[
        'desktop-review-diff-line',
        `desktop-review-diff-line--${item.line.type}`,
        lineWrap ? 'desktop-review-diff-line--wrap' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={(event) => {
        onLineContextMenu(event, item.line, targetLine);
      }}
    >
      <span className="desktop-review-diff-line__number">
        {targetLine ?? ''}
      </span>
      <ReviewDiffCode
        content={item.line.content}
        highlighted={item.highlighted}
        language={language}
        lineWrap={lineWrap}
      />
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
}) {
  const isGapRow = row.oldLine?.line.type === 'gap' && !row.newLine;
  return (
    <div
      className={[
        'desktop-review-diff-split-row',
        isGapRow ? 'desktop-review-diff-split-row--gap' : '',
      ].filter(Boolean).join(' ')}
    >
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
  onLineContextMenu: ReviewDiffLineContextMenuHandler;
}) {
  if (!item) {
    return (
      <span
        aria-hidden="true"
        className={[
          'desktop-review-diff-split-cell',
          `desktop-review-diff-split-cell--${side}`,
          'desktop-review-diff-split-cell--empty',
          lineWrap ? 'desktop-review-diff-split-cell--wrap' : '',
        ].filter(Boolean).join(' ')}
      />
    );
  }
  if (item.line.type === 'gap') {
    return (
      <span
        className={[
          'desktop-review-diff-split-cell',
          `desktop-review-diff-split-cell--${side}`,
          'desktop-review-diff-split-cell--gap',
          lineWrap ? 'desktop-review-diff-split-cell--wrap' : '',
        ].filter(Boolean).join(' ')}
      >
        <ReviewDiffGapContent content={item.line.content} />
      </span>
    );
  }
  const targetLine = side === 'old'
    ? item.line.oldLine ?? item.line.newLine
    : item.line.newLine ?? item.line.oldLine;
  return (
    <div
      className={[
        'desktop-review-diff-split-cell',
        `desktop-review-diff-split-cell--${side}`,
        `desktop-review-diff-split-cell--${item.line.type}`,
        lineWrap ? 'desktop-review-diff-split-cell--wrap' : '',
      ].filter(Boolean).join(' ')}
      onContextMenu={(event) => {
        onLineContextMenu(event, item.line, targetLine);
      }}
    >
      <span className="desktop-review-diff-line__number">
        {targetLine ?? ''}
      </span>
      <ReviewDiffCode
        content={item.line.content}
        highlighted={item.highlighted}
        language={language}
        lineWrap={lineWrap}
      />
    </div>
  );
}

function ReviewDiffGapContent({ content }: { content: string }) {
  return (
    <span className="desktop-review-diff-gap-content">
      <span
        aria-hidden="true"
        className={[
          'desktop-review-diff-line__number',
          'desktop-review-diff-gap-content__gutter',
        ].join(' ')}
      >
        <ChevronsUpDown size={11} />
      </span>
      <span className="desktop-review-diff-gap-content__label">
        {content}
      </span>
    </span>
  );
}

function ReviewDiffCode({
  content,
  highlighted,
  language,
  lineWrap,
}: {
  content: string;
  highlighted?: string;
  language: string;
  lineWrap: boolean;
}) {
  const shouldWrap = shouldWrapReviewDiffLine(content, lineWrap);
  const className = [
    'desktop-review-diff-code',
    shouldWrap ? 'desktop-review-diff-code--wrap' : '',
    lineWrap && !shouldWrap ? 'desktop-review-diff-code--long-line' : '',
  ].filter(Boolean).join(' ');
  if (highlighted !== undefined) {
    return (
      <code
        className={`${className} language-${language}`}
        dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
      />
    );
  }
  return <code className={className}>{content || ' '}</code>;
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
  const [viewportElement, setViewportElementState] = useState<
    HTMLDivElement | null
  >(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const setViewportElement = useCallback((
    element: HTMLDivElement | null,
  ) => {
    containerElementRef.current = element;
    setViewportElementState(element);
  }, []);

  useEffect(() => {
    measuredHeightsRef.current = new Map();
    setMeasuredVersion((version) => version + 1);
    setScrollTop(0);
    if (containerElementRef.current) {
      containerElementRef.current.scrollTop = 0;
    }
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
      nextOffsets[index + 1] = nextOffsets[index]
        + (measuredHeight ?? rowEstimate(index));
    }
    return nextOffsets;
  }, [itemCount, measuredVersion, rowEstimate]);

  const visibleRange = useMemo(
    () => reviewVirtualRange(
      offsets,
      scrollTop,
      viewportHeight,
    ),
    [offsets, scrollTop, viewportHeight, viewportWidth],
  );

  const virtualItems = useMemo(() => {
    const items: ReviewVirtualItem[] = [];
    for (
      let index = visibleRange.start;
      index < visibleRange.end;
      index += 1
    ) {
      const top = offsets[index] ?? 0;
      items.push({
        height: Math.max(
          REVIEW_DIFF_LINE_HEIGHT_PX,
          (offsets[index + 1] ?? top) - top,
        ),
        index,
        top,
      });
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
