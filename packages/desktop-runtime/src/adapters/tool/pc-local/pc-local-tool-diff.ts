/** Line-oriented file diff generation and compaction. */

import type { WorkspaceFileChangePatch } from '@setsuna-desktop/contracts';
import { FILE_DIFF_PREVIEW_LINES, isProbablyBinaryFileContent, limitFileDiffLines, projectFileDiff } from '@setsuna-desktop/contracts';
import { createFileChangePatch } from '../../../utils/file-change-patch.js';
import {
  DIFF_CONTEXT_LINES,
  DIFF_FOLD_THRESHOLD_LINES,
  MAX_DIFF_CELLS,
} from './pc-local-tool-constants.js';
import {
  workspaceRelativePath,
} from './pc-local-tool-paths.js';

export type FileDiffAction = 'Created' | 'Edited' | 'Deleted';

export type FileDiffLine =
  | { type: 'context'; lineNumber: number; oldLine: number; newLine: number; content: string }
  | { type: 'add'; lineNumber: number; newLine: number; content: string }
  | { type: 'del'; lineNumber: number; oldLine: number; content: string }
  | { type: 'gap'; content: string };

export type FileDiff = {
  type: 'file_diff';
  action: FileDiffAction;
  path: string;
  absolutePath?: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: FileDiffLine[];
  partial?: boolean;
  binary?: boolean;
  undo?: WorkspaceFileChangePatch;
};

export type PatchDiff = {
  type: 'patch_diff';
  action: 'Edited' | 'Planned';
  path: string;
  additions: number;
  deletions: number;
  truncated?: boolean;
  partial?: boolean;
  diffs: FileDiff[];
};

export type LocalToolDiff = FileDiff | PatchDiff;

/** Keep the model's receipt independent of UI previews, with bounded source excerpts. */
export function formatFileMutationReceipt(diffs: readonly FileDiff[]): string {
  const summaries = diffs.map((diff) => {
    const added = diff.lines.filter((line) => line.type === 'add');
    const deleted = diff.lines.filter((line) => line.type === 'del');
    const ranges = [
      added.length ? `new lines ${added[0].newLine}-${added[added.length - 1].newLine}` : '',
      deleted.length ? `old lines ${deleted[0].oldLine}-${deleted[deleted.length - 1].oldLine}` : '',
    ].filter(Boolean).join('; ');
    return `${diff.action} ${JSON.stringify(diff.path)} (+${diff.additions}/-${diff.deletions})${ranges ? `; ${ranges}` : ''}`;
  });
  const excerpts: string[] = [];
  let remainingChars = 6_000;
  let remainingLines = 60;
  let omitted = false;
  // Whole-file deletions are fully described by the summary. Spend the bounded
  // excerpts on surviving code, sharing the budget so a large file cannot hide
  // every later edit. Small excerpts release their unused share to later files.
  const excerptDiffs = diffs.filter((diff) => diff.action !== 'Deleted' && diff.lines.length)
    .sort((left, right) => Number(left.action === 'Created') - Number(right.action === 'Created'));
  const omission = '[remaining diff lines omitted]';
  for (const [index, diff] of excerptDiffs.entries()) {
    const filesLeft = excerptDiffs.length - index;
    const charBudget = Math.floor(remainingChars / filesLeft);
    const lineBudget = Math.floor(remainingLines / filesLeft);
    const header = `File: ${JSON.stringify(diff.path)}`;
    if (!lineBudget || charBudget < header.length + omission.length + 2) {
      omitted = true;
      continue;
    }
    const section = [header];
    let sectionChars = header.length + 1;
    let sectionLines = 0;
    for (const line of diff.lines) {
      const text = line.type === 'gap' ? '[unchanged lines omitted]'
        : line.type === 'del' ? `- old ${line.oldLine}: ${line.content}`
          : `${line.type === 'add' ? '+' : ' '} new ${line.newLine}: ${line.content}`;
      if (sectionLines >= lineBudget || sectionChars + text.length + omission.length + 2 > charBudget) break;
      section.push(text);
      sectionChars += text.length + 1;
      sectionLines += 1;
    }
    if (sectionLines < diff.lines.length) {
      omitted = true;
      section.push(omission);
      sectionChars += omission.length + 1;
    }
    excerpts.push(...section);
    remainingChars -= sectionChars;
    remainingLines -= sectionLines;
  }
  return [
    ...summaries,
    ...(excerpts.length ? ['Applied diff excerpt (old = before this edit; new = current file; not an apply_patch input):'] : []),
    ...excerpts,
    ...(omitted ? ['[diff excerpt truncated; use read_file for the affected ranges before relying on omitted content]'] : []),
  ].join('\n');
}

