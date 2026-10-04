import { BrowserWindow, type Extension, type Session } from 'electron';
import { extensionPageUrl } from './metadata.js';
import type { BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';
import { createExtensionPopup } from './popup.js';

/** Extension documents share browser storage, never the privileged desktop preload. */
export class BrowserExtensionPages {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(private readonly session: Session, private readonly openWebPage: (owner: BrowserWindow, url: string) => void) {}

  async open(extension: Extension, view: 'popup' | 'options', owner: BrowserWindow, anchor?: BrowserExtensionPopupAnchor, popupUrl?: string): Promise<boolean> {
    const url = popupUrl ?? extensionPageUrl(extension, view);
    if (!url || owner.isDestroyed()) return false;
    const key = `${extension.id}:${view}:${owner.id}`;
    const existing = this.windows.get(key);
    if (existing && !existing.isDestroyed()) {
      if (view === 'popup') existing.destroy();
      else { existing.show(); existing.focus(); }
      return true;
    }
    if (view === 'popup') {
      for (const [otherKey, window] of this.windows) {
        if (otherKey.endsWith(`:popup:${owner.id}`) && !window.isDestroyed()) window.destroy();
      }
    }
    const popup = view === 'popup' ? createExtensionPopup(owner, this.session, anchor) : new BrowserWindow({
      parent: owner, title: extension.name,
      width: 860, height: 680,
      show: false, autoHideMenuBar: true,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.windows.set(key, popup);
    popup.once('closed', () => { this.windows.delete(key); });
    const allowed = (destination: string) => {
      try { const target = new URL(destination); return target.protocol === 'chrome-extension:' && target.host === extension.id; }
      catch { return false; }
    };
    popup.webContents.on('will-navigate', (event, destination) => {
      if (allowed(destination)) return;
      event.preventDefault();
      this.openWebPage(owner, destination);
    });
    popup.webContents.setWindowOpenHandler(({ url: destination }) => {
      if (allowed(destination)) void popup.loadURL(destination).catch(() => undefined);
      else this.openWebPage(owner, destination);
      return { action: 'deny' };
    });
    try {
      await popup.loadURL(url);
      if (popup.isDestroyed()) return true;
      popup.show();
      return true;
    } catch {
      // Dismissal while a document is loading is an intentional cancellation.
      if (popup.isDestroyed()) return true;
      popup.destroy();
      return false;
    }
  }

  close(extensionId?: string): void {
    for (const [key, window] of this.windows) {
      if (extensionId && !key.startsWith(`${extensionId}:`)) continue;
      if (!window.isDestroyed()) window.destroy();
    }
  }
}
