import type {
  DesktopRuntimeBridge,
  DesktopRuntimeEventPayload,
  RuntimeRequestInput,
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { composeBuiltinPreloadBridge } from './composition/builtin-preload-features.js';

const runtime: DesktopRuntimeBridge = {
  request: <T = unknown>(input: RuntimeRequestInput): Promise<T> => ipcRenderer.invoke('runtime:request', input),
  cancelRequest: (requestId) => ipcRenderer.invoke('runtime:cancel-request', { requestId }),
  linkAttachment: (file) => {
    const filePath = webUtils.getPathForFile(file);
    return filePath
      ? ipcRenderer.invoke('runtime:link-attachment', { path: filePath, type: file.type })
      : Promise.resolve(null);
  },
  uploadAttachment: (input) => ipcRenderer.invoke('runtime:upload-attachment', input),
  readAttachmentImage: (threadId, assetId) =>
    ipcRenderer.invoke('runtime:read-attachment-image', { threadId, assetId }),
  startSse(threadId, sinceSeq, onBatch) {
    let cancelled = false;
    let subscriptionId: string | null = null;
    const queuedPayloads: DesktopRuntimeEventPayload[] = [];
    const deliver = (payload: DesktopRuntimeEventPayload) => {
      if (payload.subscriptionId !== subscriptionId) return;
      if (payload.batch?.events.length) onBatch(payload.batch);
      if (payload.error) console.error(payload.error);
    };
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopRuntimeEventPayload) => {
      if (subscriptionId === null) {
        queuedPayloads.push(payload);
        return;
      }
      deliver(payload);
    };
    ipcRenderer.on('runtime:event', listener);
    void ipcRenderer.invoke('runtime:subscribe', { threadId, sinceSeq }).then((id) => {
      const resolvedSubscriptionId = String(id);
      if (cancelled) {
        void ipcRenderer.invoke('runtime:unsubscribe', resolvedSubscriptionId);
        return;
      }
      subscriptionId = resolvedSubscriptionId;
      for (const payload of queuedPayloads.splice(0, queuedPayloads.length)) deliver(payload);
    }).catch((error: unknown) => {
      if (!cancelled) console.error(error);
    });
    return () => {
      cancelled = true;
      ipcRenderer.off('runtime:event', listener);
      if (subscriptionId) void ipcRenderer.invoke('runtime:unsubscribe', subscriptionId);
    };
  },
};

const desktop: SetsunaDesktopBridge['desktop'] = {
  platform: process.platform,
  setInterfaceLanguage: (locale) => ipcRenderer.invoke('desktop:set-interface-language', locale),
  setActiveKeyboardShortcutBindings: (bindings) =>
    ipcRenderer.invoke('desktop:set-active-keyboard-shortcut-bindings', bindings),
  setKeyboardShortcutRecording: (recording) =>
    ipcRenderer.invoke('desktop:set-keyboard-shortcut-recording', recording),
  onKeyboardShortcutInput(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      input: Parameters<typeof callback>[0],
    ) => callback(input);
    ipcRenderer.on('desktop:keyboard-shortcut-input', listener);
    return () => ipcRenderer.off('desktop:keyboard-shortcut-input', listener);
  },
  selectDirectory: (options) => ipcRenderer.invoke('desktop:select-directory', options ?? {}),
  getUserProfile: () => ipcRenderer.invoke('desktop:get-user-profile'),
  copyImageToClipboard: (input) => ipcRenderer.invoke('desktop:copy-image-to-clipboard', input),
  readImageAsset: (assetId) => ipcRenderer.invoke('desktop:read-image-asset', assetId),
  revealImageInFolder: (input) => ipcRenderer.invoke('desktop:reveal-image-in-folder', input),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  openWorkspaceDirectory: (workspaceRoot, directoryPath) =>
    ipcRenderer.invoke('desktop:open-workspace-directory', { workspaceRoot, directoryPath }),
  openWorkspaceFile: (workspaceRoot, filePath) =>
    ipcRenderer.invoke('desktop:open-workspace-file', { workspaceRoot, filePath }),
  copyWorkspaceFilePath: (workspaceRoot, filePath) =>
    ipcRenderer.invoke('desktop:copy-workspace-file-path', { workspaceRoot, filePath }),
  revealWorkspaceFile: (workspaceRoot, filePath) =>
    ipcRenderer.invoke('desktop:reveal-workspace-file', { workspaceRoot, filePath }),
  createWorkspaceFilePreview: (workspaceRoot, filePath) =>
    ipcRenderer.invoke('desktop:create-workspace-file-preview', { workspaceRoot, filePath }),
};

const dataRoot: SetsunaDesktopBridge['dataRoot'] = {
  getState: () => ipcRenderer.invoke('desktop-data-root:get-state'),
  scanTarget: (targetRoot) => ipcRenderer.invoke('desktop-data-root:scan-target', targetRoot),
  beginMigration: (planId) => ipcRenderer.invoke('desktop-data-root:begin-migration', planId),
  runMigration: () => ipcRenderer.invoke('desktop-data-root:run-migration'),
  cancelMigration: () => ipcRenderer.invoke('desktop-data-root:cancel-migration'),
  retryStartup: () => ipcRenderer.invoke('desktop-data-root:retry-startup'),
  restorePreviousRoot: () => ipcRenderer.invoke('desktop-data-root:restore-previous'),
  inspectRetainedBackup: (backupId) =>
    ipcRenderer.invoke('desktop-data-root:inspect-retained-backup', backupId),
  deleteRetainedBackup: (backupId) =>
    ipcRenderer.invoke('desktop-data-root:delete-retained-backup', backupId),
  dismissRetainedBackups: (backupIds) =>
    ipcRenderer.invoke('desktop-data-root:dismiss-retained-backups', backupIds),
  onStateChange(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ) => callback(state);
    ipcRenderer.on('desktop-data-root:state-change', listener);
    return () => ipcRenderer.off('desktop-data-root:state-change', listener);
  },
};

const plugins: SetsunaDesktopBridge['plugins'] = {
  installLocal: () => ipcRenderer.invoke('desktop-plugin:install-local'),
};

const windowControls: SetsunaDesktopBridge['windowControls'] = {
  minimize: () => ipcRenderer.invoke('window-control:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-control:toggle-maximize'),
  close: () => ipcRenderer.invoke('window-control:close'),
  getCloseBehavior: () => ipcRenderer.invoke('window-control:get-close-behavior'),
  setCloseBehavior: (behavior) => ipcRenderer.invoke('window-control:set-close-behavior', behavior),
  isMaximized: () => ipcRenderer.invoke('window-control:is-maximized'),
  onMaximizedChange(callback: (maximized: boolean) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on('window-control:maximized-change', listener);
    return () => ipcRenderer.off('window-control:maximized-change', listener);
  },
  setTitlebarScale: (scale) => ipcRenderer.invoke('window-control:set-titlebar-scale', { scale }),
};

const links: SetsunaDesktopBridge['links'] = {
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
};

const hostBridge: SetsunaDesktopBridge = {
  dataRoot,
  desktop,
  links,
  plugins,
  runtime,
  windowControls,
};
const bridge = composeBuiltinPreloadBridge(hostBridge);
contextBridge.exposeInMainWorld('setsunaDesktop', bridge);
