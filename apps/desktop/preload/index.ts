import { contextBridge, ipcRenderer } from 'electron';
import type { RuntimeEvent, RuntimeRequestInput } from '@setsuna-desktop/contracts';

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

const desktopReview = {
  getState: (workspaceRoot: string): Promise<unknown> => ipcRenderer.invoke('desktop-review:get-state', { workspaceRoot }),
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
      callback({ event: payload.event, data: payload.data });
    };
    ipcRenderer.on('terminal:event', listener);
    return () => ipcRenderer.off('terminal:event', listener);
  },
};

contextBridge.exposeInMainWorld('setsunaDesktop', { desktop, desktopReview, links, runtime, terminal, windowControls, workspaceApps });
