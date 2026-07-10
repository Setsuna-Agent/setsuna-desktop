import { app, BrowserWindow, dialog, shell } from 'electron';
import type {
  DesktopUpdateActionResult,
  DesktopUpdateDownloadSource,
  DesktopUpdateDownloadSourceInput,
  DesktopUpdateInfo,
  DesktopUpdateInstallMode,
  DesktopUpdateProgress,
  DesktopUpdateState,
} from '@setsuna-desktop/contracts';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  GITHUB_DIRECT_DOWNLOAD_SOURCE,
  resolveUpdateDownloadUrl,
  UpdateDownloadSourceStore,
} from './update-download-sources.js';
import { checksumForAsset, isNewerVersion, parseSha256Sums, selectUpdateAsset, type ReleaseAsset, type ReleaseInfo } from './update-metadata.js';

type DesktopUpdaterOptions = {
  currentVersion: string;
  repository: string;
  downloadsDir: string;
  sourceConfigPath: string;
  enabled: boolean;
  checkIntervalMs?: number;
};

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const METADATA_REQUEST_TIMEOUT_MS = 20 * 1000;
const DOWNLOAD_STALL_TIMEOUT_MS = 45 * 1000;
const PROGRESS_EMIT_INTERVAL_MS = 250;

export class DesktopUpdater {
  private state: DesktopUpdateState;
  private readonly checkIntervalMs: number;
  private readonly downloadsDir: string;
  private readonly enabled: boolean;
  private readonly latestReleaseUrl: string;
  private readonly sourceStore: UpdateDownloadSourceStore;
  private activeTransferController: AbortController | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private restartRequested = false;
  private runningCheck: Promise<DesktopUpdateState> | null = null;
  private sourceRevision = 0;

  constructor(options: DesktopUpdaterOptions) {
    this.downloadsDir = options.downloadsDir;
    this.enabled = options.enabled;
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.latestReleaseUrl = `https://api.github.com/repos/${options.repository}/releases/latest`;
    this.sourceStore = new UpdateDownloadSourceStore(options.sourceConfigPath);
    this.state = {
      status: 'idle',
      currentVersion: options.currentVersion,
      platform: process.platform,
      arch: process.arch,
      installMode: updateInstallMode(process.platform),
      canUpdate: options.enabled,
      feedUrl: `https://github.com/${options.repository}/releases/latest`,
      activeDownloadSourceId: GITHUB_DIRECT_DOWNLOAD_SOURCE.id,
      downloadSources: [{ ...GITHUB_DIRECT_DOWNLOAD_SOURCE }],
      manualInstall: process.platform === 'darwin',
      progress: null,
      updateInfo: null,
    };
  }

  async initialize(): Promise<void> {
    await this.sourceStore.load();
    this.applySourceConfig(this.sourceStore.getConfig(), false);
  }

  getState(): DesktopUpdateState {
    return { ...this.state, downloadSources: this.state.downloadSources.map((source) => ({ ...source })) };
  }

  start(): void {
    if (!this.enabled || this.checkTimer) return;
    this.checkTimer = setInterval(() => {
      void this.checkAndDownload();
    }, this.checkIntervalMs);
    void this.checkAndDownload();
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    this.checkTimer = null;
    this.activeTransferController?.abort(new Error('Desktop updater stopped.'));
    this.activeTransferController = null;
  }

  checkAndDownload(): Promise<DesktopUpdateState> {
    if (this.runningCheck) return this.runningCheck;
    if (this.state.status === 'downloaded') return Promise.resolve(this.getState());

    this.runningCheck = this.runChecksUntilStable().finally(() => {
      this.runningCheck = null;
    });

    return this.runningCheck;
  }

  async addDownloadSource(input: DesktopUpdateDownloadSourceInput): Promise<DesktopUpdateState> {
    const config = await this.sourceStore.add(input);
    this.applySourceConfig(config, true);
    return this.getState();
  }

  async selectDownloadSource(sourceId: string): Promise<DesktopUpdateState> {
    const config = await this.sourceStore.select(sourceId);
    this.applySourceConfig(config, true);
    return this.getState();
  }

  async removeDownloadSource(sourceId: string): Promise<DesktopUpdateState> {
    const config = await this.sourceStore.remove(sourceId);
    this.applySourceConfig(config, true);
    return this.getState();
  }

