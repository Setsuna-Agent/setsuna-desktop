import { BrowserWindow, type Extension, type Session, type WebContents } from 'electron';
import { extensionPageUrl, resolveExtensionPage } from './metadata.js';
import type { BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';
import { createExtensionPopup } from './popup.js';

/** Extension documents share browser storage, never the privileged desktop preload. */
export class BrowserExtensionPages {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(private readonly session: Session, private readonly openWebPage: (owner: BrowserWindow, url: string) => void,
    private readonly track: (contents: WebContents) => () => void = () => () => undefined) {}

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
    const popup = view === 'popup' ? createExtensionPopup(owner, this.session, anchor) : this.documentWindow(extension, owner);
    return this.load(extension, owner, popup, key, url);
  }

  /** Extension-created documents (including installation confirmations) use the same host. */
  async create(extension: Extension, url: string, owner: BrowserWindow, active: boolean): Promise<WebContents> {
    const destination = resolveExtensionPage(extension.id, url);
    if (!destination || owner.isDestroyed()) throw new Error('Extension document unavailable.');
    const window = this.documentWindow(extension, owner);
    if (!await this.load(extension, owner, window, `${extension.id}:tab:${window.id}`, destination, active) || window.isDestroyed()) {
      throw new Error('Extension document closed before loading.');
    }
    return window.webContents;
  }

  removeTab(extensionId: string, tabId: number): boolean {
    for (const [key, window] of this.windows) {
      if (key.startsWith(`${extensionId}:`) && !window.isDestroyed() && window.webContents.id === tabId) {
        window.close(); return true;
      }
    }
    return false;
  }

  private documentWindow(extension: Extension, owner: BrowserWindow): BrowserWindow {
    return new BrowserWindow({
      parent: owner, title: extension.name,
      width: 860, height: 680,
      show: false, autoHideMenuBar: true,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
  }

  private async load(extension: Extension, owner: BrowserWindow, popup: BrowserWindow, key: string, url: string, active = true): Promise<boolean> {
    this.windows.set(key, popup);
    const untrack = this.track(popup.webContents);
    popup.once('closed', () => { this.windows.delete(key); untrack(); });
    const allowed = (destination: string) => Boolean(resolveExtensionPage(extension.id, destination));
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
      if (active) popup.show();
      else popup.showInactive();
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
