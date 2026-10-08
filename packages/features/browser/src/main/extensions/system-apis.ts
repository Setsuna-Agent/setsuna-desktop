import type { BrowserWindow, ContextMenuParams, Extension, Session, WebContents } from 'electron';
import { EXTENSION_SYSTEM_CHANNELS as channels, type ExtensionSystemEvent } from '../../contracts/extension-api.js';
import { ExtensionContexts } from './contexts.js';
import { BrowserExtensionDebugger } from './debugger.js';
import { BrowserExtensionCommands } from './commands.js';
import { BrowserExtensionContextMenus } from './context-menus.js';
import { BrowserExtensionDownloads } from './downloads.js';
import { BrowserExtensionNavigation } from './navigation.js';
import { BrowserExtensionNativeMessaging } from './native-messaging/service.js';
import { BrowserExtensionScripting } from './scripting.js';
import type { BrowserExtensionActiveTabs } from './active-tabs.js';
import type { BrowserExtensionPermissions } from './permissions/service.js';
import { BrowserExtensionCookies, canReadCookie } from './cookies.js';
import { BrowserExtensionBookmarks } from './bookmarks.js';
import { managedStorageCall } from './managed-storage.js';
import { SYSTEM_EXTENSION_PERMISSIONS } from './capabilities.js';
import { observeExtensionContents } from './contents-lifecycle.js';
import type { BrowserExtensionFavicons } from './favicons.js';

/** Permission-gated browser APIs use the same authenticated frame/worker transport. */
export class BrowserExtensionSystemApis {
  private readonly contexts: ExtensionContexts<ExtensionSystemEvent>;
  private readonly debugger: BrowserExtensionDebugger;
  private readonly commands: BrowserExtensionCommands;
  private readonly menus: BrowserExtensionContextMenus;
  private readonly downloads: BrowserExtensionDownloads;
  private readonly navigation: BrowserExtensionNavigation;
  private readonly scripting: BrowserExtensionScripting;
  private readonly cookies: BrowserExtensionCookies;
  private readonly bookmarks: BrowserExtensionBookmarks;
  private readonly nativeMessaging = new BrowserExtensionNativeMessaging();
  private readonly guests = new Map<number, { contents: WebContents; dispose(): void }>();
  constructor(private readonly options: { session: Session; resolve(url: string): Extension | null; ownsGuest(contents: WebContents): boolean;
    owner(contents: WebContents): BrowserWindow | null; activate(extension: Extension, contents: WebContents): void;
    permissions: BrowserExtensionPermissions; favicons: BrowserExtensionFavicons; windows(): readonly BrowserWindow[];
    activeTabs: BrowserExtensionActiveTabs; executeScript: ConstructorParameters<typeof BrowserExtensionScripting>[1] }) {
    this.contexts = new ExtensionContexts({ ...options, channels,
      bootstrap: (extension, key) => {
        const declared = [...(extension.manifest.permissions ?? []), ...(extension.manifest.optional_permissions ?? [])];
        return { ...Object.fromEntries(SYSTEM_EXTENSION_PERMISSIONS.map(permission => [permission, declared.includes(permission)])),
          ...(declared.includes('favicon') ? { faviconUrl: options.favicons.resourceUrl(extension, key) } : {}) };
      },
      call: (extension, key, method, args) => this.call(extension, key, method, args),
      closed: (key) => { this.nativeMessaging.closeContext(key); options.favicons.release(key); } });
    const guests = () => [...this.guests.values()].map(({ contents }) => contents).filter(options.ownsGuest);
    this.debugger = new BrowserExtensionDebugger(guests, (id, event) => this.publish(id, event));
    this.commands = new BrowserExtensionCommands(options.session, options.owner, (id, event) => this.publish(id, event), options.activate);
    this.menus = new BrowserExtensionContextMenus((id, event) => this.publish(id, event),
      id => Boolean(options.resolve(`chrome-extension://${id}/`)?.manifest.permissions?.includes('contextMenus')));
    this.downloads = new BrowserExtensionDownloads(options.session, (event) => this.broadcast('downloads', event));
    this.navigation = new BrowserExtensionNavigation(guests, (event) => this.broadcast('webNavigation', event));
    this.scripting = new BrowserExtensionScripting(options.activeTabs, options.executeScript);
    this.cookies = new BrowserExtensionCookies({ session: options.session,
      resolve: (id) => options.resolve(`chrome-extension://${id}/`),
      tabIds: () => guests().map(contents => contents.id), publish: (id, event) => this.publish(id, event) });
    this.bookmarks = new BrowserExtensionBookmarks({ windows: options.windows, resolve: id => options.resolve(`chrome-extension://${id}/`) });
  }