type FileDiffInput = {
  filePath: string;
  root: string;
  existed: boolean;
  previousContent: unknown;
  nextContent: unknown;
  beforeMode?: number;
  afterMode?: number;
};

type DeletedFileDiffInput = Omit<FileDiffInput, 'existed' | 'nextContent'> & { symbolicLink?: boolean };

export function patchDiffFromDiffs(diffs: FileDiff[]): LocalToolDiff | null {
  if (!diffs.length) return null;
  if (diffs.length === 1) return diffs[0];
  return projectFileDiff({
    type: 'patch_diff',
    action: 'Edited',
    path: `${diffs.length} files`,
    additions: diffs.reduce((total, diff) => total + Number(diff.additions || 0), 0),
    deletions: diffs.reduce((total, diff) => total + Number(diff.deletions || 0), 0),
    truncated: diffs.some((diff) => diff.truncated),
    diffs,
  }, 'storage') as PatchDiff;
}

export function buildFileDiff({
  filePath,
  root,
  existed,
  previousContent,
  nextContent,
  beforeMode,
  afterMode,
}: FileDiffInput): FileDiff {
  const preview = textDiffPreview(String(previousContent ?? ''), String(nextContent ?? ''));

  return {
    type: 'file_diff',
    action: existed ? 'Edited' : 'Created',
    path: workspaceRelativePath(filePath, root),
    // Persist the actual target: the project's primary directory can change later.
    absolutePath: filePath,
    ...preview,
    undo: { ...createFileChangePatch(existed ? String(previousContent ?? '') : null, String(nextContent ?? '')), beforeMode, afterMode },
  };
}

export function buildDeletedFileDiff({
  filePath,
  root,
  previousContent,
  symbolicLink,
  beforeMode,
}: DeletedFileDiffInput): FileDiff {
  if (Buffer.isBuffer(previousContent) && isProbablyBinaryFileContent(previousContent)) {
    return {
      type: 'file_diff', action: 'Deleted', path: workspaceRelativePath(filePath, root),
      absolutePath: filePath, additions: 0, deletions: 0, binary: true, truncated: false, lines: [], undo: undefined,
    };
  }
  const text = String(previousContent ?? '');
  // Deletion must keep the original bytes until encoding is checked; the missing
  // destination cannot protect a later undo from a lossy UTF-8 decode.
  const lossless = !Buffer.isBuffer(previousContent) || Buffer.from(text, 'utf8').equals(previousContent);
  return {
    type: 'file_diff', action: 'Deleted', path: workspaceRelativePath(filePath, root), absolutePath: filePath,
    ...textDiffPreview(text, ''),
    undo: symbolicLink || !lossless || beforeMode === undefined
      ? undefined
      : { ...createFileChangePatch(text, null), beforeMode },
  };
}

function textDiffPreview(previous: string, next: string): Pick<FileDiff, 'additions' | 'deletions' | 'truncated' | 'lines'> {
  const previousText = previous.replace(/\r\n?/g, '\n');
  const nextText = next.replace(/\r\n?/g, '\n');
  if (previousText === nextText) return { additions: 0, deletions: 0, truncated: false, lines: [] };
  // Trim large unchanged bodies before budgeting diff work. A small middle still
  // needs LCS so unchanged lines between separate edits are not counted as edits.
  const changed = exceedsDiffPreviewBudget(previousText, nextText)
    ? changedLineRange(previousText, nextText)
    : { previous: previousText, next: nextText, offset: 0 };
  if (exceedsDiffPreviewBudget(changed.previous, changed.next)) {
    const oldLines = splitContentLines(changed.previous, FILE_DIFF_PREVIEW_LINES);
    const newLines = splitContentLines(changed.next, FILE_DIFF_PREVIEW_LINES);
    const bounded = limitFileDiffLines(replacementDiff(oldLines, newLines, changed.offset, changed.offset));
    return { additions: contentLineCount(changed.next), deletions: contentLineCount(changed.previous), lines: bounded.lines, truncated: true };
  }
  const ops = diffLineOperations(splitContentLines(changed.previous), splitContentLines(changed.next), changed.offset);
  return {
    additions: ops.filter((line) => line.type === 'add').length,
    deletions: ops.filter((line) => line.type === 'del').length,
    ...limitFileDiffLines(compactDiffOperations(ops, DIFF_CONTEXT_LINES)),
  };
}

