export type DesktopReviewSource = 'unstaged' | 'staged' | 'branch' | 'latest';
export type DesktopReviewDiffLayout = 'unified' | 'split';

export type ReviewPathContext = {
  source: DesktopReviewSource;
  workspaceRoot?: string | null;
  gitRoot?: string | null;
};

export type ReviewFileExpansionRequest = {
  expanded: boolean;
  version: number;
};

export type BranchCompareRefOption = {
  value: string;
  label: string;
};
