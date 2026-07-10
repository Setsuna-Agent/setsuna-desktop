/// <reference types="vite/client" />

import type {
  DesktopRuntimeClient,
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateState,
  RuntimeRequestInput,
} from '@setsuna-desktop/contracts';

type DesktopTerminalSession = {
  sessionId: string;
  workspaceRoot: string;
  shell: string;
};

type DesktopTerminalEvent = {
  seq: number;
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Record<string, unknown>;
};

type DesktopWorkspaceApp = {
  id: string;
  label: string;
  icon: string;
};

type DesktopUserProfile = {
  username: string;
  displayName: string;
  homeDir: string | null;
  shell: string | null;
  hostName: string | null;
};

type DesktopOpenPathResult = { ok: true } | { ok: false; error: string };

type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed' | 'gap';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

type DesktopDiffFile = {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: DesktopDiffLine[];
};

type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
};

type DesktopReviewBranch = {
  name: string;
  current: boolean;
  remote: boolean;
  uncommittedFiles: number;
};

type DesktopReviewState = {
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

type DesktopReviewActionResult = {
  ok: true;
  files: string[];
  state: DesktopReviewState;
};

type DesktopReviewCommitResult = {
  ok: true;
  commitHash: string;
  pushed: boolean;
  state: DesktopReviewState;
};

type DesktopReviewPushResult = {
  ok: true;
  pushed: true;
  state: DesktopReviewState;
};

type DesktopReviewGeneratedCommitMessage = {
  message: string;
};

declare global {
  interface Window {
    setsunaDesktop?: {
      desktop: {
        platform: string;
        selectDirectory(options?: { title?: string }): Promise<string | null>;
        getUserProfile(): Promise<DesktopUserProfile>;
        openPath(targetPath: string): Promise<DesktopOpenPathResult>;
      };
      desktopReview: {
        getState(workspaceRoot: string, options?: { baseRef?: string | null }): Promise<DesktopReviewState>;
        discardUnstaged(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
        stageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
        unstageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
        checkoutBranch(workspaceRoot: string, branchName: string): Promise<DesktopReviewState>;
        createBranch(workspaceRoot: string, branchName: string, options?: { allowUnstaged?: boolean }): Promise<DesktopReviewState>;
        commit(workspaceRoot: string, input: { includeUnstaged?: boolean; message: string; push?: boolean }): Promise<DesktopReviewCommitResult>;
        push(workspaceRoot: string): Promise<DesktopReviewPushResult>;
        generateCommitMessage(workspaceRoot: string, input?: { includeUnstaged?: boolean }): Promise<DesktopReviewGeneratedCommitMessage>;
      };
      links: {
        openExternal(url: string): Promise<boolean>;
      };
      updater: {
        getState(): Promise<DesktopUpdateState>;
        checkForUpdates(): Promise<DesktopUpdateState>;
        downloadUpdate(): Promise<DesktopUpdateState>;
        addDownloadSource(input: DesktopUpdateDownloadSourceInput): Promise<DesktopUpdateState>;
        selectDownloadSource(sourceId: string): Promise<DesktopUpdateState>;
        removeDownloadSource(sourceId: string): Promise<DesktopUpdateState>;
        quitAndInstall(): Promise<DesktopUpdateActionResult>;
        promptReadyUpdate(): Promise<DesktopUpdateActionResult>;
        onStateChange(callback: (state: DesktopUpdateState) => void): () => void;
      };
      runtime: Pick<DesktopRuntimeClient, 'subscribeEvents'> & {
        request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
        startSse: DesktopRuntimeClient['subscribeEvents'];
      };
      terminal: {
        open(workspaceRoot?: string | null, cols?: number, rows?: number): Promise<DesktopTerminalSession>;
        write(sessionId: string, input: string): Promise<boolean>;
        read(sessionId: string): Promise<DesktopTerminalEvent[]>;
        resize(sessionId: string, cols: number, rows: number): Promise<boolean>;
        close(sessionId: string): Promise<boolean>;
        onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void;
      };
      windowControls: {
        minimize(): Promise<boolean>;
        toggleMaximize(): Promise<boolean>;
        close(): Promise<boolean>;
        isMaximized(): Promise<boolean>;
        onMaximizedChange(callback: (maximized: boolean) => void): () => void;
        setTitlebarScale(scale: number): Promise<boolean>;
      };
      workspaceApps: {
        list(workspaceRoot: string): Promise<DesktopWorkspaceApp[]>;
        open(workspaceRoot: string, appId: string, filePath?: string | null, line?: number | null): Promise<boolean>;
      };
    };
  }
}
