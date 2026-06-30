import { contextBridge, ipcRenderer } from 'electron';
import type { RuntimeEvent, RuntimeRequestInput } from '@setsuna-desktop/contracts';

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

type RuntimeApi = {
  request<T = unknown>(input: RuntimeRequestInput): Promise<T>;
  startSse(threadId: string, sinceSeq: number | undefined, onEvent: (event: RuntimeEvent) => void): () => void;
};

const runtime: RuntimeApi = {
  request: (input) => ipcRenderer.invoke('runtime:request', input),
  startSse(threadId, sinceSeq, onEvent) {
    let subscriptionId: string | null = null;
    const listener = (_event: Electron.IpcRendererEvent, payload: { subscriptionId: string; event?: RuntimeEvent; error?: string }) => {
      if (payload.subscriptionId !== subscriptionId) return;
      if (payload.event) onEvent(payload.event);
      if (payload.error) console.error(payload.error);
    };
    ipcRenderer.on('runtime:event', listener);
    void ipcRenderer.invoke('runtime:subscribe', { threadId, sinceSeq }).then((id) => {
      subscriptionId = String(id);
    });
    return () => {
      ipcRenderer.off('runtime:event', listener);
      if (subscriptionId) void ipcRenderer.invoke('runtime:unsubscribe', subscriptionId);
    };
  },
};

const desktop = {
  platform: process.platform,
  selectDirectory: (options?: { title?: string }): Promise<string | null> => ipcRenderer.invoke('desktop:select-directory', options ?? {}),
  getUserProfile: (): Promise<DesktopUserProfile> => ipcRenderer.invoke('desktop:get-user-profile'),
  openPath: (targetPath: string): Promise<DesktopOpenPathResult> => ipcRenderer.invoke('desktop:open-path', targetPath),
};

const windowControls = {
  minimize: (): Promise<boolean> => ipcRenderer.invoke('window-control:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window-control:toggle-maximize'),
  close: (): Promise<boolean> => ipcRenderer.invoke('window-control:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-control:is-maximized'),
};

const links = {
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
};

const updater = {
  getState: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('desktop-updater:get-state'),
  checkForUpdates: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('desktop-updater:check'),
  downloadUpdate: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('desktop-updater:download'),
  quitAndInstall: (): Promise<DesktopUpdateActionResult> => ipcRenderer.invoke('desktop-updater:quit-and-install'),
  promptReadyUpdate: (): Promise<DesktopUpdateActionResult> => ipcRenderer.invoke('desktop-updater:prompt-ready'),
  onStateChange(callback: (state: DesktopUpdaterState) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdaterState) => callback(state);
    ipcRenderer.on('desktop-updater:state-change', listener);
    return () => ipcRenderer.off('desktop-updater:state-change', listener);
  },
};

const desktopReview = {
  getState: (workspaceRoot: string, options?: { baseRef?: string | null }): Promise<unknown> =>
    ipcRenderer.invoke('desktop-review:get-state', { workspaceRoot, baseRef: options?.baseRef ?? null }),
  discardUnstaged: (workspaceRoot: string, filePaths: string[]): Promise<unknown> =>
    ipcRenderer.invoke('desktop-review:discard-unstaged', { workspaceRoot, filePaths }),
  stageFiles: (workspaceRoot: string, filePaths: string[]): Promise<unknown> =>
    ipcRenderer.invoke('desktop-review:stage-files', { workspaceRoot, filePaths }),
  unstageFiles: (workspaceRoot: string, filePaths: string[]): Promise<unknown> =>
    ipcRenderer.invoke('desktop-review:unstage-files', { workspaceRoot, filePaths }),
};

const workspaceApps = {
  list: (workspaceRoot: string): Promise<DesktopWorkspaceApp[]> => ipcRenderer.invoke('workspace-apps:list', { workspaceRoot }),
  open: (workspaceRoot: string, appId: string, filePath?: string | null, line?: number | null): Promise<boolean> =>
    ipcRenderer.invoke('workspace-apps:open', { workspaceRoot, appId, filePath, line }),
};

const terminal = {
  open: (workspaceRoot?: string | null, cols?: number, rows?: number): Promise<DesktopTerminalSession> =>
    ipcRenderer.invoke('terminal:open', { workspaceRoot, cols, rows }),
  write: (sessionId: string, input: string): Promise<boolean> => ipcRenderer.invoke('terminal:write', { sessionId, input }),
  read: (sessionId: string): Promise<DesktopTerminalEvent[]> => ipcRenderer.invoke('terminal:read', { sessionId }),
  resize: (sessionId: string, cols: number, rows: number): Promise<boolean> => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
  close: (sessionId: string): Promise<boolean> => ipcRenderer.invoke('terminal:close', { sessionId }),
  onEvent(sessionId: string, callback: (event: DesktopTerminalEvent) => void): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopTerminalEvent & { sessionId: string }) => {
      if (payload.sessionId !== sessionId) return;
      callback({ seq: payload.seq, event: payload.event, data: payload.data });
    };
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.off('terminal:event', listener);
  },
};

contextBridge.exposeInMainWorld('setsunaDesktop', { desktop, desktopReview, links, runtime, terminal, updater, windowControls, workspaceApps });
