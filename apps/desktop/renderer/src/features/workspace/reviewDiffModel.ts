import { highlightedDiffLinesHtml } from './codeHighlight.js';
import type { DesktopDiffFile } from './model.js';
import type {
  HighlightedReviewDiffLine,
  SplitReviewDiffRow,
  WholeFileReviewChange,
} from './review-types.js';

export const REVIEW_DIFF_LINE_HEIGHT_PX = 20;
export const REVIEW_DIFF_GAP_HEIGHT_PX = 30;
export const REVIEW_DIFF_VIRTUAL_VIEWPORT_HEIGHT_PX = 320;

const REVIEW_DIFF_VIRTUALIZE_THRESHOLD = 80;
const REVIEW_DIFF_ROW_OVERSCAN = 12;
const REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS = 240;

export function highlightedReviewDiffLines(
  lines: DesktopDiffFile['lines'],
  language: string,
): Array<string | undefined> {
  return highlightedDiffLinesHtml(lines, language);
}

export function reviewWholeFileChangeType(
  lines: DesktopDiffFile['lines'],
): WholeFileReviewChange | null {
  const contentLines = lines.filter((line) => line.type !== 'gap');
  if (!contentLines.length) return null;
  if (contentLines.every((line) => line.type === 'added')) return 'added';
  if (contentLines.every((line) => line.type === 'removed')) return 'removed';
  return null;
}

export function shouldWrapReviewDiffLine(
  content: string,
  lineWrap: boolean,
): boolean {
  return lineWrap && content.length <= REVIEW_DIFF_MAX_WRAPPABLE_LINE_CHARS;
}

export function splitReviewDiffRows(
  lines: HighlightedReviewDiffLine[],
): SplitReviewDiffRow[] {
  const rows: SplitReviewDiffRow[] = [];
  let removedLines: HighlightedReviewDiffLine[] = [];
  let addedLines: HighlightedReviewDiffLine[] = [];
  const flushChangedLines = () => {
    const rowCount = Math.max(removedLines.length, addedLines.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        key: [
          'change',
          rows.length,
          removedLines[index]?.key ?? '',
          addedLines[index]?.key ?? '',
        ].join(':'),
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

export function reviewVirtualRange(
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = REVIEW_DIFF_ROW_OVERSCAN,
): { end: number; start: number } {
  const itemCount = Math.max(0, offsets.length - 1);
  if (!itemCount) return { start: 0, end: 0 };
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(
    REVIEW_DIFF_LINE_HEIGHT_PX,
    viewportHeight,
  );
  const start = Math.max(
    0,
    offsetIndexForPosition(offsets, safeScrollTop) - overscan,
  );
  const end = Math.min(
    itemCount,
    offsetIndexForPosition(
      offsets,
      safeScrollTop + safeViewportHeight,
    ) + overscan + 1,
  );
  return { start, end: Math.max(start, end) };
}

function offsetIndexForPosition(
  offsets: number[],
  position: number,
): number {
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

export function canVirtualizeReviewDiff(itemCount: number): boolean {
  return itemCount > REVIEW_DIFF_VIRTUALIZE_THRESHOLD
    && typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof ResizeObserver !== 'undefined';
}

export function estimatedUnifiedDiffLineHeight(
  item?: HighlightedReviewDiffLine | null,
): number {
  return item?.line.type === 'gap'
    ? REVIEW_DIFF_GAP_HEIGHT_PX
    : REVIEW_DIFF_LINE_HEIGHT_PX;
}

export function estimatedSplitDiffRowHeight(
  row?: SplitReviewDiffRow | null,
): number {
  const oldHeight = estimatedUnifiedDiffLineHeight(row?.oldLine);
  const newHeight = estimatedUnifiedDiffLineHeight(row?.newLine);
  return Math.max(oldHeight, newHeight);
}
