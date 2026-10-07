import { BrowserWindow, webContents, type Extension, type Session, type WebContents } from 'electron';
import { EXTENSION_TABS_CHANNELS as channels, type ExtensionTab, type ExtensionTabEvent } from '../../contracts/extension-api.js';
import { ExtensionContexts } from './contexts.js';
import type { BrowserExtensionPages } from './pages.js';
import { matchesHost } from './user-scripts/match-pattern.js';
import { resolveExtensionPage } from './metadata.js';

type Options = {
  session: Session;
  resolve(url: string): Extension | null;
  pages: BrowserExtensionPages;
  owner(contents: WebContents): BrowserWindow | null;
  activeOwner(): BrowserWindow | null;
  activeTabAccess?(extensionId: string, contents: WebContents): boolean;
};

/** Electron exposes tab events but does not deliver guest navigations to extension workers. */
export class BrowserExtensionTabs {
  private readonly contexts: ExtensionContexts<ExtensionTabEvent>;
  private readonly tracked = new Map<number, () => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: Options) {
    this.contexts = new ExtensionContexts({ ...options, channels, bootstrap: () => true,
      call: (extension, _key, method, args) => this.call(extension, method, args) });
  }

  start(): void { this.contexts.start(); }
  remove(id: string): void { this.contexts.remove(id); }

  track(contents: WebContents): () => void {
    if (this.tracked.has(contents.id)) return () => undefined;
    // Extension documents have their own native window, parented to the desktop.
    // Cache ownership while contents is alive; its native getters fail after removal.
    const owner = this.options.owner(contents) ?? BrowserWindow.fromWebContents(contents)?.getParentWindow();
    if (!owner || owner.isDestroyed()) return () => undefined;
    const windowId = owner.id;
    const updated = (status: ExtensionTab['status'], pendingUrl?: string) => {
      if (contents.isDestroyed()) return;
      const tab = extensionTabDetails(contents, status, pendingUrl, windowId);
      this.publish({ kind: 'updated', tabId: contents.id, changeInfo: { status, ...(status === 'complete' ? { url: tab.url } : {}) }, tab });
    };
    const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) updated('loading', event.url);
    };
    const complete = () => updated('complete');
    const inPage = (_event: Electron.Event, url: string, isMainFrame: boolean) => {
      if (!isMainFrame || contents.isDestroyed()) return;
      const tab = extensionTabDetails(contents, contents.isLoadingMainFrame() ? 'loading' : 'complete', undefined, windowId);
      // SPA routing changes only the URL, without a loading/complete transition.
      this.publish({ kind: 'updated', tabId: contents.id, changeInfo: { url }, tab });
    };
    const destroyed = () => {
      this.publish({ kind: 'removed', tabId: contents.id, removeInfo: { windowId, isWindowClosing: owner.isDestroyed() } });
      dispose();
    };
    const dispose = () => {
      this.tracked.delete(contents.id);
      contents.off('did-start-navigation', navigating).off('did-finish-load', complete)
        .off('did-navigate-in-page', inPage).off('destroyed', destroyed);
    };
    this.tracked.set(contents.id, dispose);
    contents.on('did-start-navigation', navigating).on('did-finish-load', complete)
      .on('did-navigate-in-page', inPage).once('destroyed', destroyed);
    return dispose;
  }

  dispose(): void {
    this.disposed = true; this.contexts.dispose();
    for (const dispose of [...this.tracked.values()]) dispose();
  }

  private async call(extension: Extension, method: string, args: unknown[]): Promise<unknown> {
    if (this.disposed) throw new Error('Extension context unavailable.');
    if (method === 'create') {
      const properties = args[0];
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Invalid createProperties.');
      const { url, active } = properties as { url?: unknown; active?: unknown };
      // Do not pretend a fire-and-forget website opening has a native tab ID. This bridge
      // currently creates extension documents; website tabs keep their desktop UI owner.
      const destination = resolveExtensionPage(extension.id, url);
      if (!destination) throw new Error('tabs.create currently supports documents of the calling extension.');
      if (active !== undefined && typeof active !== 'boolean') throw new Error('Invalid active property.');
      const owner = this.options.activeOwner();
      if (!owner || owner.isDestroyed()) throw new Error('Browser window unavailable.');
      const contents = await this.options.pages.create(extension, destination, owner, active !== false);
      return extensionTabDetails(contents, 'complete', undefined, owner.id);
    }
    if (method === 'remove') {
      const ids = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (!ids.length || !ids.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid tab IDs.');
      for (const id of ids) if (!this.options.pages.removeTab(extension.id, id)) throw new Error(`No extension document with id: ${id}.`);
      return;
    }
    throw new Error(`Unsupported tabs method: ${method}.`);
  }

  private publish(event: ExtensionTabEvent): void {
    // Preserve navigation order while starting a suspended background worker. The event
    // snapshot belongs to this navigation, not whichever URL finishes loading later.
    this.queue = this.queue.catch(() => undefined).then(async () => {
      for (const extension of this.options.session.extensions.getAllExtensions()) {
        if (this.disposed || !this.options.resolve(`chrome-extension://${extension.id}/`)) continue;
        const contents = event.kind === 'updated' && webContents.fromId(event.tabId);
        const filtered = event.kind === 'updated' ? eventForExtension(extension, event,
          Boolean(contents && this.options.activeTabAccess?.(extension.id, contents))) : event;
        for (const endpoint of await this.contexts.endpoints(extension.id)) {
          if (this.disposed) return;
          endpoint.send(filtered);
        }
      }
    }).catch((error) => { if (!this.disposed) console.error('Failed to deliver browser extension tab event.', error); });
  }
}

export function extensionTabDetails(contents: WebContents, status: ExtensionTab['status'], pendingUrl?: string, windowId = 0): ExtensionTab {
  return { id: contents.id, windowId, index: 0, active: contents.isFocused(), highlighted: contents.isFocused(),
    pinned: false, incognito: !contents.session.isPersistent(), status, url: contents.getURL(), title: contents.getTitle(),
    ...(pendingUrl ? { pendingUrl } : {}) };
}

function eventForExtension(extension: Extension, event: Extract<ExtensionTabEvent, { kind: 'updated' }>, activeTab = false): ExtensionTabEvent {
  if (extension.manifest.permissions?.includes('tabs')) return event;
  const allowed = (url: string | undefined) => Boolean(url
    && (resolveExtensionPage(extension.id, url) || matchesHost(url, extension.manifest.host_permissions ?? [])));
  const { url, pendingUrl, title, ...tab } = event.tab;
  // The previous document and the pending destination can have different host grants.
  const currentAllowed = allowed(url) || activeTab && url === webContents.fromId(event.tabId)?.getURL();
  return { ...event, changeInfo: currentAllowed ? event.changeInfo
    : event.changeInfo.status ? { status: event.changeInfo.status } : {}, tab: {
    ...tab, ...(currentAllowed ? { url, title } : {}), ...(pendingUrl && allowed(pendingUrl) ? { pendingUrl } : {}),
  } };
}
