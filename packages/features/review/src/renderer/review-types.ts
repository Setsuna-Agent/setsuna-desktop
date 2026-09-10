import type { DesktopReviewSource } from '../contracts/index.js';

export type { DesktopReviewSource } from '../contracts/index.js';
export type DesktopReviewDiffLayout = 'unified' | 'split';

export type ReviewPathContext = {
  revisions?: { before: string | null; after: string };
  baseRef?: string | null;
  source: DesktopReviewSource | 'commit';
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
