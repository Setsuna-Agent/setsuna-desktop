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

/** Permission-gated browser APIs use the same authenticated frame/worker transport. */
export class BrowserExtensionSystemApis {
  private readonly contexts: ExtensionContexts<ExtensionSystemEvent>;
  private readonly debugger: BrowserExtensionDebugger;
  private readonly commands: BrowserExtensionCommands;
  private readonly menus: BrowserExtensionContextMenus;
  private readonly downloads: BrowserExtensionDownloads;
  private readonly navigation: BrowserExtensionNavigation;
  private readonly scripting: BrowserExtensionScripting;
  private readonly nativeMessaging = new BrowserExtensionNativeMessaging();
  private readonly guests = new Map<number, { contents: WebContents; dispose(): void }>();
  constructor(private readonly options: { session: Session; resolve(url: string): Extension | null; ownsGuest(contents: WebContents): boolean;
    owner(contents: WebContents): BrowserWindow | null; activate(extension: Extension, contents: WebContents): void;
    activeTabs: BrowserExtensionActiveTabs; executeScript: ConstructorParameters<typeof BrowserExtensionScripting>[1] }) {
    this.contexts = new ExtensionContexts({ ...options, channels,
      bootstrap: (extension) => Object.fromEntries(['debugger', 'contextMenus', 'downloads', 'webNavigation', 'nativeMessaging', 'scripting']
        .map((permission) => [permission, extension.manifest.permissions?.includes(permission) ?? false])),
      call: (extension, key, method, args) => this.call(extension, key, method, args),
      closed: (key) => this.nativeMessaging.closeContext(key) });
    const guests = () => [...this.guests.values()].map(({ contents }) => contents).filter(options.ownsGuest);
    this.debugger = new BrowserExtensionDebugger(guests, (id, event) => this.publish(id, event));
    this.commands = new BrowserExtensionCommands(options.session, options.owner, (id, event) => this.publish(id, event), options.activate);
    this.menus = new BrowserExtensionContextMenus((id, event) => this.publish(id, event));
    this.downloads = new BrowserExtensionDownloads(options.session, (event) => this.broadcast('downloads', event));
    this.navigation = new BrowserExtensionNavigation(guests, (event) => this.broadcast('webNavigation', event));
    this.scripting = new BrowserExtensionScripting(options.activeTabs, options.executeScript);
  }

  start(): void { this.contexts.start(); this.downloads.start(); }
  track(contents: WebContents): () => void {
    if (this.guests.has(contents.id)) return () => undefined;
    const untrackCommands = this.commands.track(contents);
    const dispose = () => {
      this.guests.delete(contents.id); contents.off('destroyed', dispose); untrackCommands(); this.navigation.forget(contents);
    };
    this.guests.set(contents.id, { contents, dispose });
    contents.once('destroyed', dispose);
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
    this.debugger.dispose(); this.downloads.dispose(); this.menus.dispose(); this.navigation.dispose(); this.nativeMessaging.dispose(); this.contexts.dispose();
    for (const { dispose } of [...this.guests.values()]) dispose();
  }

  private async call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown> {
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

  private publish(id: string, event: ExtensionSystemEvent): void {
    void this.contexts.endpoints(id).then((endpoints) => { for (const endpoint of endpoints) endpoint.send(event); })
      .catch(() => undefined);
  }
  private broadcast(permission: string, event: ExtensionSystemEvent): void {
    for (const extension of this.options.session.extensions.getAllExtensions()) {
      if (extension.manifest.permissions?.includes(permission)) this.publish(extension.id, event);
    }
  }
}
