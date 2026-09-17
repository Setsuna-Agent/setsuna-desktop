import type { AutoUpdater } from 'electron';
import { createMacUpdateFeed } from './mac-update-feed.js';

const PREPARATION_TIMEOUT_MS = 2 * 60 * 1000;

/** Squirrel owns signature verification, atomic app replacement and relaunch. */
export class MacUpdateInstaller {
  private preparation: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private prepared = false;
  private disposed = false;

  constructor(private readonly nativeUpdater: AutoUpdater, private readonly onError: (error: Error) => void) {
    nativeUpdater.on('error', this.handleError);
  }

  prepare(archivePath: string, version: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The macOS updater has stopped.'));
    if (this.preparation) return this.preparation;
    this.prepared = false;
    const controller = new AbortController();
    this.controller = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PREPARATION_TIMEOUT_MS)]);
    this.preparation = this.stage(archivePath, version, signal).then(() => {
      this.prepared = true;
    }).finally(() => {
      this.controller = null;
      this.preparation = null;
    });
    return this.preparation;
  }

  quitAndInstall(): void {
    if (this.disposed || !this.prepared) throw new Error('No verified macOS update is ready to install.');
    this.prepared = false;
    this.nativeUpdater.quitAndInstall();
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort(new Error('The macOS updater has stopped.'));
    this.nativeUpdater.removeListener('error', this.handleError);
  }

  private readonly handleError = (error: Error): void => {
    this.prepared = false;
    // Preparation errors are returned to the caller; late install errors also
    // reach the existing update state instead of becoming unhandled events.
    if (!this.preparation && !this.disposed) this.onError(error);
  };

  private async stage(archivePath: string, version: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const feed = await createMacUpdateFeed(archivePath, version);
    try {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          this.nativeUpdater.removeListener('error', onError);
          this.nativeUpdater.removeListener('update-downloaded', onDownloaded);
          this.nativeUpdater.removeListener('update-not-available', onUnavailable);
          signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        };
        const onError = (error: Error) => finish(error);
        const onAbort = () => finish(asError(signal.reason));
        const onUnavailable = () => finish(new Error('The macOS update could not be prepared.'));
        const onDownloaded = (...args: unknown[]) => {
          // Ignore a late completion from an earlier cancelled native request.
          if (args.includes(feed.archiveUrl)) finish();
        };
        this.nativeUpdater.on('error', onError);
        this.nativeUpdater.on('update-downloaded', onDownloaded);
        this.nativeUpdater.on('update-not-available', onUnavailable);
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          signal.throwIfAborted();
          this.nativeUpdater.setFeedURL({ url: feed.url, serverType: 'default' });
          if (!settled) this.nativeUpdater.checkForUpdates();
        } catch (error) { finish(asError(error)); }
      });
    } finally {
      feed.close();
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
