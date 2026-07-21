// @ts-nocheck

/** Line-oriented file diff generation and compaction. */

import {
  MAX_DIFF_CELLS,
  DIFF_CONTEXT_LINES,
  DIFF_FOLD_THRESHOLD_LINES,
} from './pc-local-tool-constants.js';
import {
  workspaceRelativePath,
} from './pc-local-tool-paths.js';

export function patchDiffFromDiffs(diffs) {
  if (!diffs.length) return null;
  if (diffs.length === 1) return diffs[0];
  return {
    type: 'patch_diff',
    action: 'Edited',
    path: `${diffs.length} files`,
    additions: diffs.reduce((total, diff) => total + Number(diff.additions || 0), 0),
    deletions: diffs.reduce((total, diff) => total + Number(diff.deletions || 0), 0),
    truncated: diffs.some((diff) => diff.truncated),
    diffs,
  };
}

export function buildFileDiff({ filePath, root, existed, previousContent, nextContent }) {
  const previousLines = splitContentLines(previousContent);
  const nextLines = splitContentLines(nextContent);
  const ops = diffLineOperations(previousLines, nextLines);
  const additions = ops.filter((line) => line.type === 'add').length;
  const deletions = ops.filter((line) => line.type === 'del').length;
  const compacted = compactDiffOperations(ops, DIFF_CONTEXT_LINES);

  return {
    type: 'file_diff',
    action: existed ? 'Edited' : 'Created',
    path: workspaceRelativePath(filePath, root),
    additions,
    deletions,
    truncated: false,
    lines: compacted,
  };
}

export function buildDeletedFileDiff({ filePath, root, previousContent }) {
  return {
    ...buildFileDiff({
      filePath,
      root,
      existed: true,
      previousContent,
      nextContent: '',
    }),
    action: 'Deleted',
  };
}

function splitContentLines(content) {
  const text = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function previewComparablePreviousContent(previousContent, nextContent) {
  const nextLines = splitContentLines(nextContent);
  if (!nextLines.length) return '';
  return splitContentLines(previousContent).slice(0, nextLines.length).join('\n');
}

function diffLineOperations(previousLines, nextLines) {
  if (!previousLines.length && !nextLines.length) return [];
  let prefixLength = 0;
  while (
    prefixLength < previousLines.length
    && prefixLength < nextLines.length
    && previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousEnd = previousLines.length;
  let nextEnd = nextLines.length;
  while (
    previousEnd > prefixLength
    && nextEnd > prefixLength
    && previousLines[previousEnd - 1] === nextLines[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const prefix = previousLines
    .slice(0, prefixLength)
    .map((content, index) => contextDiffLine(content, index + 1, index + 1));
  const previousMiddle = previousLines.slice(prefixLength, previousEnd);
  const nextMiddle = nextLines.slice(prefixLength, nextEnd);
  const middle = previousMiddle.length * nextMiddle.length > MAX_DIFF_CELLS
    ? replacementDiff(previousMiddle, nextMiddle, prefixLength, prefixLength)
    : lcsDiffOperations(previousMiddle, nextMiddle, prefixLength, prefixLength);
  const suffix = previousLines
    .slice(previousEnd)
    .map((content, index) => contextDiffLine(content, previousEnd + index + 1, nextEnd + index + 1));

  return [...prefix, ...middle, ...suffix];
}

function contextDiffLine(content, oldLine, newLine) {
  return {
    type: 'context',
    lineNumber: newLine,
    oldLine,
    newLine,
    content,
  };
}

function lcsDiffOperations(previousLines, nextLines, oldOffset = 0, newOffset = 0) {
  if (!previousLines.length && !nextLines.length) return [];

  const rows = previousLines.length + 1;
  const columns = nextLines.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));

  for (let oldIndex = previousLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = nextLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] =
        previousLines[oldIndex] === nextLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  const operations = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < previousLines.length && newIndex < nextLines.length) {
    if (previousLines[oldIndex] === nextLines[newIndex]) {
      operations.push(contextDiffLine(previousLines[oldIndex], oldOffset + oldIndex + 1, newOffset + newIndex + 1));
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      operations.push({
        type: 'del',
        lineNumber: oldOffset + oldIndex + 1,
        oldLine: oldOffset + oldIndex + 1,
        content: previousLines[oldIndex],
      });
      oldIndex += 1;
    } else {
      operations.push({
        type: 'add',
        lineNumber: newOffset + newIndex + 1,
        newLine: newOffset + newIndex + 1,
        content: nextLines[newIndex],
      });
      newIndex += 1;
    }
  }

  while (oldIndex < previousLines.length) {
    operations.push({
      type: 'del',
      lineNumber: oldOffset + oldIndex + 1,
      oldLine: oldOffset + oldIndex + 1,
      content: previousLines[oldIndex],
    });
    oldIndex += 1;
  }

  while (newIndex < nextLines.length) {
    operations.push({
      type: 'add',
      lineNumber: newOffset + newIndex + 1,
      newLine: newOffset + newIndex + 1,
      content: nextLines[newIndex],
    });
    newIndex += 1;
  }

  return operations;
}

function replacementDiff(previousLines, nextLines, oldOffset = 0, newOffset = 0) {
  return [
    ...previousLines.map((content, index) => ({
      type: 'del',
      lineNumber: oldOffset + index + 1,
      oldLine: oldOffset + index + 1,
      content,
    })),
    ...nextLines.map((content, index) => ({
      type: 'add',
      lineNumber: newOffset + index + 1,
      newLine: newOffset + index + 1,
      content,
    })),
  ];
}

function compactDiffOperations(operations, contextSize) {
  const changedIndexes = operations
    .map((line, index) => (line.type === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (!changedIndexes.length) return [];

  const ranges = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - contextSize);
    const end = Math.min(operations.length - 1, index + contextSize);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const compacted = [];
  ranges.forEach((range, index) => {
    if (index > 0) {
      const previous = ranges[index - 1];
      const gapStart = previous.end + 1;
      const gapEnd = range.start - 1;
      const gapSize = gapEnd - gapStart + 1;
      if (gapSize > DIFF_FOLD_THRESHOLD_LINES) {
        compacted.push({ type: 'gap', content: '...' });
      } else if (gapSize > 0) {
        compacted.push(...operations.slice(gapStart, gapEnd + 1));
      }
    }
    compacted.push(...operations.slice(range.start, range.end + 1));
  });
  return compacted;
}