  async promptReady(window: BrowserWindow | null): Promise<DesktopUpdateActionResult> {
    if (this.state.status !== 'downloaded' || !this.state.downloadedFilePath) {
      return { ok: false, action: 'none', state: this.getState(), error: 'No downloaded update is ready.' };
    }

    const prompt = promptOptionsForState(this.state);
    const result = window ? await dialog.showMessageBox(window, prompt) : await dialog.showMessageBox(prompt);

    if (result.response !== 0) {
      return { ok: true, action: 'none', state: this.getState() };
    }

    return this.openReadyUpdate();
  }

  async installReady(): Promise<DesktopUpdateActionResult> {
    if (this.state.status !== 'downloaded' || !this.state.downloadedFilePath) {
      return { ok: false, action: 'none', state: this.getState(), error: 'No downloaded update is ready.' };
    }

    return this.openReadyUpdate();
  }

  private async runChecksUntilStable(): Promise<DesktopUpdateState> {
    do {
      this.restartRequested = false;
      await this.runCheckAndDownload();
    } while (this.restartRequested);
    return this.getState();
  }

  private async runCheckAndDownload(): Promise<DesktopUpdateState> {
    if (!this.enabled) {
      this.setState({ status: 'unsupported', error: '当前环境不支持在线更新。', progress: null });
      return this.getState();
    }

    const sourceRevision = this.sourceRevision;
    try {
      this.setState({ status: 'checking', error: undefined, progress: null });
      const release = await fetchJson<ReleaseInfo>(this.latestReleaseUrl);
      this.ensureSourceUnchanged(sourceRevision);
      const availableVersion = release.tag_name;

      if (!isNewerVersion(availableVersion, this.state.currentVersion)) {
        this.setState({
          status: 'not-available',
          availableVersion: undefined,
          downloadedVersion: undefined,
          releaseUrl: release.html_url ?? undefined,
          updateInfo: null,
          progress: null,
        });
        return this.getState();
      }

      const asset = selectUpdateAsset(release.assets, process.platform, process.arch);
      if (!asset) {
        this.setState({
          status: 'error',
          availableVersion,
          releaseUrl: release.html_url ?? undefined,
          updateInfo: updateInfoFromRelease(release),
          progress: null,
          error: `No update asset matched ${process.platform}/${process.arch}.`,
        });
        return this.getState();
      }

      this.setState({
        status: 'available',
        availableVersion,
        downloadedVersion: undefined,
        releaseUrl: release.html_url ?? undefined,
        updateInfo: updateInfoFromRelease(release),
        assetName: asset.name,
        downloadedFilePath: undefined,
        downloadedAt: undefined,
        progress: null,
      });

      this.setState({
        status: 'downloading',
        progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
        assetName: asset.name,
        downloadedFilePath: undefined,
        downloadedAt: undefined,
      });

      const downloadSource = this.sourceStore.getActiveSource();
      const transferController = new AbortController();
      this.activeTransferController = transferController;
      const expectedSha256 = await this.fetchExpectedChecksum(release.assets, asset, downloadSource, transferController.signal);
      this.ensureSourceUnchanged(sourceRevision);
      const downloadedFilePath = await this.downloadAsset(asset, availableVersion, downloadSource, transferController.signal);
      this.ensureSourceUnchanged(sourceRevision);

      if (expectedSha256) {
        const actualSha256 = await sha256File(downloadedFilePath);
        if (actualSha256 !== expectedSha256) {
          await rm(downloadedFilePath, { force: true });
          throw new Error(`Downloaded update checksum mismatch for ${asset.name}.`);
        }
      }

      this.setState({
        status: 'downloaded',
        downloadedVersion: availableVersion,
        downloadedFilePath,
        downloadedAt: new Date().toISOString(),
        progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
        error: undefined,
      });
    } catch (error) {
      if (error instanceof UpdateDownloadSourceChangedError) return this.getState();
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        progress: null,
      });
    } finally {
      this.activeTransferController = null;
    }

    return this.getState();
  }

  private async fetchExpectedChecksum(
    assets: ReleaseAsset[],
    selectedAsset: ReleaseAsset,
    source: DesktopUpdateDownloadSource,
    signal: AbortSignal,
  ): Promise<string | null> {
    const checksumAsset = assets.find((asset) => asset.name === 'SHA256SUMS');
    if (!checksumAsset) return null;

    const checksumText = await fetchWithTimeout(
      resolveUpdateDownloadUrl(source, checksumAsset.browser_download_url),
      METADATA_REQUEST_TIMEOUT_MS,
      `Timed out while fetching checksums for ${selectedAsset.name}.`,
      async (response) => (response.ok ? response.text() : null),
      signal,
    );
    if (!checksumText) return null;

    const checksums = parseSha256Sums(checksumText);
    return checksumForAsset(checksums, selectedAsset.name);
  }

  private async downloadAsset(asset: ReleaseAsset, version: string, source: DesktopUpdateDownloadSource, signal: AbortSignal): Promise<string> {
    const versionDir = path.join(this.downloadsDir, version.replace(/[^\w.-]/gu, '_'));
    await mkdir(versionDir, { recursive: true });

    const destination = path.join(versionDir, asset.name);
    const tempDestination = `${destination}.download`;
    await rm(tempDestination, { force: true });

    try {
      await downloadFile(resolveUpdateDownloadUrl(source, asset.browser_download_url), tempDestination, {
        assetName: asset.name,
        signal,
        onProgress: (progress) => {
          this.setState({ status: 'downloading', progress });
        },
      });
      await rename(tempDestination, destination);
    } catch (error) {
      await rm(tempDestination, { force: true });
      throw error;
    }

    return destination;
  }

  private applySourceConfig(config: { activeSourceId: string; sources: DesktopUpdateDownloadSource[] }, restartActiveTransfer: boolean): void {
    const sourceChanged = this.state.activeDownloadSourceId !== config.activeSourceId;
    this.setState({
      activeDownloadSourceId: config.activeSourceId,
      downloadSources: config.sources.map((source) => ({ ...source })),
    });
    if (!sourceChanged) return;

    this.sourceRevision += 1;
    if (restartActiveTransfer && this.runningCheck) {
      // A source switch must take effect immediately, including during an automatic startup download.
      this.restartRequested = true;
      this.activeTransferController?.abort(new UpdateDownloadSourceChangedError());
    }
  }

  private ensureSourceUnchanged(revision: number): void {
    if (revision !== this.sourceRevision) throw new UpdateDownloadSourceChangedError();
  }

  private async openReadyUpdate(): Promise<DesktopUpdateActionResult> {
    const downloadedFilePath = this.state.downloadedFilePath;
    if (!downloadedFilePath) return { ok: false, action: 'none', state: this.getState(), error: 'No downloaded update path is available.' };

    if (process.platform === 'win32') {
      const error = await shell.openPath(downloadedFilePath);
      if (error) return { ok: false, action: 'opened-installer', state: this.getState(), error };
      setTimeout(() => app.quit(), 800);
      return { ok: true, action: 'opened-installer', state: this.getState() };
    }

    if (process.platform === 'darwin') {
      shell.showItemInFolder(downloadedFilePath);
      return { ok: true, action: 'opened-folder', state: this.getState() };
    }

    if (process.platform === 'linux') {
      shell.showItemInFolder(downloadedFilePath);
      return { ok: true, action: 'opened-folder', state: this.getState() };
    }

    return { ok: false, action: 'unsupported', state: this.getState(), error: `Unsupported update platform: ${process.platform}` };
  }

  private setState(patch: Partial<DesktopUpdateState>): void {
    this.state = { ...this.state, ...patch };
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('desktop-updater:state-change', this.getState());
    }
  }
}

