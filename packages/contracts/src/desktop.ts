import type { RuntimeAttachmentUploadInput, RuntimeStoredMessageAttachment } from './attachments.js';
import type { RuntimeEventBatch } from './events.js';
import type { RuntimeRequestInput } from './http.js';
import type { RuntimePluginInstallResult } from './plugins.js';
import type { RuntimeInterfaceLanguage } from './config.js';
import type {
  DesktopNetworkProxyRoutingInput,
  DesktopNetworkProxyServerInput,
  DesktopNetworkProxyState,
} from './network-proxy/index.js';
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
import type {
  DesktopWebDavSyncBackupResult,
  DesktopWebDavSyncCategorySummary,
  DesktopWebDavSyncConfigureInput,
  DesktopWebDavSyncConfigureResult,
  DesktopWebDavSyncPreferencesInput,
  DesktopWebDavSyncRestorePlan,
  DesktopWebDavSyncRestorePlanInput,
  DesktopWebDavSyncRestoreResult,
  DesktopWebDavSyncSnapshotList,
  DesktopWebDavSyncState,
} from './webdav-sync/index.js';

export type DesktopOpenPathResult =
  | { ok: true }
  | { ok: false; error: string };

export type DesktopWorkspaceFilePreviewResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type DesktopWindowsSandboxState =
  | 'unsupported'
  | 'unavailable'
  | 'not-installed'
  | 'ready'
  | 'needs-repair';

export type DesktopWindowsSandboxStatus = {
  architecture: string;
  installSupported: boolean;
  installedVersion?: string;
  platform: string;
  protocolVersion?: number;
  reason: string;
  sidecarVersion?: string;
  state: DesktopWindowsSandboxState;
};

export type DesktopWindowsSandboxAction = 'install' | 'repair' | 'uninstall';

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
  /** Original repository path for renamed files. */
  previousPath?: string;
  action: string;
  additions: number;
  deletions: number;
  /** Non-text files are listed without ever decoding their bytes into text diff lines. */
  contentKind?: 'binary' | 'image';
  truncated: boolean;
  lines: DesktopDiffLine[];
  /** Original unified patch for complete previews; omitted when truncated. */
  patch?: string;
};

export type DesktopDiffSummary = {
  files: DesktopDiffFile[];
  additions: number;
  deletions: number;
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
  networkProxy: {
    getState(): Promise<DesktopNetworkProxyState>;
    upsertServer(input: DesktopNetworkProxyServerInput): Promise<DesktopNetworkProxyState>;
    deleteServer(proxyServerId: string): Promise<DesktopNetworkProxyState>;
    setRouting(input: DesktopNetworkProxyRoutingInput): Promise<DesktopNetworkProxyState>;
    onStateChange(callback: (state: DesktopNetworkProxyState) => void): () => void;
  };
  windowsSandbox: {
    getStatus(): Promise<DesktopWindowsSandboxStatus>;
    runAction(action: DesktopWindowsSandboxAction): Promise<DesktopWindowsSandboxStatus>;
  };
  plugins: {
    /** Opens the native directory picker and installs the selected local Plugin Bundle. */
    installLocal(): Promise<RuntimePluginInstallResult | null>;
  };
  runtime: DesktopRuntimeBridge;
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
  webdavSync: {
    getState(): Promise<DesktopWebDavSyncState>;
    getLocalCategorySummaries(): Promise<DesktopWebDavSyncCategorySummary[]>;
    revealRecoveryKey(): Promise<string>;
    resetLocalConfiguration(): Promise<DesktopWebDavSyncState>;
    configure(input: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncConfigureResult>;
    updatePreferences(input: DesktopWebDavSyncPreferencesInput): Promise<DesktopWebDavSyncState>;
    /** When input is provided, verifies the draft without saving it locally. */
    testConnection(input?: DesktopWebDavSyncConfigureInput): Promise<DesktopWebDavSyncState>;
    backupNow(): Promise<DesktopWebDavSyncBackupResult>;
    listSnapshots(): Promise<DesktopWebDavSyncSnapshotList>;
    inspectRestore(input: DesktopWebDavSyncRestorePlanInput): Promise<DesktopWebDavSyncRestorePlan>;
    restore(planId: string): Promise<DesktopWebDavSyncRestoreResult>;
    cancelCurrentOperation(): Promise<DesktopWebDavSyncState>;
    disconnect(): Promise<DesktopWebDavSyncState>;
    onStateChange(callback: (state: DesktopWebDavSyncState) => void): () => void;
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
