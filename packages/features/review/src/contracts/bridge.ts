import type { DesktopDiffSummary } from '@setsuna-desktop/contracts';

export type DesktopReviewImagePreviewResult =
  | { ok: true; previewId: string; url: string }
  | { ok: false; error: string };

export type DesktopReviewImagePreviewInput = {
  baseRef?: string | null;
  filePath: string;
  side: 'before' | 'after';
  source: 'unstaged' | 'staged' | 'branch' | 'latest';
};

export type DesktopReviewBranch = {
  name: string;
  current: boolean;
  remote: boolean;
  uncommittedFiles: number;
};

export type DesktopReviewState = {
  isGitRepository: boolean;
  workspaceRoot: string;
  gitRoot: string | null;
  currentBranch: string | null;
  currentRemoteRef: string | null;
  baseRef: string | null;
  baseRefs: string[];
  branches: DesktopReviewBranch[];
  currentRemoteSummary: DesktopDiffSummary | null;
  branchSummary: DesktopDiffSummary | null;
  stagedSummary: DesktopDiffSummary | null;
  unstagedSummary: DesktopDiffSummary | null;
};

export type DesktopReviewStateOptions = {
  baseRef?: string | null;
  /** Branch comparisons are expensive and are only needed while that source is visible. */
  includeBranchSummary?: boolean;
};

export type DesktopReviewChangeEvent = {
  subscriptionId: string;
};

export type DesktopReviewCommitInput = {
  includeUnstaged?: boolean;
  message: string;
  push?: boolean;
};

export type DesktopReviewCreateBranchOptions = {
  allowUnstaged?: boolean;
};

export type DesktopReviewActionResult = {
  ok: true;
  files: string[];
  state: DesktopReviewState;
};

export type DesktopReviewCommitResult = {
  ok: true;
  commitHash: string;
  pushed: boolean;
  pushError?: string;
  state: DesktopReviewState;
};

export type DesktopReviewPushResult = {
  ok: true;
  pushed: true;
  state: DesktopReviewState;
};

export type DesktopReviewGeneratedCommitMessage = {
  message: string;
};

export type DesktopCommitMessageGenerationSource = {
  branch: string | null;
  status: string;
  diff: string;
};

export interface DesktopReviewBridge {
  getState(workspaceRoot: string, options?: DesktopReviewStateOptions): Promise<DesktopReviewState>;
  createImagePreview(workspaceRoot: string, input: DesktopReviewImagePreviewInput): Promise<DesktopReviewImagePreviewResult>;
  releaseImagePreview(previewId: string): Promise<boolean>;
  watchChanges(workspaceRoot: string, callback: () => void): () => void;
  discardUnstaged(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
  stageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
  unstageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
  checkoutBranch(workspaceRoot: string, branchName: string): Promise<DesktopReviewState>;
  createBranch(workspaceRoot: string, branchName: string, options?: DesktopReviewCreateBranchOptions): Promise<DesktopReviewState>;
  commit(workspaceRoot: string, input: DesktopReviewCommitInput): Promise<DesktopReviewCommitResult>;
  push(workspaceRoot: string): Promise<DesktopReviewPushResult>;
  generateCommitMessage(workspaceRoot: string, input?: { includeUnstaged?: boolean }): Promise<DesktopReviewGeneratedCommitMessage>;
}

export type ReviewPreloadBridgeContribution = Readonly<{
  desktopReview: DesktopReviewBridge;
}>;

export const REVIEW_IPC_CHANNELS = Object.freeze({
  getState: 'desktop-review:get-state',
  createImagePreview: 'desktop-review:create-image-preview',
  releaseImagePreview: 'desktop-review:release-image-preview',
  subscribeChanges: 'desktop-review:subscribe-changes',
  unsubscribeChanges: 'desktop-review:unsubscribe-changes',
  discardUnstaged: 'desktop-review:discard-unstaged',
  stageFiles: 'desktop-review:stage-files',
  unstageFiles: 'desktop-review:unstage-files',
  checkoutBranch: 'desktop-review:checkout-branch',
  createBranch: 'desktop-review:create-branch',
  commit: 'desktop-review:commit',
  push: 'desktop-review:push',
  generateCommitMessage: 'desktop-review:generate-commit-message',
  changed: 'desktop-review:changed',
} as const);
