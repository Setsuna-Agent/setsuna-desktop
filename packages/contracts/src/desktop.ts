import type { RuntimeAttachmentUploadInput, RuntimeStoredMessageAttachment } from './attachments.js';
import type { RuntimeEventBatch } from './events.js';
import type { RuntimeRequestInput } from './http.js';
import type { RuntimePluginInstallResult } from './plugins.js';
import type { RuntimeInterfaceLanguage } from './config.js';
import type {
  DesktopDataMigrationPlan,
  DesktopDataRootActionResult,
  DesktopDataRootRetainedBackupInspection,
  DesktopDataRootState,
} from './data-root.js';

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

export type DesktopUserProfile = {
  username: string;
  displayName: string;
  homeDir: string | null;
  shell: string | null;
  hostName: string | null;
};

export type DesktopRuntimeBridge = {
  request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
  cancelRequest(requestId: string): Promise<boolean>;
  linkAttachment(file: File): Promise<RuntimeStoredMessageAttachment | null>;
  uploadAttachment(input: RuntimeAttachmentUploadInput): Promise<RuntimeStoredMessageAttachment>;
  readAttachmentImage(threadId: string, assetId: string): Promise<DesktopImageDataResult>;
  startSse(threadId: string, sinceSeq: number | undefined, onBatch: (batch: RuntimeEventBatch) => void): () => void;
};

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
};

export type DesktopWindowCloseBehavior = 'quit' | 'hide-to-tray';

/** 向渲染进程暴露的有限预加载 API 所使用的共享契约。 */
export type SetsunaDesktopBridge = {
  desktop: {
    platform: string;
    setInterfaceLanguage(locale: RuntimeInterfaceLanguage): Promise<boolean>;
    setActiveKeyboardShortcutBindings(bindings: readonly string[]): Promise<boolean>;
    setKeyboardShortcutRecording(recording: boolean): Promise<boolean>;
    onKeyboardShortcutInput(callback: (input: DesktopKeyboardShortcutInput) => void): () => void;
    selectDirectory(options?: { title?: string }): Promise<string | null>;
    getUserProfile(): Promise<DesktopUserProfile>;
    copyImageToClipboard(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    readImageAsset(assetId: string): Promise<DesktopImageDataResult>;
    revealImageInFolder(input: DesktopImageInput): Promise<DesktopImageActionResult>;
    openPath(targetPath: string): Promise<DesktopOpenPathResult>;
    openWorkspaceDirectory(workspaceRoot: string, directoryPath: string): Promise<DesktopOpenPathResult>;
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
  links: {
    openExternal(url: string): Promise<boolean>;
  };
  plugins: {
    /** Opens the native directory picker and installs the selected local Plugin Bundle. */
    installLocal(): Promise<RuntimePluginInstallResult | null>;
  };
  runtime: DesktopRuntimeBridge;
  windowControls: {
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
