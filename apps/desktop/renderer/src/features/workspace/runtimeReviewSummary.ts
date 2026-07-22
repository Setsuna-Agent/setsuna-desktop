import type { RuntimeMessage } from '@setsuna-desktop/contracts';
import {
  latestFileChangeSummaryFromMessages,
  type RuntimeFileChange,
  type RuntimeFileChangeSummary,
  type RuntimeFileDiffLine,
} from '../chat/tool-runs/runtimeFileChanges.js';
import type { DesktopDiffFile, DesktopDiffLine, DesktopDiffSummary } from './model.js';

export function latestDesktopReviewSummaryFromMessages(messages: RuntimeMessage[]): DesktopDiffSummary | null {
  return desktopDiffSummaryFromRuntimeFileChanges(latestFileChangeSummaryFromMessages(messages));
}

export function desktopDiffSummaryFromRuntimeFileChanges(summary: RuntimeFileChangeSummary | null): DesktopDiffSummary | null {
  if (!summary?.files.length) return null;
  const files = summary.files.map(desktopDiffFileFromRuntimeChange);
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

function desktopDiffFileFromRuntimeChange(file: RuntimeFileChange): DesktopDiffFile {
  return {
    path: file.path,
    action: file.action || 'Modified',
    additions: file.additions,
    deletions: file.deletions,
    truncated: file.truncated,
    lines: file.lines.map(desktopDiffLineFromRuntimeLine),
  };
}

function desktopDiffLineFromRuntimeLine(line: RuntimeFileDiffLine, index: number): DesktopDiffLine {
  return {
    type: line.type === 'added' ? 'added' : line.type === 'removed' ? 'removed' : line.type === 'gap' ? 'gap' : 'context',
    lineNumber: line.lineNumber ?? index + 1,
    oldLine: line.oldLine,
    newLine: line.newLine,
    content: line.content,
  };
}
