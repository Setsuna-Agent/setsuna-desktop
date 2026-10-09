import { BrowserWindow, webContents, type Extension, type Session, type WebContents } from 'electron';
import { EXTENSION_TABS_CHANNELS as channels, type ExtensionTab, type ExtensionTabEvent, type ExtensionTabReadDetails, type ExtensionTabReadQuery } from '../../contracts/extension-api.js';
import { ExtensionContexts } from './contexts.js';
import type { BrowserExtensionPages } from './pages.js';
import { compileMatchPattern, matchesHost } from './user-scripts/match-pattern.js';
import { resolveExtensionPage } from './metadata.js';
import { observeExtensionContents } from './contents-lifecycle.js';

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
  private readonly selected = new Map<number, number | null>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: Options) {
    this.contexts = new ExtensionContexts({ ...options, channels, bootstrap: () => true,
      call: (extension, key, method, args) => this.call(extension, key, method, args) });
  }

  start(): void { this.contexts.start(); }
  remove(id: string): void { this.contexts.remove(id); }

  select(owner: BrowserWindow, id: number | null): boolean {
    if (this.disposed || owner.isDestroyed()) return false;
    if (id === null) { this.selected.set(owner.id, null); return true; }
    const contents = webContents.fromId(id);
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview'
      || !this.tracked.has(id) || this.options.owner(contents) !== owner) return false;
    this.selected.set(owner.id, id);
    return true;
  }

  forgetWindow(owner: BrowserWindow): void { this.selected.delete(owner.id); }

  track(contents: WebContents): () => void {
    if (contents.isDestroyed() || this.tracked.has(contents.id)) return () => undefined;
    // Extension documents have their own native window, parented to the desktop.
    // Cache ownership while contents is alive; its native getters fail after removal.
    const owner = this.options.owner(contents) ?? BrowserWindow.fromWebContents(contents)?.getParentWindow();
    if (!owner || owner.isDestroyed()) return () => undefined;
    const windowId = owner.id;
    const updated = (status: ExtensionTab['status'], pendingUrl?: string) => {
      if (contents.isDestroyed()) return;
      const tab = this.details(contents, status, pendingUrl, windowId);
      this.publish({ kind: 'updated', tabId: contents.id, changeInfo: { status, ...(status === 'complete' ? { url: tab.url } : {}) }, tab });
    };
    const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) updated('loading', event.url);
    };
    const complete = () => updated('complete');
    const inPage = (_event: Electron.Event, url: string, isMainFrame: boolean) => {
      if (!isMainFrame || contents.isDestroyed()) return;
      const tab = this.details(contents, contents.isLoadingMainFrame() ? 'loading' : 'complete', undefined, windowId);
      // SPA routing changes only the URL, without a loading/complete transition.
      this.publish({ kind: 'updated', tabId: contents.id, changeInfo: { url }, tab });
    };
    const destroyed = () => {
      this.publish({ kind: 'removed', tabId: contents.id, removeInfo: { windowId, isWindowClosing: owner.isDestroyed() } });
      dispose();
    };
    const dispose = () => {
      this.tracked.delete(contents.id);
      if (owner.isDestroyed()) this.selected.delete(windowId);
      else if (this.selected.get(windowId) === contents.id) this.selected.set(windowId, null);
      contents.off('did-start-navigation', navigating).off('did-finish-load', complete)
        .off('did-navigate-in-page', inPage);
      unobserve();
    };
    this.tracked.set(contents.id, dispose);
    contents.on('did-start-navigation', navigating).on('did-finish-load', complete)
      .on('did-navigate-in-page', inPage);
    const unobserve = observeExtensionContents(contents, { destroyed });
    return dispose;
  }

  dispose(): void {
    this.disposed = true; this.contexts.dispose();
    for (const dispose of [...this.tracked.values()]) dispose();
    this.selected.clear();
  }

  private async call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown> {
    if (this.disposed) throw new Error('Extension context unavailable.');
    if (method === 'read') return this.read(extension, key, args[0], args[1]);
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

  private selection(contents: WebContents): Pick<ExtensionTab, 'windowId' | 'active' | 'highlighted'> | null {
    if (contents.session !== this.options.session || contents.getType() !== 'webview' || !this.tracked.has(contents.id)) return null;
    const owner = this.options.owner(contents);
    if (!owner || owner.isDestroyed()) return null;
    // Explicit selection includes null: home and a closed guest must not select
    // an arbitrary hidden page merely because it retains native focus.
    const active = this.selected.has(owner.id) ? this.selected.get(owner.id) === contents.id : contents.isFocused();
    return { windowId: owner.id, active, highlighted: active };
  }

  private details(contents: WebContents, status: ExtensionTab['status'], pendingUrl?: string, windowId = 0): ExtensionTab {
    return { ...extensionTabDetails(contents, status, pendingUrl, windowId), ...this.selection(contents) };
  }

  private read(extension: Extension, key: string, ids: unknown, query: unknown): ExtensionTabReadDetails[] {
    if (!Array.isArray(ids) || !ids.every(id => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid tab IDs.');
    const filters = query === undefined ? {} : query;
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Invalid tab query.');
    const { url, title, active, highlighted, currentWindow, lastFocusedWindow, windowId } = filters as ExtensionTabReadQuery;
    for (const value of [active, highlighted, currentWindow, lastFocusedWindow]) {
      if (value !== undefined && typeof value !== 'boolean') throw new Error('Invalid tab query.');
    }
    if (windowId !== undefined && !Number.isSafeInteger(windowId)) throw new Error('Invalid window ID.');
    if (title !== undefined && typeof title !== 'string') throw new Error('Invalid tab title pattern.');
    const patterns = url === undefined ? [] : typeof url === 'string' ? [url] : url;
    if (!Array.isArray(patterns) || !patterns.every(pattern => typeof pattern === 'string')) throw new Error('Invalid tab URL patterns.');
    const urls = patterns.map(pattern => {
      const compiled = compileMatchPattern(pattern, true);
      if (!compiled) throw new Error('Invalid tab URL pattern.');
      return compiled;
    });
    const titlePattern = title !== undefined ? compileTabTitlePattern(title) : null;
    const context = this.contexts.frameContents(key);
    const currentOwner = context ? this.options.owner(context) ?? BrowserWindow.fromWebContents(context)?.getParentWindow() : null;
    const focusedId = this.options.activeOwner()?.id ?? -1;
    const currentId = currentOwner && !currentOwner.isDestroyed() ? currentOwner.id : focusedId;
    const requestedWindowId = windowId === -2 ? currentId : windowId;
    const result: ExtensionTabReadDetails[] = [];
    for (const id of ids) {
      const contents = webContents.fromId(id);
      // IDs and queries come from the extension. All private fields come from the owned partition.
      const available = contents && !contents.isDestroyed() && contents.session === this.options.session;
      const selection = available ? this.selection(contents) : null;
      // Extension documents keep Chromium's filtering and window identity. Only
      // owned guests have a host selection to apply; preload retains native matches.
      if (selection && (active !== undefined && selection.active !== active
        || highlighted !== undefined && selection.highlighted !== highlighted
        || requestedWindowId !== undefined && selection.windowId !== requestedWindowId
        || currentWindow && selection.windowId !== currentId
        || lastFocusedWindow && selection.windowId !== focusedId)) continue;
      const tab: ExtensionTabReadDetails = available
        ? extensionTabForExtension(extension, extensionTabDetails(contents, 'complete'),
          Boolean(this.options.activeTabAccess?.(extension.id, contents))) : { id };
      const tabUrl = tab.url;
      if ((urls.length || titlePattern) && (tabUrl === undefined
        || urls.length && !urls.some(pattern => pattern.test(tabUrl))
        || titlePattern && !titlePattern.test(tab.title ?? ''))) continue;
      result.push({ id, ...selection, ...(tab.url !== undefined ? { url: tab.url, title: tab.title } : {}) });
    }
    return result;
  }

  private publish(event: ExtensionTabEvent): void {
    // Preserve navigation order while starting a suspended background worker. The event
    // snapshot belongs to this navigation, not whichever URL finishes loading later.
    this.queue = this.queue.catch(() => undefined).then(async () => {
      for (const native of this.options.session.extensions.getAllExtensions()) {
        if (this.disposed || !this.options.resolve(`chrome-extension://${native.id}/`)) continue;
        const endpoints = await this.contexts.endpoints(native.id);
        // Worker startup may outlive a permission change. Filter the original event
        // only after it finishes, using both current host grants and activeTab access.
        const extension = this.options.resolve(`chrome-extension://${native.id}/`);
        if (this.disposed) return;
        if (!extension) continue;
        const contents = event.kind === 'updated' && webContents.fromId(event.tabId);
        const filtered = event.kind === 'updated' ? eventForExtension(extension, event,
          Boolean(contents && this.options.activeTabAccess?.(extension.id, contents))) : event;
        for (const endpoint of endpoints) {
          if (this.disposed) return;
          endpoint.send(filtered);
        }
      }
    }).catch((error) => { if (!this.disposed) console.error('Failed to deliver browser extension tab event.', error); });
  }
}

function compileTabTitlePattern(pattern: string): RegExp {
  // Chromium title patterns use an optional character for ? and allow escaped wildcards.
  let source = ''; let escaped = false;
  for (const character of pattern) {
    if (!escaped && character === '\\') { escaped = true; continue; }
    source += !escaped && character === '*' ? '.*' : !escaped && character === '?' ? '.?'
      : character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    escaped = false;
  }
  return new RegExp(`^${source}$`, 'su');
}

export function extensionTabDetails(contents: WebContents, status: ExtensionTab['status'], pendingUrl?: string, windowId = 0): ExtensionTab {
  return { id: contents.id, windowId, index: 0, active: contents.isFocused(), highlighted: contents.isFocused(),
    pinned: false, incognito: !contents.session.isPersistent(), status, url: contents.getURL(), title: contents.getTitle(),
    ...(pendingUrl ? { pendingUrl } : {}) };
}

function eventForExtension(extension: Extension, event: Extract<ExtensionTabEvent, { kind: 'updated' }>, activeTab = false): ExtensionTabEvent {
  const tab = extensionTabForExtension(extension, event.tab, activeTab && event.tab.url === webContents.fromId(event.tabId)?.getURL());
  return { ...event, tab, changeInfo: tab.url !== undefined ? event.changeInfo
    : event.changeInfo.status ? { status: event.changeInfo.status } : {} };
}

/** Queries, action clicks and navigation events enforce the same effective grant set. */
export function extensionTabForExtension(extension: Extension, details: ExtensionTab, activeTab = false): ExtensionTab {
  if (extension.manifest.permissions?.includes('tabs')) return details;
  const allowed = (url: string | undefined) => Boolean(url
    && (resolveExtensionPage(extension.id, url) || matchesHost(url, extension.manifest.host_permissions ?? [])));
  const { url, pendingUrl, title, ...tab } = details;
  // The previous document and the pending destination can have different host grants.
  return { ...tab, ...(allowed(url) || activeTab ? { url, title } : {}),
    ...(pendingUrl && allowed(pendingUrl) ? { pendingUrl } : {}) };
}