function exceedsDiffPreviewBudget(previous: string, next: string): boolean {
  return previous.length + next.length > 256_000 || contentLineCount(previous) + contentLineCount(next) > 10_000;
}

/** Find whole unchanged prefix/suffix lines without allocating an array for every source line. */
function changedLineRange(previous: string, next: string): { previous: string; next: string; offset: number } {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  const start = prefix === 0 ? 0 : previous.lastIndexOf('\n', prefix - 1) + 1;
  let oldEnd = previous.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  const oldBoundary = previous.indexOf('\n', oldEnd);
  const newBoundary = next.indexOf('\n', newEnd);
  const completeSuffix = (oldEnd === 0 || previous[oldEnd - 1] === '\n')
    && (newEnd === 0 || next[newEnd - 1] === '\n');
  return {
    previous: previous.slice(start, completeSuffix ? oldEnd : oldBoundary < 0 ? previous.length : oldBoundary + 1),
    next: next.slice(start, completeSuffix ? newEnd : newBoundary < 0 ? next.length : newBoundary + 1),
    offset: contentLineCount(previous.slice(0, start)),
  };
}

function contentLineCount(text: string): number {
  if (!text) return 0;
  let count = text.endsWith('\n') ? 0 : 1;
  for (let index = 0; index < text.length; index += 1) if (text.charCodeAt(index) === 10) count += 1;
  return count;
}

function splitContentLines(content: unknown, limit?: number): string[] {
  const text = String(content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return [];
  const lines = text.split('\n', limit);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function previewComparablePreviousContent(previousContent: unknown, nextContent: unknown): string {
  const nextLines = splitContentLines(nextContent);
  if (!nextLines.length) return '';
  return splitContentLines(previousContent).slice(0, nextLines.length).join('\n');
}

function diffLineOperations(previousLines: string[], nextLines: string[], offset = 0): FileDiffLine[] {
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
    .map((content, index) => contextDiffLine(content, offset + index + 1, offset + index + 1));
  const previousMiddle = previousLines.slice(prefixLength, previousEnd);
  const nextMiddle = nextLines.slice(prefixLength, nextEnd);
  const middle = previousMiddle.length * nextMiddle.length > MAX_DIFF_CELLS
    ? replacementDiff(previousMiddle, nextMiddle, offset + prefixLength, offset + prefixLength)
    : lcsDiffOperations(previousMiddle, nextMiddle, offset + prefixLength, offset + prefixLength);
  const suffix = previousLines
    .slice(previousEnd)
    .map((content, index) => contextDiffLine(content, offset + previousEnd + index + 1, offset + nextEnd + index + 1));

  return [...prefix, ...middle, ...suffix];
}

function contextDiffLine(content: string, oldLine: number, newLine: number): FileDiffLine {
  return {
    type: 'context',
    lineNumber: newLine,
    oldLine,
    newLine,
    content,
  };
}

function lcsDiffOperations(
  previousLines: string[],
  nextLines: string[],
  oldOffset = 0,
  newOffset = 0,
): FileDiffLine[] {
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

  const operations: FileDiffLine[] = [];
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

function replacementDiff(
  previousLines: string[],
  nextLines: string[],
  oldOffset = 0,
  newOffset = 0,
): FileDiffLine[] {
  return [
    ...previousLines.map((content, index) => ({
      type: 'del' as const,
      lineNumber: oldOffset + index + 1,
      oldLine: oldOffset + index + 1,
      content,
    })),
    ...nextLines.map((content, index) => ({
      type: 'add' as const,
      lineNumber: newOffset + index + 1,
      newLine: newOffset + index + 1,
      content,
    })),
  ];
}

function compactDiffOperations(operations: FileDiffLine[], contextSize: number): FileDiffLine[] {
  const changedIndexes = operations
    .map((line, index) => (line.type === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (!changedIndexes.length) return [];

  const ranges: Array<{ start: number; end: number }> = [];
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

  const compacted: FileDiffLine[] = [];
  ranges.forEach((range, index) => {
    if (index > 0) {
      const previous = ranges[index - 1];
      const gapStart = previous.end + 1;
      const gapEnd = range.start - 1;
      const gapSize = gapEnd - gapStart + 1;
      if (gapSize > DIFF_FOLD_THRESHOLD_LINES) {
        compacted.push({ type: 'gap', content: '...' });
      } else if (gapSize > 0) {
        for (let offset = gapStart; offset <= gapEnd; offset += 1) compacted.push(operations[offset]);
      }
    }
    for (let offset = range.start; offset <= range.end; offset += 1) compacted.push(operations[offset]);
  });
  return compacted;
}