  start(): void { this.contexts.start(); this.downloads.start(); this.cookies.start(); }
  profileStarted(id: string): void { this.contexts.notify(id, { kind: 'startup' }); }
  track(contents: WebContents): () => void {
    if (contents.isDestroyed() || this.guests.has(contents.id)) return () => undefined;
    const untrackCommands = this.commands.track(contents);
    const dispose = () => {
      this.guests.delete(contents.id); unobserve(); untrackCommands(); this.navigation.forget(contents);
    };
    this.guests.set(contents.id, { contents, dispose });
    const unobserve = observeExtensionContents(contents, { destroyed: dispose });
    return dispose;
  }
  contextMenuItems(contents: WebContents, params: ContextMenuParams) {
    const owner = this.options.owner(contents);
    return owner && this.options.ownsGuest(contents) ? this.menus.entries(contents, params, owner.id) : [];
  }
  requestNavigationTarget(contents: WebContents, url: string) { return this.navigation.requestTarget(contents, url); }
  registerNavigationTarget(tabId: string, contents: WebContents): void { this.navigation.registerTarget(tabId, contents); }
  remove(id: string): void { this.debugger.remove(id); this.menus.remove(id); this.nativeMessaging.remove(id); this.contexts.remove(id); }
  dispose(): void {
    this.debugger.dispose(); this.downloads.dispose(); this.cookies.dispose(); this.menus.dispose(); this.navigation.dispose(); this.nativeMessaging.dispose(); this.contexts.dispose();
    for (const { dispose } of [...this.guests.values()]) dispose();
  }

  private async call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown> {
    if (method.startsWith('permissions.')) {
      const release = this.contexts.endpoint(key)?.hold();
      try { return await this.options.permissions.call(extension, method.slice(12), args); }
      finally { release?.(); }
    }
    if (method.startsWith('cookies.')) return this.cookies.call(extension, method.slice(8), args);
    if (method.startsWith('bookmarks.')) return this.bookmarks.call(extension, method.slice(10), args);
    if (method.startsWith('storage.managed.')) return managedStorageCall(extension, method.slice(16), args);
    if (method === 'scripting.executeScript') return this.scripting.execute(extension, args[0]);
    if (method.startsWith('nativeMessaging.')) {
      const context = this.contexts.endpoint(key);
      if (!context) throw new Error('Extension context unavailable.');
      return this.nativeMessaging.call(extension, context, method.slice(16), args);
    }
    if (method.startsWith('debugger.')) return this.debugger.call(extension, method.slice(9), args);
    if (method === 'commands.getAll') return this.commands.getAll(extension);
    if (method.startsWith('contextMenus.')) return this.menus.call(extension, method.slice(13), args);
    if (method.startsWith('downloads.')) return this.downloads.call(extension, method.slice(10), args);
    if (method === 'webNavigation.getAllFrames') return this.navigation.getAllFrames(extension, args[0]);
    throw new Error(`Unsupported extension browser API: ${method}.`);
  }

  publish(id: string, event: ExtensionSystemEvent): void {
    // Permission persistence has succeeded before this event. Clear owned resources
    // synchronously, before remove() replies or waking a dormant worker can delay delivery.
    if (event.kind === 'permissionsRemoved') {
      if (event.permissions.permissions.includes('contextMenus')) this.menus.remove(id);
      if (event.permissions.permissions.includes('nativeMessaging')) this.nativeMessaging.remove(id);
    }
    void this.contexts.endpoints(id).then((endpoints) => {
      const extension = this.options.resolve(`chrome-extension://${id}/`);
      if (!extension || event.kind === 'cookieChanged' && (!extension.manifest.permissions?.includes('cookies')
        || !canReadCookie(extension, event.changeInfo.cookie))
        || event.kind === 'contextMenuClicked' && !extension.manifest.permissions?.includes('contextMenus')) return;
      for (const endpoint of endpoints) endpoint.send(event);
    })
      .catch(() => undefined);
  }
  private broadcast(permission: string, event: ExtensionSystemEvent): void {
    for (const native of this.options.session.extensions.getAllExtensions()) {
      const extension = this.options.resolve(`chrome-extension://${native.id}/`);
      if (extension?.manifest.permissions?.includes(permission)) this.publish(extension.id, event);
    }
  }
}
