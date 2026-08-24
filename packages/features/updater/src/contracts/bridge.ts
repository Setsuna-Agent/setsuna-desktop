import type {
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateState,
} from './types.js';

export const UPDATER_IPC_CHANNELS = Object.freeze({
  getState: 'desktop-updater:get-state',
  check: 'desktop-updater:check',
  addDownloadSource: 'desktop-updater:add-download-source',
  selectDownloadSource: 'desktop-updater:select-download-source',
  removeDownloadSource: 'desktop-updater:remove-download-source',
  promptReady: 'desktop-updater:prompt-ready',
  installReady: 'desktop-updater:quit-and-install',
  stateChange: 'desktop-updater:state-change',
} as const);

export interface UpdaterDesktopBridge {
  getState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  addDownloadSource(input: DesktopUpdateDownloadSourceInput): Promise<DesktopUpdateState>;
  selectDownloadSource(sourceId: string): Promise<DesktopUpdateState>;
  removeDownloadSource(sourceId: string): Promise<DesktopUpdateState>;
  quitAndInstall(): Promise<DesktopUpdateActionResult>;
  promptReadyUpdate(): Promise<DesktopUpdateActionResult>;
  onStateChange(callback: (state: DesktopUpdateState) => void): () => void;
}

export type UpdaterPreloadBridgeContribution = Readonly<{
  updater: UpdaterDesktopBridge;
}>;