class UpdateDownloadSourceChangedError extends Error {
  constructor() {
    super('Download source changed.');
    this.name = 'UpdateDownloadSourceChangedError';
  }
}

function updateInstallMode(platform: NodeJS.Platform): DesktopUpdateInstallMode {
  if (platform === 'win32') return 'run-installer';
  if (platform === 'darwin') return 'open-finder';
  if (platform === 'linux') return 'open-file';
  return 'unsupported';
}

function updateInfoFromRelease(release: ReleaseInfo): DesktopUpdateInfo {
  return {
    version: release.tag_name,
    releaseName: release.name ?? release.tag_name,
  };
}

function promptOptionsForState(state: DesktopUpdateState): Electron.MessageBoxOptions {
  if (state.platform === 'darwin') {
    return {
      type: 'info',
      buttons: ['打开访达', '稍后'],
      defaultId: 0,
      cancelId: 1,
      message: '更新已经准备完成',
      detail: `已下载 ${state.assetName ?? '新的 macOS 安装包'}。打开访达后请手动安装。`,
    };
  }

  if (state.platform === 'win32') {
    return {
      type: 'info',
      buttons: ['重启更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      message: '更新已经准备完成',
      detail: `已下载 ${state.assetName ?? '新的 Windows 安装包'}。继续后会打开安装程序并退出当前版本。`,
    };
  }

  return {
    type: 'info',
    buttons: ['打开下载目录', '稍后'],
    defaultId: 0,
    cancelId: 1,
    message: '更新已经准备完成',
    detail: `已下载 ${state.assetName ?? '新的安装包'}。`,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  return fetchWithTimeout(url, METADATA_REQUEST_TIMEOUT_MS, 'Timed out while checking for updates.', async (response) => {
    if (!response.ok) throw new Error(`Failed to check updates: HTTP ${response.status}`);
    return (await response.json()) as T;
  });
}

function requestInit(signal?: AbortSignal): RequestInit {
  return {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Setsuna-Desktop-Updater',
    },
    signal,
  };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number,
  timeoutMessage: string,
  readResponse: (response: Response) => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const unlinkExternalSignal = forwardAbortSignal(externalSignal, controller);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutMessage));
  }, timeoutMs);

  try {
    const response = await fetch(url, requestInit(controller.signal));
    return await readResponse(response);
  } catch (error) {
    if (externalSignal?.aborted) throw abortReason(externalSignal, error);
    if (timedOut) throw new Error(timeoutMessage, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    unlinkExternalSignal();
  }
}

