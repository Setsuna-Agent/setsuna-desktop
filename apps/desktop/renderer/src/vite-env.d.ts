/// <reference types="vite/client" />

import type { DesktopRuntimeClient, RuntimeRequestInput } from '@setsuna-desktop/contracts';

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

type DesktopUpdaterStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';

type DesktopUpdaterProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

type DesktopUpdaterState = {
  status: DesktopUpdaterStatus;
  currentVersion: string;
  platform: string;
  arch: string;
  availableVersion?: string | null;
  downloadedVersion?: string | null;
  error?: string | null;
  progress?: DesktopUpdaterProgress | null;
  canUpdate?: boolean;
  feedUrl?: string | null;
  manualInstall?: boolean;
  downloadedFilePath?: string | null;
  releaseUrl?: string | null;
  assetName?: string | null;
};

type DesktopUpdateActionResult = {
  ok: boolean;
  action: 'none' | 'opened-installer' | 'opened-folder' | 'unsupported';
  state: DesktopUpdaterState;
  error?: string;
};

type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed';
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

type DesktopReviewState = {
  isGitRepository: boolean;
  workspaceRoot: string;
  gitRoot: string | null;
  currentBranch: string | null;
  baseRef: string | null;
  baseRefs: string[];
  branchSummary: DesktopDiffSummary | null;
  stagedSummary: DesktopDiffSummary | null;
  unstagedSummary: DesktopDiffSummary | null;
};

type DesktopReviewActionResult = {
  ok: true;
  files: string[];
  state: DesktopReviewState;
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
      };
      links: {
        openExternal(url: string): Promise<boolean>;
      };
      updater: {
        getState(): Promise<DesktopUpdaterState>;
        checkForUpdates(): Promise<DesktopUpdaterState>;
        downloadUpdate(): Promise<DesktopUpdaterState>;
        quitAndInstall(): Promise<DesktopUpdateActionResult>;
        promptReadyUpdate(): Promise<DesktopUpdateActionResult>;
        onStateChange(callback: (state: DesktopUpdaterState) => void): () => void;
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
      };
      workspaceApps: {
        list(workspaceRoot: string): Promise<DesktopWorkspaceApp[]>;
        open(workspaceRoot: string, appId: string, filePath?: string | null, line?: number | null): Promise<boolean>;
      };
    };
  }
}
