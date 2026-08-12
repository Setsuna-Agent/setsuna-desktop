import {
  FILE_MUTATION_TOOL_NAMES,
  SHELL_TOOL_NAMES,
  normalizeRuntimeReviewNotice,
  type DesktopDiffFile,
  type DesktopDiffSummary,
  type RuntimeMessage,
  type RuntimeReviewFinding,
  type RuntimeReviewModeNotice,
} from '@setsuna-desktop/contracts';
import { normalizeReviewFocusPath } from './review-paths.js';

export function latestCompletedReview(
  messages: RuntimeMessage[],
): RuntimeReviewModeNotice | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.toolRuns?.some((run) => (
      run.status === 'success'
      && (FILE_MUTATION_TOOL_NAMES.has(run.name) || SHELL_TOOL_NAMES.has(run.name))
    ))) return null;

    const notice = message?.reviewMode;
    if (!notice) continue;
    return notice.kind === 'exited' ? normalizeRuntimeReviewNotice(notice) : null;
  }
  return null;
}

export function reviewPathsMatch(leftPath: string, rightPath: string): boolean {
  const left = normalizeReviewFocusPath(leftPath)?.toLowerCase();
  const right = normalizeReviewFocusPath(rightPath)?.toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  // Provider output and git patches may disagree about a workspace prefix or
  // the conventional a/ and b/ diff prefixes. A segment boundary keeps the
  // fallback from matching unrelated names such as src/a.ts and test-a.ts.
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

export type ReviewFindingAnnotationAnchor = {
  lineNumber: number;
  side: 'additions' | 'deletions';
};

export type ReviewFindingTarget = {
  anchor: ReviewFindingAnnotationAnchor | null;
  file: DesktopDiffFile | null;
  finding: RuntimeReviewFinding;
  key: string;
};

export function reviewFindingKey(finding: RuntimeReviewFinding): string {
  return JSON.stringify([
    normalizeReviewFocusPath(finding.path) ?? finding.path.trim(),
    finding.startLine,
    finding.endLine ?? null,
    finding.priority,
    finding.title,
    finding.body,
  ]);
}

/** Resolve the file and the exact Pierre line anchor once for all consumers. */
export function resolveReviewFindingTarget(
  summary: DesktopDiffSummary | null,
  finding: RuntimeReviewFinding,
): ReviewFindingTarget {
  const normalizedFindingPath = normalizeReviewFocusPath(finding.path);
  const files = summary?.files ?? [];
  const exactFile = normalizedFindingPath
    ? files.find((candidate) => (
      normalizeReviewFocusPath(candidate.path) === normalizedFindingPath
    ))
    : null;
  const suffixFile = exactFile
    ? null
    : uniqueReviewFile(files, (candidate) => (
        reviewPathsMatch(candidate.path, finding.path)
      ));
  const file = exactFile ?? suffixFile;
  return {
    anchor: file ? reviewFindingAnnotationAnchor(file, finding) : null,
    file,
    finding,
    key: reviewFindingKey(finding),
  };
}

function uniqueReviewFile(
  files: DesktopDiffFile[],
  predicate: (file: DesktopDiffFile) => boolean,
): DesktopDiffFile | null {
  let match: DesktopDiffFile | null = null;
  for (const file of files) {
    if (!predicate(file)) continue;
    if (match) return null;
    match = file;
  }
  return match;
}

export function resolveReviewFindingTargets(
  summary: DesktopDiffSummary | null,
  findings: RuntimeReviewFinding[],
): ReviewFindingTarget[] {
  return findings.map((finding) => (
    resolveReviewFindingTarget(summary, finding)
  ));
}

/**
 * Pierre can only render annotations on lines retained in the current patch.
 * Reviews may cite a range endpoint hidden by diff context, so fall back to the
 * nearest visible line in that file instead of silently dropping the comment.
 */
export function reviewFindingAnnotationAnchor(
  file: DesktopDiffFile,
  finding: RuntimeReviewFinding,
): ReviewFindingAnnotationAnchor | null {
  const target = finding.endLine ?? finding.startLine;
  const rangeStart = Math.min(finding.startLine, finding.endLine ?? finding.startLine);
  const rangeEnd = Math.max(finding.startLine, finding.endLine ?? finding.startLine);
  const candidates: ReviewFindingAnnotationAnchor[] = [];
  for (const line of file.lines) {
    if (line.type === 'gap') continue;
    if (line.type !== 'removed') {
      candidates.push({
        lineNumber: line.newLine ?? line.lineNumber,
        side: 'additions',
      });
      continue;
    }
    candidates.push({
      lineNumber: line.oldLine ?? line.lineNumber,
      side: 'deletions',
    });
  }
  if (!candidates.length) return null;

  const inRange = candidates.filter(({ lineNumber }) => (
    lineNumber >= rangeStart && lineNumber <= rangeEnd
  ));
  const pool = inRange.length ? inRange : candidates;
  return pool.reduce((closest, candidate) => {
    const candidateDistance = Math.abs(candidate.lineNumber - target);
    const closestDistance = Math.abs(closest.lineNumber - target);
    if (candidateDistance < closestDistance) return candidate;
    if (candidateDistance > closestDistance) return closest;
    return candidate.side === 'additions' && closest.side === 'deletions'
      ? candidate
      : closest;
  });
}
