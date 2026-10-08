import type { Extension, WebContents } from 'electron';
import { observeExtensionContents } from './contents-lifecycle.js';

type Tab = { origins: Map<string, string>; dispose(): void };

/** activeTab is an in-memory grant for one extension, one tab and its main-frame origin. */
export class BrowserExtensionActiveTabs {
  private readonly tabs = new Map<number, Tab>();
  constructor(private readonly ownsGuest: (contents: WebContents) => boolean) {}

  track(contents: WebContents): () => void {
    if (contents.isDestroyed() || this.tabs.has(contents.id)) return () => undefined;
    const changed = (_event: Electron.Event, url: string) => {
      const origin = scriptableOrigin(url);
      for (const [id, granted] of tab.origins) if (granted !== origin) tab.origins.delete(id);
    };
    const dispose = () => {
      this.tabs.delete(contents.id); tab.origins.clear();
      contents.off('did-navigate', changed); unobserve();
    };
    const tab: Tab = { origins: new Map(), dispose };
    this.tabs.set(contents.id, tab);
    // Navigation attempts, downloads, same-document changes and child frames do not revoke it.
    contents.on('did-navigate', changed);
    const unobserve = observeExtensionContents(contents, { destroyed: dispose });
    return dispose;
  }

  grant(extension: Extension, contents: WebContents): boolean {
    const tab = this.tabs.get(contents.id);
    if (!tab || !this.ownsGuest(contents) || !extension.manifest.permissions?.includes('activeTab')) return false;
    const origin = scriptableOrigin(contents.getURL());
    if (!origin) return false;
    tab.origins.set(extension.id, origin);
    return true;
  }

  has(extensionId: string, contents: WebContents): boolean {
    const origin = !contents.isDestroyed() && scriptableOrigin(contents.getURL());
    return Boolean(origin && this.ownsGuest(contents) && this.tabs.get(contents.id)?.origins.get(extensionId) === origin);
  }

  remove(id: string): void { for (const tab of this.tabs.values()) tab.origins.delete(id); }
  dispose(): void { for (const tab of [...this.tabs.values()]) tab.dispose(); }
}

function scriptableOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname === 'chromewebstore.google.com'
      || url.hostname === 'chrome.google.com' && /^\/webstore(?:\/|$)/.test(url.pathname)) return null;
    return url.origin;
  } catch { return null; }
}
