import type { DesktopDiffFile } from './model.js';

export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';
export type DesktopReviewDiffLayout = 'unified' | 'split';

export type ReviewPathContext = {
  source: DesktopReviewSource;
  workspaceRoot?: string | null;
  gitRoot?: string | null;
};

export type HighlightedReviewDiffLine = {
  highlighted?: string;
  key: string;
  line: DesktopDiffFile['lines'][number];
};

export type SplitReviewDiffRow = {
  key: string;
  oldLine: HighlightedReviewDiffLine | null;
  newLine: HighlightedReviewDiffLine | null;
};

export type WholeFileReviewChange = 'added' | 'removed';

export type ReviewFileExpansionRequest = {
  expanded: boolean;
  version: number;
};

export type BranchCompareRefOption = {
  value: string;
  label: string;
};
