import type { RuntimeAttachmentUploadInput, RuntimeStoredMessageAttachment } from './attachments.js';
import type { DesktopBrowserDeviceEmulation, DesktopBrowserScreenshot } from './browser-control.js';
import type { RuntimeEvent } from './events.js';
import type { RuntimeRequestInput } from './http.js';
import type { RuntimeInterfaceLanguage } from './config.js';
import type {
  DesktopDataMigrationPlan,
  DesktopDataRootActionResult,
  DesktopDataRootRetainedBackupInspection,
  DesktopDataRootState,
} from './data-root.js';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateState,
} from './updater.js';

export type DesktopOpenPathResult =
  | { ok: true }
  | { ok: false; error: string };

export type DesktopWorkspaceFilePreviewResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type DesktopImageActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type DesktopImageInput = {
  assetId?: string;
  dataUrl?: string;
  name: string;
};

export type DesktopImageDataResult =
  | { ok: true; data: Uint8Array; type: string }
  | { ok: false; error: string };

export type DesktopTerminalSession = {
  sessionId: string;
  workspaceRoot: string;
  shell: string;
};

export type DesktopTerminalEvent = {
  seq: number;
  event: 'ready' | 'output' | 'exit' | 'closed' | 'error';
  data: Record<string, unknown>;
};

export type DesktopTerminalEventPayload = DesktopTerminalEvent & {
  sessionId: string;
};

export type DesktopWorkspaceApp = {
  id: string;
  label: string;
  icon: string;
};

export type DesktopUserProfile = {
  username: string;
  displayName: string;
  homeDir: string | null;
  shell: string | null;
  hostName: string | null;
};

export type DesktopDiffLine = {
  type: 'context' | 'added' | 'removed' | 'gap';
  lineNumber: number;
  oldLine?: number;
  newLine?: number;
  content: string;
};

export type DesktopDiffFile = {
  path: string;
  action: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  lines: DesktopDiffLine[];
};

export type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
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

export type DesktopRuntimeBridge = {
  request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
  uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment>;
  startSse(threadId: string, sinceSeq: number | undefined, onEvent: (event: RuntimeEvent) => void): () => void;
};

/** 向渲染进程暴露的有限预加载 API 所使用的共享契约。 */
export type SetsunaDesktopBridge = {
  browser: {
    captureScreenshot(tabId: string): Promise<DesktopBrowserScreenshot | null>;
    resolveFavicon(webContentsId: number, faviconUrls: readonly string[]): Promise<string | null>;
    registerTab(tabId: string, webContentsId: number): Promise<boolean>;
    unregisterTab(tabId: string, webContentsId: number): Promise<boolean>;
    setActiveTab(tabId: string | null): Promise<boolean>;
    setDeviceEmulation(tabId: string, emulation: DesktopBrowserDeviceEmulation | null): Promise<boolean>;
    onOpenNewTab(callback: (request: { openerWebContentsId: number; url: string }) => void): () => void;
  };
  desktop: {
    platform: string;
    setInterfaceLanguage(locale: RuntimeInterfaceLanguage): Promise<boolean>;
    selectDirectory(options?: { title?: string }): Promise<string | null>;
    getUserProfile(): Promise<DesktopUserProfile>;
    copyImageToClipboard(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    readImageAsset(assetId: string): Promise<DesktopImageDataResult>;
    revealImageInFolder(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    openPath(targetPath: string): Promise<DesktopOpenPathResult>;
    openWorkspaceFile(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    copyWorkspaceFilePath(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    revealWorkspaceFile(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    createWorkspaceFilePreview(workspaceRoot: string, filePath: string): Promise<DesktopWorkspaceFilePreviewResult>;
  };
  dataRoot: {
    getState(): Promise<DesktopDataRootState>;
    scanTarget(targetRoot: string): Promise<DesktopDataMigrationPlan>;
    beginMigration(planId: string): Promise<DesktopDataRootActionResult>;
    runMigration(): Promise<DesktopDataRootActionResult>;
    cancelMigration(): Promise<DesktopDataRootActionResult>;
    retryStartup(): Promise<DesktopDataRootActionResult>;
    restorePreviousRoot(): Promise<DesktopDataRootActionResult>;
    inspectRetainedBackup(backupId: string): Promise<DesktopDataRootRetainedBackupInspection>;
    deleteRetainedBackup(backupId: string): Promise<DesktopDataRootActionResult>;
    dismissRetainedBackups(backupIds: string[]): Promise<DesktopDataRootActionResult>;
    onStateChange(callback: (state: DesktopDataRootState) => void): () => void;
  };
  desktopReview: {
    getState(workspaceRoot: string, options?: DesktopReviewStateOptions): Promise<DesktopReviewState>;
    discardUnstaged(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
    stageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
    unstageFiles(workspaceRoot: string, filePaths: string[]): Promise<DesktopReviewActionResult>;
    checkoutBranch(workspaceRoot: string, branchName: string): Promise<DesktopReviewState>;
    createBranch(workspaceRoot: string, branchName: string, options?: DesktopReviewCreateBranchOptions): Promise<DesktopReviewState>;
    commit(workspaceRoot: string, input: DesktopReviewCommitInput): Promise<DesktopReviewCommitResult>;
    push(workspaceRoot: string): Promise<DesktopReviewPushResult>;
    generateCommitMessage(workspaceRoot: string, input?: { includeUnstaged?: boolean }): Promise<DesktopReviewGeneratedCommitMessage>;
  };
  links: {
    openExternal(url: string): Promise<boolean>;
  };
  runtime: DesktopRuntimeBridge;
  terminal: {
    open(workspaceRoot?: string | null, cols?: number, rows?: number): Promise<DesktopTerminalSession>;
    write(sessionId: string, input: string): Promise<boolean>;
    read(sessionId: string): Promise<DesktopTerminalEvent[]>;
    resize(sessionId: string, cols: number, rows: number): Promise<boolean>;
    restart(sessionId: string, cols?: number, rows?: number): Promise<boolean>;
    close(sessionId: string): Promise<boolean>;
    onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void;
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
