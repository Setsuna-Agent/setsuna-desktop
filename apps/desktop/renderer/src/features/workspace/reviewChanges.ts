import type { DesktopReviewState } from './model.js';

export type LocalReviewChangeStats = {
  additions: number;
  deletions: number;
  fileCount: number;
};

export function localReviewChangeStats(reviewState: DesktopReviewState | null): LocalReviewChangeStats {
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const summary of [reviewState?.stagedSummary, reviewState?.unstagedSummary]) {
    if (!summary) continue;
    additions += summary.additions;
    deletions += summary.deletions;
    summary.files.forEach((file) => paths.add(file.path));
  }
  return { additions, deletions, fileCount: paths.size };
}

export function canCompareReviewBranch(reviewState: DesktopReviewState | null): boolean {
  return Boolean(reviewState?.baseRef || reviewState?.baseRefs.length);
}
