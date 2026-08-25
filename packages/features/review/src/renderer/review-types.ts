import type { DesktopReviewSource } from '../contracts/index.js';

export type { DesktopReviewSource } from '../contracts/index.js';
export type DesktopReviewDiffLayout = 'unified' | 'split';

export type ReviewPathContext = {
  baseRef?: string | null;
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
