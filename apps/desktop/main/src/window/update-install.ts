import type { BrowserWindow, Event, MessageBoxSyncOptions } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';

type UpdateInstallHost = {
  getWindows(): BrowserWindow[];
  confirmDiscard(window: BrowserWindow): boolean;
  stopRuntime(): Promise<void>;
  recover(): void;
};

/** Keep services alive until every window has accepted closing, including its draft guard. */
export class DesktopUpdateInstallCoordinator {
  active = false;

  constructor(private readonly host: UpdateInstallHost) {}

  async install(quitAndInstall: () => void): Promise<boolean> {
    this.active = true;
    try {
      for (const window of this.host.getWindows()) {
        if (!await closeForUpdate(window, this.host.confirmDiscard)) {
          this.recover();
          return false;
        }
      }
      await this.host.stopRuntime();
      // Squirrel must only take ownership after the cancellable close phase.
      // Calling it earlier leaves a native window observer armed even after cancellation.
      quitAndInstall();
      return true;
    } catch (error) {
      this.recover();
      throw error;
    }
  }

  recover(): void {
    if (!this.active) return;
    this.active = false;
    this.host.recover();
  }
}

function closeForUpdate(window: BrowserWindow, confirmDiscard: UpdateInstallHost['confirmDiscard']): Promise<boolean> {
  if (window.isDestroyed()) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const contents = window.webContents;
    const cleanup = () => {
      window.removeListener('closed', onClosed);
      window.removeListener('close', onClose);
      contents.removeListener('will-prevent-unload', onPreventUnload);
    };
    const finish = (closed: boolean) => { cleanup(); resolve(closed); };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const onClosed = () => finish(true);
    const onClose = (event: Event) => {
      // Other main-process close handlers may veto after this listener runs.
      queueMicrotask(() => { if (event.defaultPrevented) finish(false); });
    };
    const onPreventUnload = (event: Event) => {
      try {
        if (confirmDiscard(window)) event.preventDefault();
        else finish(false);
      } catch (error) { fail(error); }
    };
    window.once('closed', onClosed);
    window.on('close', onClose);
    contents.on('will-prevent-unload', onPreventUnload);
    try { window.close(); } catch (error) { fail(error); }
  });
}

export function updateInstallUnsavedDialog(locale: RuntimeInterfaceLanguage): MessageBoxSyncOptions {
  const english = locale === 'en-US';
  return {
    type: 'warning',
    title: english ? 'Restart to update' : '重启更新',
    message: english ? 'There are unsaved changes.' : '有尚未保存的更改。',
    detail: english
      ? 'Return to save your changes, then restart the update. Or discard them and restart now.'
      : '可以返回保存更改，再重新点击更新；也可以放弃更改并立即重启。',
    buttons: english ? ['Return to save', 'Discard and restart'] : ['返回保存', '放弃并重启'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
