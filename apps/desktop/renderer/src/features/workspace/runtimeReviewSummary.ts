import { resolveWorkspaceFileReference, workspaceProjectRoots, type RuntimeMessage, type WorkspaceProject } from '@setsuna-desktop/contracts';
import {
  latestFileChangeSummaryFromMessages,
  type RuntimeFileChange,
  type RuntimeFileChangeSummary,
  type RuntimeFileDiffLine,
} from '../chat/tool-runs/runtimeFileChanges.js';
import type {
  DesktopDiffFile,
  DesktopDiffLine,
  DesktopDiffSummary,
} from '@setsuna-desktop/feature-review/contracts';

export function latestDesktopReviewSummaryFromMessages(messages: RuntimeMessage[]): DesktopDiffSummary | null {
  return desktopDiffSummaryFromRuntimeFileChanges(latestFileChangeSummaryFromMessages(messages));
}

/** Tool paths are relative to the primary cwd; each panel projects them into its own directory. */
export function scopeReviewPaths<T extends { path: string }>(items: T[], project: WorkspaceProject, rootId: string): T[] {
  const roots = workspaceProjectRoots(project);
  const root = roots.find((item) => item.id === rootId);
  if (!root) return [];
  return items.flatMap((item) => {
    const absolutePath = /^(?:[\\/]|[a-zA-Z]:[\\/])/u.test(item.path)
      ? item.path : `${roots[0].path}/${item.path}`;
    const reference = resolveWorkspaceFileReference({ ...project, roots: [root] }, absolutePath);
    return reference ? [{ ...item, path: reference.path }] : [];
  });
}

export function scopeReviewSummary(summary: DesktopDiffSummary | null, project: WorkspaceProject, rootId: string): DesktopDiffSummary | null {
  if (!summary) return null;
  const files = scopeReviewPaths(summary.files, project, rootId);
  return files.length ? { files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  } : null;
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