type DownloadFileOptions = {
  assetName: string;
  signal?: AbortSignal;
  onProgress: (progress: DesktopUpdateProgress) => void;
};

async function downloadFile(url: string, destination: string, options: DownloadFileOptions): Promise<void> {
  const controller = new AbortController();
  const stallMessage = `Download stalled while fetching ${options.assetName}.`;
  let stalled = false;
  const unlinkExternalSignal = forwardAbortSignal(options.signal, controller);
  const resetStallTimer = createResettableTimeout(() => {
    stalled = true;
    controller.abort(new Error(stallMessage));
  }, DOWNLOAD_STALL_TIMEOUT_MS);

  try {
    resetStallTimer.reset();
    const response = await fetch(url, requestInit(controller.signal));
    if (!response.ok) throw new Error(`Failed to download ${options.assetName}: HTTP ${response.status}`);
    if (!response.body) throw new Error(`Failed to download ${options.assetName}: empty response body.`);

    await writeResponseBody(response.body, destination, {
      total: contentLength(response),
      onProgress: options.onProgress,
      resetStallTimer: resetStallTimer.reset,
    });
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal, error);
    if (stalled) throw new Error(stallMessage, { cause: error });
    throw error;
  } finally {
    resetStallTimer.clear();
    unlinkExternalSignal();
  }
}

type WriteResponseBodyOptions = {
  total: number;
  onProgress: (progress: DesktopUpdateProgress) => void;
  resetStallTimer: () => void;
};

async function writeResponseBody(
  body: NonNullable<Response['body']>,
  destination: string,
  options: WriteResponseBodyOptions,
): Promise<void> {
  const reader = body.getReader();
  const file = await open(destination, 'w');
  const startedAt = Date.now();
  let transferred = 0;
  let lastEmitAt = 0;
  let lastEmitPercent = -1;

  try {
    for (;;) {
      options.resetStallTimer();
      const { done, value } = await reader.read();
      options.resetStallTimer();
      if (done) break;
      if (!value?.byteLength) continue;

      await file.write(value);
      transferred += value.byteLength;

      const progress = buildDownloadProgress(transferred, options.total, startedAt, false);
      const now = Date.now();
      if (shouldEmitProgress(progress, now, lastEmitAt, lastEmitPercent)) {
        options.onProgress(progress);
        lastEmitAt = now;
        lastEmitPercent = Math.floor(progress.percent);
      }
    }

    options.onProgress(buildDownloadProgress(transferred, options.total, startedAt, true));
  } finally {
    reader.releaseLock();
    await file.close();
  }
}

function contentLength(response: Response): number {
  const value = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function buildDownloadProgress(transferred: number, total: number, startedAt: number, complete: boolean): DesktopUpdateProgress {
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  const rawPercent = total > 0 ? (transferred / total) * 100 : 0;

  return {
    percent: complete ? 100 : Math.min(rawPercent, 99),
    transferred,
    total,
    bytesPerSecond: Math.round(transferred / elapsedSeconds),
  };
}

function shouldEmitProgress(progress: DesktopUpdateProgress, now: number, lastEmitAt: number, lastEmitPercent: number): boolean {
  if (lastEmitAt === 0) return true;
  if (Math.floor(progress.percent) !== lastEmitPercent) return true;
  return now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS;
}

function createResettableTimeout(callback: () => void, timeoutMs: number): { reset: () => void; clear: () => void } {
  let timeout: NodeJS.Timeout | null = null;

  const clear = () => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = null;
  };

  return {
    reset: () => {
      clear();
      timeout = setTimeout(callback, timeoutMs);
    },
    clear,
  };
}

function forwardAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function abortReason(signal: AbortSignal, cause: unknown): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Request aborted.', { cause });
}
