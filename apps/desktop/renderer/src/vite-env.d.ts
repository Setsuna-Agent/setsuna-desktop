/// <reference types="vite/client" />

import type { DesktopRuntimeClient, RuntimeRequestInput } from '@setsuna-desktop/contracts';

type DesktopTerminalSession = {
  sessionId: string;
  workspaceRoot: string;
  shell: string;
};

type DesktopTerminalEvent = {
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
        selectDirectory(options?: { title?: string }): Promise<string | null>;
        getUserProfile(): Promise<DesktopUserProfile>;
      };
      desktopReview: {
        getState(workspaceRoot: string): Promise<DesktopReviewState>;
        discardUnstaged(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
        stageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
        unstageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
      };
      links: {
        openExternal(url: string): Promise<boolean>;
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
      workspaceApps: {
        list(workspaceRoot: string): Promise<DesktopWorkspaceApp[]>;
        open(workspaceRoot: string, appId: string, filePath?: string | null, line?: number | null): Promise<boolean>;
      };
    };
  }
}
