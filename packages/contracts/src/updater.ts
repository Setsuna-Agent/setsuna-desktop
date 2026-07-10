export type DesktopUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'not-available' | 'downloaded' | 'error' | 'unsupported';

export type DesktopUpdateInstallMode = 'run-installer' | 'open-finder' | 'open-file' | 'unsupported';

export type DesktopUpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type DesktopUpdateInfo = {
  version?: string;
  releaseDate?: string;
  releaseName?: string;
};

export type DesktopUpdateDownloadSource = {
  id: string;
  name: string;
  urlTemplate: string;
  builtIn: boolean;
};

export type DesktopUpdateDownloadSourceInput = {
  name: string;
  urlTemplate: string;
};

export type DesktopUpdateState = {
  status: DesktopUpdateStatus;
  currentVersion: string;
  platform: string;
  arch: string;
  installMode: DesktopUpdateInstallMode;
  canUpdate: boolean;
  feedUrl: string | null;
  activeDownloadSourceId: string;
  downloadSources: DesktopUpdateDownloadSource[];
  availableVersion?: string;
  downloadedVersion?: string;
  releaseUrl?: string;
  manualInstall: boolean;
  progress?: DesktopUpdateProgress | null;
  updateInfo?: DesktopUpdateInfo | null;
  assetName?: string;
  downloadedFilePath?: string;
  downloadedAt?: string;
  error?: string;
};

export type DesktopUpdateActionResult = {
  ok: boolean;
  action: 'none' | 'opened-installer' | 'opened-folder' | 'unsupported';
  state: DesktopUpdateState;
  error?: string;
};
