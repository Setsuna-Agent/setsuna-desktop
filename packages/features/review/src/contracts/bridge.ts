import type { RuntimeConfiguredModelReference } from '@setsuna-desktop/contracts';
import type { DesktopDiffFile, DesktopDiffSummary } from './diff.js';
import type { DesktopGitCommitDetails, DesktopGitCommitFileInput, DesktopGitHistoryOptions, DesktopGitHistoryPage } from './history.js';

export type DesktopReviewImagePreviewResult =
  | { ok: true; previewId: string; url: string }
  | { ok: false; error: string };

export type DesktopReviewImagePreviewInput = {
  baseRef?: string | null;
  filePath: string;
  side: 'before' | 'after';
  source: 'unstaged' | 'staged' | 'branch' | 'latest' | 'commit';
  /** Fixed historical object pair; independent of the current worktree and index. */
  revisions?: { before: string | null; after: string };
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
  /** Stage all working changes only when explicitly requested; defaults to the existing index. */
  includeUnstaged?: boolean;
  message: string;
  push?: boolean;
  sync?: boolean;
  /** Amend only the commit and branch whose message the user edited. */
  amend?: Pick<DesktopReviewCommitMessage, 'oid' | 'branch'>;
};

export type DesktopReviewCommitMessage = {
  oid: string;
  branch: string | null;
  message: string;
  /** Author/date and Git's amend preview, rendered as comments in COMMIT_EDITMSG. */
  context: string;
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
  synced?: boolean;
  syncError?: string;
  state: DesktopReviewState;
};

export type DesktopReviewPushResult = {
  ok: true;
  pushed: true;
  state: DesktopReviewState;
};

export type DesktopReviewPullResult = {
  ok: true;
  pulled: true;
  state: DesktopReviewState;
};

export type DesktopReviewPullOptions = {
  /** Explicit rebase pulls always enable Git's autostash. */
  rebase?: boolean;
};

export type DesktopReviewGeneratedCommitMessage = {
  message: string;
};

export type DesktopCommitMessageGenerationSource = {
  recentMessages?: readonly string[];
  /** Current conversation model, used when no dedicated generation model is configured. */
  modelSelection?: RuntimeConfiguredModelReference;
  branch: string | null;
  status: string;
  diff: string;
};

export interface DesktopReviewBridge {
  getHistory(workspaceRoot: string, options?: DesktopGitHistoryOptions): Promise<DesktopGitHistoryPage>;
  getCommitDetails(workspaceRoot: string, oid: string): Promise<DesktopGitCommitDetails>;
  /** Optional GitHub author image; resolved independently of local commit details. */
  getCommitAuthorAvatar(githubCommitUrl: string): Promise<string | null>;
  getCommitFileDiff(workspaceRoot: string, input: DesktopGitCommitFileInput): Promise<DesktopDiffFile>;
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
  getCommitMessage(workspaceRoot: string): Promise<DesktopReviewCommitMessage>;
  push(workspaceRoot: string): Promise<DesktopReviewPushResult>;
  pull(workspaceRoot: string, options?: DesktopReviewPullOptions): Promise<DesktopReviewPullResult>;
  generateCommitMessage(workspaceRoot: string, input?: { includeUnstaged?: boolean; modelSelection?: RuntimeConfiguredModelReference }, onProgress?: (message: string) => void): Promise<DesktopReviewGeneratedCommitMessage>;
}

export type ReviewPreloadBridgeContribution = Readonly<{
  desktopReview: DesktopReviewBridge;
}>;

export const REVIEW_IPC_CHANNELS = Object.freeze({
  getHistory: 'desktop-review:get-history',
  getCommitDetails: 'desktop-review:get-commit-details',
  getCommitAuthorAvatar: 'desktop-review:get-commit-author-avatar',
  getCommitFileDiff: 'desktop-review:get-commit-file-diff',
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
  getCommitMessage: 'desktop-review:get-commit-message',
  push: 'desktop-review:push',
  pull: 'desktop-review:pull',
  generateCommitMessage: 'desktop-review:generate-commit-message',
  commitMessageProgress: 'desktop-review:commit-message-progress',
  changed: 'desktop-review:changed',
} as const);
