import type { RuntimeAttachmentUploadInput, RuntimeStoredMessageAttachment } from './attachments.js';
import type { RuntimeEventBatch } from './events.js';
import type { RuntimeRequestInput } from './http.js';
import type { RuntimeInterfaceLanguage } from './config.js';
import type { SandboxDialogSession } from './desktop/sandbox-dialogs.js';
import type {
  DesktopDataMigrationPlan,
  DesktopDataRootActionResult,
  DesktopDataRootRetainedBackupInspection,
  DesktopDataRootState,
} from './data-root.js';

export type DesktopOpenPathResult =
  | { ok: true }
  | { ok: false; error: string };

export type DesktopApplicationMenuItem =
  | { type: 'separator' }
  | { type: 'command'; id: string; label: string; enabled: boolean }
  | { type: 'edit'; role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'; label: string };

export type DesktopApplicationMenuInput = {
  x: number;
  y: number;
  items: DesktopApplicationMenuItem[];
};

export const DESKTOP_CLIPBOARD_WRITE_PATH = '/v1/clipboard/write-text';

export type DesktopClipboardWriteInput = Readonly<{ text: string }>;

export type DesktopWorkspaceFilePreviewResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type DesktopWorkspaceEntriesWatchInput = {
  subscriptionId: string;
  workspaceRoot: string;
  directoryPaths: string[];
};

export const WORKSPACE_ENTRIES_WATCH_CHANNELS = {
  subscribe: 'desktop:watch-workspace-entries',
  unsubscribe: 'desktop:unwatch-workspace-entries',
  changed: 'desktop:workspace-entries-changed',
} as const;

export type DesktopImageActionResult =
  | { ok: true; cancelled?: boolean }
  | { ok: false; error: string };

export type DesktopImageInput = {
  attachment?: { threadId: string; assetId: string };
  assetId?: string;
  dataUrl?: string;
  name: string;
};

export type DesktopImageDataResult =
  | { ok: true; data: Uint8Array; type: string }
  | { ok: false; error: string };

export type DesktopUserProfile = {
  username: string;
  displayName: string;
  homeDir: string | null;
  shell: string | null;
  hostName: string | null;
};

export type DesktopRuntimeBridge = {
  onThreadDeletionCheck(
    check: () => DesktopThreadDeletionState,
    finished: (result: DesktopThreadDeletionFinished) => void,
  ): () => void;
  request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
  cancelRequest(requestId: string): Promise<boolean>;
  linkAttachment(file: File): Promise<RuntimeStoredMessageAttachment | null>;
  uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment>;
  readAttachmentImage(threadId: string, assetId: string): Promise<DesktopImageDataResult>;
  startSse(threadId: string, sinceSeq: number | undefined, onBatch: (batch: RuntimeEventBatch) => void): () => void;
};

export const THREAD_DELETION_CHANNELS = {
  check: 'runtime:thread-deletion-check',
  checked: 'runtime:thread-deletion-checked',
  finished: 'runtime:thread-deletion-finished',
} as const;

export type DesktopThreadDeletionState = {
  threadId: string | null;
  dirty: boolean;
  busy: boolean;
};

export type DesktopThreadDeletionFinished = { deletedThreadIds: string[] };
export const DESKTOP_THREAD_DELETE_PATH = '/v1/threads/delete';
export type DesktopThreadDeletionInput = Readonly<{ threadId: string }>;
export type DesktopThreadDeletionResult = { ok: true; cancelled?: false } | { cancelled: true; ok?: false };

export type DesktopRuntimeEventPayload =
  | {
    batch: RuntimeEventBatch;
    error?: never;
    subscriptionId: string;
  }
  | {
    batch?: never;
    error: string;
    subscriptionId: string;
  };

export type DesktopKeyboardShortcutInput = {
  altGraph: boolean;
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
  source?: {
    kind: 'embedded-browser';
    tabId: string | null;
  };
};

export type DesktopWindowCloseBehavior = 'quit' | 'hide-to-tray';

/** 向渲染进程暴露的有限预加载 API 所使用的共享契约。 */
export type SetsunaDesktopBridge = {
  desktop: {
    createSandboxDialogSession(title: string): Promise<SandboxDialogSession>;
    updateSandboxDialogSession(id: string, title: string): Promise<void>;
    releaseSandboxDialogSession(id: string): Promise<void>;
    platform: string;
    /** Resolves once main has prepared the services required by renderer initialization. */
    whenReady(): Promise<void>;
    setInterfaceLanguage(locale: RuntimeInterfaceLanguage): Promise<boolean>;
    setActiveKeyboardShortcutBindings(bindings: readonly string[]): Promise<boolean>;
    setKeyboardShortcutRecording(recording: boolean): Promise<boolean>;
    onKeyboardShortcutInput(callback: (input: DesktopKeyboardShortcutInput) => void): () => void;
    selectDirectory(options?: { title?: string }): Promise<string | null>;
    getUserProfile(): Promise<DesktopUserProfile>;
    copyImageToClipboard(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    readImageAsset(assetId: string): Promise<DesktopImageDataResult>;
    revealImageInFolder(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    saveImageAs(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    openPath(targetPath: string): Promise<DesktopOpenPathResult>;
    openWorkspaceDirectory(workspaceRoot: string, directoryPath: string): Promise<DesktopOpenPathResult>;
    openWorkspaceFile(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    copyWorkspaceFilePath(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    revealWorkspaceFile(workspaceRoot: string, filePath: string): Promise<DesktopOpenPathResult>;
    createWorkspaceFilePreview(workspaceRoot: string, filePath: string): Promise<DesktopWorkspaceFilePreviewResult>;
    watchWorkspaceEntries(workspaceRoot: string, directoryPaths: string[], callback: () => void): () => void;
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
  links: {
    openExternal(url: string): Promise<boolean>;
  };
  runtime: DesktopRuntimeBridge;
  windowControls: {
    showApplicationMenu(input: DesktopApplicationMenuInput): Promise<string | null>;
    openThread(threadId: string): Promise<void>;
    getInitialThreadId(): Promise<string | null>;
    minimize(): Promise<boolean>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<boolean>;
    getCloseBehavior(): Promise<DesktopWindowCloseBehavior>;
    setCloseBehavior(behavior: DesktopWindowCloseBehavior): Promise<DesktopWindowCloseBehavior>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(callback: (maximized: boolean) => void): () => void;
    setTitlebarScale(scale: number): Promise<boolean>;
  };
};
