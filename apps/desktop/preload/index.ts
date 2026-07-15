import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopRuntimeBridge,
  DesktopTerminalEvent,
  DesktopUpdateState,
  RuntimeEvent,
  RuntimeRequestInput,
  SetsunaDesktopBridge,
} from '@setsuna-desktop/contracts';

type RuntimeEventPayload = { subscriptionId: string; event?: RuntimeEvent; error?: string };

const runtime: DesktopRuntimeBridge = {
  request: <T = unknown>(input: RuntimeRequestInput): Promise<T> => ipcRenderer.invoke('runtime:request', input),
  startSse(threadId, sinceSeq, onEvent) {
    let cancelled = false;
    let subscriptionId: string | null = null;
    const queuedPayloads: RuntimeEventPayload[] = [];
    const deliver = (payload: RuntimeEventPayload) => {
      if (payload.subscriptionId !== subscriptionId) return;
      if (payload.event) onEvent(payload.event);
      if (payload.error) console.error(payload.error);
    };
    const listener = (_event: Electron.IpcRendererEvent, payload: RuntimeEventPayload) => {
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
  selectDirectory: (options) => ipcRenderer.invoke('desktop:select-directory', options ?? {}),
  getUserProfile: () => ipcRenderer.invoke('desktop:get-user-profile'),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  openWorkspaceFile: (workspaceRoot, filePath) =>
    ipcRenderer.invoke('desktop:open-workspace-file', { workspaceRoot, filePath }),
};

const windowControls: SetsunaDesktopBridge['windowControls'] = {
  minimize: () => ipcRenderer.invoke('window-control:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-control:toggle-maximize'),
  close: () => ipcRenderer.invoke('window-control:close'),
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

const browser: SetsunaDesktopBridge['browser'] = {
  registerTab: (tabId, webContentsId) =>
    ipcRenderer.invoke('browser:register-tab', { tabId, webContentsId }),
  unregisterTab: (tabId, webContentsId) =>
    ipcRenderer.invoke('browser:unregister-tab', { tabId, webContentsId }),
  setActiveTab: (tabId) =>
    ipcRenderer.invoke('browser:set-active-tab', { tabId }),
  onOpenNewTab(callback: (request: { openerWebContentsId: number; url: string }) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, request: { openerWebContentsId: number; url: string }) => callback(request);
    ipcRenderer.on('browser:open-new-tab', listener);
    return () => ipcRenderer.off('browser:open-new-tab', listener);
  },
};

const updater: SetsunaDesktopBridge['updater'] = {
  getState: () => ipcRenderer.invoke('desktop-updater:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop-updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop-updater:download'),
  addDownloadSource: (input) => ipcRenderer.invoke('desktop-updater:add-download-source', input),
  selectDownloadSource: (sourceId) => ipcRenderer.invoke('desktop-updater:select-download-source', sourceId),
  removeDownloadSource: (sourceId) => ipcRenderer.invoke('desktop-updater:remove-download-source', sourceId),
  quitAndInstall: () => ipcRenderer.invoke('desktop-updater:quit-and-install'),
  promptReadyUpdate: () => ipcRenderer.invoke('desktop-updater:prompt-ready'),
  onStateChange(callback: (state: DesktopUpdateState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => callback(state);
    ipcRenderer.on('desktop-updater:state-change', listener);
    return () => ipcRenderer.off('desktop-updater:state-change', listener);
  },
};

const desktopReview: SetsunaDesktopBridge['desktopReview'] = {
  getState: (workspaceRoot, options) =>
    ipcRenderer.invoke('desktop-review:get-state', { workspaceRoot, baseRef: options?.baseRef ?? null }),
  discardUnstaged: (workspaceRoot, filePaths) =>
    ipcRenderer.invoke('desktop-review:discard-unstaged', { workspaceRoot, filePaths }),
  stageFiles: (workspaceRoot, filePaths) =>
    ipcRenderer.invoke('desktop-review:stage-files', { workspaceRoot, filePaths }),
  unstageFiles: (workspaceRoot, filePaths) =>
    ipcRenderer.invoke('desktop-review:unstage-files', { workspaceRoot, filePaths }),
  checkoutBranch: (workspaceRoot, branchName) =>
    ipcRenderer.invoke('desktop-review:checkout-branch', { workspaceRoot, branchName }),
  createBranch: (workspaceRoot, branchName, options) =>
    ipcRenderer.invoke('desktop-review:create-branch', { workspaceRoot, branchName, allowUnstaged: options?.allowUnstaged ?? false }),
  commit: (workspaceRoot, input) =>
    ipcRenderer.invoke('desktop-review:commit', { workspaceRoot, ...input }),
  push: (workspaceRoot) =>
    ipcRenderer.invoke('desktop-review:push', { workspaceRoot }),
  generateCommitMessage: (workspaceRoot, input) =>
    ipcRenderer.invoke('desktop-review:generate-commit-message', { workspaceRoot, includeUnstaged: input?.includeUnstaged ?? true }),
};

const workspaceApps: SetsunaDesktopBridge['workspaceApps'] = {
  list: (workspaceRoot) => ipcRenderer.invoke('workspace-apps:list', { workspaceRoot }),
  open: (workspaceRoot, appId, filePath, line) =>
    ipcRenderer.invoke('workspace-apps:open', { workspaceRoot, appId, filePath, line }),
};

const terminal: SetsunaDesktopBridge['terminal'] = {
  open: (workspaceRoot, cols, rows) =>
    ipcRenderer.invoke('terminal:open', { workspaceRoot, cols, rows }),
  write: (sessionId, input) => ipcRenderer.invoke('terminal:write', { sessionId, input }),
  read: (sessionId) => ipcRenderer.invoke('terminal:read', { sessionId }),
  resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
  restart: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:restart', { sessionId, cols, rows }),
  close: (sessionId) => ipcRenderer.invoke('terminal:close', { sessionId }),
  onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopTerminalEvent & { sessionId: string }) => {
      if (payload.sessionId !== sessionId) return;
      callback({ seq: payload.seq, event: payload.event, data: payload.data });
    };
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.off('terminal:event', listener);
  },
};

const bridge: SetsunaDesktopBridge = { browser, desktop, desktopReview, links, runtime, terminal, updater, windowControls, workspaceApps };
contextBridge.exposeInMainWorld('setsunaDesktop', bridge);
