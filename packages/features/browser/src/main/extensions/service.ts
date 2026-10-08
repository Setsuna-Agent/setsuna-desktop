import { createRequire } from 'node:module';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { app, webContents, type BrowserWindow, type ContextMenuParams, type Extension, type Session, type WebContents } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { BROWSER_WEB_STORE_URL, type BrowserExtension, type BrowserExtensionPopupAnchor, type BrowserExtensionView } from '../../contracts/extensions.js';
import { confirmExtensionInstall, confirmExtensionPermissions } from './confirmation.js';
import { extensionMetadata, newestNewTabExtension, validExtensionId } from './metadata.js';
import { BrowserExtensionPages } from './pages.js';
import { BrowserExtensionActions } from './actions.js';
import { readInstalledExtensions } from './installations.js';
import { copyImportedExtension } from './import.js';
import { BrowserExtensionState } from './state.js';
import { BrowserUserScripts } from './user-scripts/service.js';
import { BrowserExtensionTabs } from './tabs.js';
import { BrowserExtensionUi } from './ui.js';
import { BrowserExtensionSystemApis } from './system-apis.js';
import { BrowserExtensionActiveTabs } from './active-tabs.js';
import { BrowserExtensionWorkerStartup } from './worker-startup.js';
import { BrowserExtensionPermissions } from './permissions/service.js';
import { BrowserExtensionLoadDiagnostics } from './load-diagnostics.js';
import { BrowserExtensionFavicons } from './favicons.js';

// Load the package's CJS entry intact so its packaged preload resolves beside it.
const webStore: typeof import('electron-chrome-web-store') = createRequire(import.meta.url)('electron-chrome-web-store');
type InstallOptions = NonNullable<Parameters<typeof webStore.installChromeWebStore>[0]>;
type InstallDetails = Parameters<NonNullable<InstallOptions['beforeInstall']>>[0];

export class BrowserExtensionService {
  private readonly directory: string;
  private readonly pages: BrowserExtensionPages;
  private readonly state: BrowserExtensionState;
  private readonly permissions: BrowserExtensionPermissions;
  private readonly diagnostics: BrowserExtensionLoadDiagnostics;
  private readonly favicons: BrowserExtensionFavicons;
  readonly actions: BrowserExtensionActions;
  readonly ui: BrowserExtensionUi;
  private readonly userScripts: BrowserUserScripts;
  private readonly tabs: BrowserExtensionTabs;
  private readonly system: BrowserExtensionSystemApis;
  private readonly activeTabs: BrowserExtensionActiveTabs;
  private readonly workerStartup: BrowserExtensionWorkerStartup;
  private readonly pending = new Set<string>();
  private preloadIds: string[] = [];
  private disposed = false;
  private revision = 0;
  private extensions: readonly BrowserExtension[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private startup: Promise<void> | null = null;
  private readonly lifetime = new AbortController();
  private readonly signal: AbortSignal;

  constructor(private readonly options: {
    session: Session;
    preloadPath: string;
    owner(contents: WebContents): BrowserWindow | null;
    language(): RuntimeInterfaceLanguage;
    publish(extensions: readonly BrowserExtension[]): void;
    actionsChanged(webContentsId: number | null): void;
    openWebPage(owner: BrowserWindow, url: string): void;
    activeOwner?(): BrowserWindow | null;
    windows?(): readonly BrowserWindow[];
    signal?: AbortSignal;
  }) {
    if (!options.session.storagePath) throw new Error('Browser extensions require persistent storage.');
    this.directory = path.join(options.session.storagePath, 'Extensions');
    this.signal = options.signal ? AbortSignal.any([options.signal, this.lifetime.signal]) : this.lifetime.signal;
    this.state = new BrowserExtensionState(path.join(options.session.storagePath, 'extensions-state.json'));
    this.diagnostics = new BrowserExtensionLoadDiagnostics({ directory: this.directory,
      resolve: (id) => this.nativeExtension(`chrome-extension://${id}/`), report: (message) => console.warn(message) });
    this.favicons = new BrowserExtensionFavicons({ session: options.session, resolve: url => this.managedExtension(url) });
    this.permissions = new BrowserExtensionPermissions({
      state: this.state, serialize: (operation) => this.mutate(operation),
      current: (id) => this.nativeExtension(`chrome-extension://${id}/`),
      confirm: (extension, requested) => {
        const owner = options.activeOwner?.() ?? options.windows?.()[0];
        if (!owner || owner.isDestroyed()) throw new Error('Browser window unavailable.');
        return confirmExtensionPermissions(owner, extension.name, requested, options.language());
      },
      publish: (id, event) => this.system.publish(id, event),
    });
    this.activeTabs = new BrowserExtensionActiveTabs(contents => this.ownsGuest(contents));
    this.pages = new BrowserExtensionPages(options.session, options.openWebPage, (contents) => this.tabs.track(contents));
    this.tabs = new BrowserExtensionTabs({ session: options.session, pages: this.pages,
      resolve: (url) => this.managedExtension(url), owner: options.owner, activeOwner: () => options.activeOwner?.() ?? null,
      activeTabAccess: (id, contents) => this.activeTabs.has(id, contents) });
    this.ui = new BrowserExtensionUi({ session: options.session, resolve: (url) => this.managedExtension(url),
      owner: options.owner, windows: () => options.windows?.() ?? [options.activeOwner?.()].filter((window): window is BrowserWindow => Boolean(window)),
      activeOwner: () => options.activeOwner?.() ?? null, activeTabs: this.activeTabs });
    this.actions = new BrowserExtensionActions(options.session, (url) => this.managedExtension(url), options.actionsChanged);
    this.system = new BrowserExtensionSystemApis({ session: options.session, resolve: (url) => this.managedExtension(url), permissions: this.permissions, favicons: this.favicons,
      windows: () => options.windows?.() ?? [options.activeOwner?.()].filter((window): window is BrowserWindow => Boolean(window)),
      ownsGuest: (contents) => this.ownsGuest(contents), owner: options.owner, activeTabs: this.activeTabs,
      executeScript: (...args) => this.userScripts.executeScript(...args), activate: (extension, contents) => {
        const owner = options.owner(contents); if (owner) void this.open(extension.id, 'action', owner, undefined, contents.id);
      } });
    this.userScripts = new BrowserUserScripts({ session: options.session, directory: path.join(options.session.storagePath, 'UserScripts'),
      resolve: (url) => this.managedExtension(url), allowed: (id) => this.state.allowsUserScripts(id), ownsGuest: (contents) => this.ownsGuest(contents) });
    this.workerStartup = new BrowserExtensionWorkerStartup({ session: options.session, signal: this.signal,
      profileStarted: (id) => this.system.profileStarted(id) });
  }

  start(): Promise<void> {
    if (this.signal.aborted) return Promise.resolve();
    return this.startup ??= this.restore();
  }

  private async restore(): Promise<void> {
    const { session } = this.options;
    await this.state.load();
    if (this.signal.aborted) return;
    this.diagnostics.start();
    this.favicons.start();
    this.userScripts.start();
    this.tabs.start();
    this.ui.start();
    this.system.start();
    this.actions.start(this.options.preloadPath);
    session.extensions.on('extension-loaded', this.changed);
    session.extensions.on('extension-unloaded', this.unloaded);
    const preloads = new Set(session.getPreloadScripts().map(({ id }) => id));
    try {
      await webStore.installChromeWebStore({
        session, extensionsPath: this.directory, minimumManifestVersion: 3,
        // Do not silently install a later manifest with newly requested permissions.
        autoUpdate: false, allowUnpackedExtensions: false, loadExtensions: false,
        beforeInstall: (details) => this.beforeInstall(details),
      });
    } finally {
      this.preloadIds = session.getPreloadScripts().map(({ id }) => id).filter((id) => !preloads.has(id));
      if (this.signal.aborted) for (const id of this.preloadIds) session.unregisterPreloadScript(id);
    }
    if (this.signal.aborted) return;
    // Restore only enabled installations, so disabled workers never briefly run at startup.
    for (const extension of await readInstalledExtensions(this.directory)) {
      if (this.signal.aborted) return;
      if (!this.state.isEnabled(extension.id)) continue;
      try { await this.load(extension, true); }
      catch (error) { console.error(`Failed to load browser extension ${extension.id}`, error); }
    }
    await this.refresh();
  }

  list(): readonly BrowserExtension[] { return this.extensions; }

  contextMenuItems(contents: WebContents, params: ContextMenuParams) { return this.system.contextMenuItems(contents, params); }
  requestNavigationTarget(contents: WebContents, url: string) { return this.system.requestNavigationTarget(contents, url); }
  registerNavigationTarget(tabId: string, contents: WebContents): void { this.system.registerNavigationTarget(tabId, contents); }

  importInstallation(source: Extension, enabled: boolean, signal: AbortSignal): Promise<boolean> {
    return this.mutate(async () => {
      if (!validExtensionId(source.id) || this.pending.has(source.id) || this.extensions.some((item) => item.id === source.id)) return false;
      this.pending.add(source.id);
      let location: string | null = null;
      try {
        location = await copyImportedExtension(source, this.directory, signal);
        if (!location) return false;
        signal.throwIfAborted();
        if (this.disposed) throw new Error('Browser extensions are unavailable.');
        await this.state.setEnabled(source.id, enabled);
        if (enabled) await this.load({ ...source, path: location });
        await this.refresh();
        return true;
      } catch (error) {
        if (location) {
          this.pages.close(source.id);
          await this.unload(source.id);
          await rm(path.dirname(location), { recursive: true, force: true });
          await this.state.setEnabled(source.id, true);
          await this.refresh();
        }
        throw error;
      } finally { this.pending.delete(source.id); }
    });
  }

  track(contents: WebContents): () => void {
    const untrackActiveTabs = this.activeTabs.track(contents);
    const untrackActions = this.actions.track(contents);
    const untrackScripts = this.userScripts.track(contents);
    const untrackTabs = this.tabs.track(contents);
    const untrackUi = this.ui.track(contents);
    const untrackSystem = this.system.track(contents);
    const untrackFavicons = this.favicons.track(contents);
    return () => { untrackActions(); untrackScripts(); untrackTabs(); untrackUi(); untrackSystem(); untrackActiveTabs(); untrackFavicons(); };
  }

  ownsGuest(contents: WebContents): boolean {
    return !this.disposed && !contents.isDestroyed() && contents.session === this.options.session && Boolean(this.options.owner(contents));
  }

  allowsPage(rawUrl: string): boolean {
    if (this.disposed) return false;
    try {
      const url = new URL(rawUrl);
      return url.protocol === 'chrome-extension:' && !url.username && !url.password && !url.port
        && this.extensions.some(({ id, enabled }) => enabled && id === url.hostname)
        && Boolean(this.options.session.extensions.getExtension(url.hostname));
    } catch { return false; }
  }

  remove(id: string): Promise<boolean> {
    return this.mutate(async () => {
      if (!validExtensionId(id) || !this.extensions.some((extension) => extension.id === id)) return false;
      const enabled = this.state.isEnabled(id);
      await this.state.setEnabled(id, true);
      try {
        this.pages.close(id);
        await webStore.uninstallExtension(id, { session: this.options.session, extensionsPath: this.directory });
      } catch (error) { await this.state.setEnabled(id, enabled); throw error; }
      await this.state.setUserScriptsAllowed(id, false);
      await this.state.setGrantedPermissions(id, { permissions: [], origins: [] });
      await this.userScripts.remove(id);
      await this.refresh();
      return true;
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<boolean> {
    return this.mutate(async () => {
      if (!validExtensionId(id)) return false;
      const extension = (await readInstalledExtensions(this.directory)).find((item) => item.id === id);
      if (!extension || this.disposed) return false;
      const wasEnabled = this.state.isEnabled(id);
      await this.state.setEnabled(id, enabled);
      if (this.disposed) return false;
      try {
        if (enabled) {
          if (!this.options.session.extensions.getExtension(id)) await this.load(extension);
        } else {
          this.pages.close(id);
          await this.unload(id);
        }
      } catch (error) {
        await this.state.setEnabled(id, wasEnabled);
        if (!wasEnabled) this.options.session.extensions.removeExtension(id);
        await this.refresh();
        throw error;
      }
      await this.refresh();
      return true;
    });
  }

  setUserScriptsAllowed(id: string, allowed: boolean): Promise<boolean> {
    return this.mutate(async () => {
      if (!validExtensionId(id)) return false;
      const extension = (await readInstalledExtensions(this.directory)).find((item) => item.id === id);
      if (!extension?.manifest.permissions?.includes('userScripts')) return false;
      const previous = this.state.allowsUserScripts(id);
      if (previous === allowed) return true;
      await this.state.setUserScriptsAllowed(id, allowed);
      this.userScripts.setAllowed(id, allowed);
      try {
        // Managers detect userScripts during startup. Reload their worker after granting access.
        if (this.options.session.extensions.getExtension(id)) {
          this.pages.close(id); await this.unload(id); await this.load(extension);
        }
      } catch (error) {
        await this.state.setUserScriptsAllowed(id, previous); this.userScripts.setAllowed(id, previous);
        await this.refresh(); throw error;
      }
      await this.refresh(); return true;
    });
  }

  async open(id: string, view: BrowserExtensionView, owner: BrowserWindow, anchor?: BrowserExtensionPopupAnchor, webContentsId?: number): Promise<boolean> {
    if (this.disposed || !validExtensionId(id) || !this.extensions.some((extension) => extension.enabled && extension.id === id)) return false;
    const extension = this.options.session.extensions.getExtension(id);
    const popup = this.actions.snapshot(webContentsId).find((action) => action.id === id)?.popup;
    if (!extension) return false;
    if (view === 'action') {
      if (popup === undefined ? this.extensions.find((item) => item.id === id)?.hasPopup : Boolean(popup)) {
        this.ui.grantActiveTab(extension, owner, webContentsId);
        return this.pages.open(extension, 'popup', owner, anchor, popup);
      }
      if (await this.ui.activate(extension, owner, webContentsId)) return true;
      return this.extensions.find((item) => item.id === id)?.hasOptions ? this.pages.open(extension, 'options', owner) : true;
    }
    return this.pages.open(extension, view, owner, anchor, view === 'popup' ? popup : undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    ++this.revision;
    this.pages.close();
    this.actions.dispose();
    this.ui.dispose();
    this.system.dispose();
    this.userScripts.dispose();
    this.tabs.dispose();
    this.activeTabs.dispose();
    this.diagnostics.dispose();
    this.favicons.dispose();
    this.options.session.extensions.off('extension-loaded', this.changed);
    this.options.session.extensions.off('extension-unloaded', this.unloaded);
    for (const id of this.preloadIds) this.options.session.unregisterPreloadScript(id);
  }

  private readonly changed = (_event?: Electron.Event, extension?: Extension) => {
    if (extension && !this.state.isEnabled(extension.id)) {
      this.options.session.extensions.removeExtension(extension.id);
    } else {
      if (extension && this.managedExtension(`chrome-extension://${extension.id}/`)) this.userScripts.load(extension);
      void this.refresh().catch(() => undefined);
    }
  };
  private readonly unloaded = (_event: Electron.Event, extension: Electron.Extension) => {
    this.workerStartup.remove(extension.id);
    this.activeTabs.remove(extension.id);
    this.actions.remove(extension.id); this.pages.close(extension.id); this.changed();
    this.userScripts.unload(extension.id);
    this.tabs.remove(extension.id);
    this.ui.remove(extension.id);
    this.system.remove(extension.id);
  };

  private managedExtension(rawUrl: string): Electron.Extension | null {
    const extension = this.nativeExtension(rawUrl);
    return extension ? this.permissions.effective(extension) : null;
  }

  private nativeExtension(rawUrl: string): Electron.Extension | null {
    if (this.signal.aborted) return null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'chrome-extension:' || !validExtensionId(url.hostname)) return null;
      const extension = this.options.session.extensions.getExtension(url.hostname);
      if (!extension || !this.state.isEnabled(extension.id)) return null;
      const relative = path.relative(this.directory, extension.path);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? extension : null;
    } catch { return null; }
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    const installed = await readInstalledExtensions(this.directory);
    const loaded = installed.map((extension) => this.options.session.extensions.getExtension(extension.id))
      .filter((extension): extension is Extension => Boolean(extension && this.state.isEnabled(extension.id)));
    const [extensions, newTabId] = await Promise.all([
      Promise.all(installed.map((extension) => {
        const native = loaded.find(({ id }) => id === extension.id);
        return extensionMetadata(native ?? extension, Boolean(native), app.getLocale(), this.state.allowsUserScripts(extension.id));
      })), newestNewTabExtension(loaded),
    ]);
    if (this.disposed || revision !== this.revision) return;
    this.extensions = extensions.map((extension) => extension.id === newTabId ? extension : { ...extension, newTabUrl: null })
      .sort((left, right) => left.name.localeCompare(right.name));
    this.options.publish(this.extensions);
  }

  private mutate(operation: () => Promise<boolean>): Promise<boolean> {
    // Wait only extension operations for restoration; never the desktop readiness path.
    const result = this.queue.then(async () => {
      if (!await this.readyForMutation()) return false;
      return operation();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private readyForMutation(): Promise<boolean> {
    if (this.signal.aborted) return Promise.resolve(false);
    // Scope draining precedes disposer execution. Cancel this wait so an IPC queued
    // behind slow restoration cannot deadlock the Feature scope's operation drain.
    return new Promise((resolve, reject) => {
      const cancelled = () => { this.signal.removeEventListener('abort', cancelled); resolve(false); };
      this.signal.addEventListener('abort', cancelled, { once: true });
      Promise.resolve(this.startup).then(() => {
        this.signal.removeEventListener('abort', cancelled); resolve(!this.signal.aborted);
      }, error => { this.signal.removeEventListener('abort', cancelled); reject(error); });
    });
  }

  private async load(extension: Extension, profileStartup = false): Promise<void> {
    const loaded = await this.options.session.extensions.loadExtension(extension.path);
    if (this.signal.aborted) { this.options.session.extensions.removeExtension(loaded.id); return; }
    if (loaded.manifest.background?.service_worker) {
      this.workerStartup.enqueue(loaded.id, profileStartup);
    }
  }

  private async unload(id: string): Promise<void> {
    await this.userScripts.idle();
    const extensions = this.options.session.extensions;
    if (!extensions.getExtension(id)) return;
    // The native unload event is asynchronous. Finish its cleanup before loading the same ID.
    await new Promise<void>((resolve) => {
      const unloaded = (_event: Electron.Event, extension: Extension) => {
        if (extension.id !== id) return;
        extensions.off('extension-unloaded', unloaded); resolve();
      };
      extensions.on('extension-unloaded', unloaded);
      extensions.removeExtension(id);
    });
  }

  private async beforeInstall(details: InstallDetails): Promise<{ action: 'allow' | 'deny' }> {
    const frame = details.frame;
    const contents = webContents.fromFrame(frame);
    const owner = contents && this.options.owner(contents);
    const url = frame.url;
    const current = () => !this.disposed && contents && !contents.isDestroyed()
      && contents.session === this.options.session && contents.mainFrame === frame && !frame.isDestroyed()
      && frame.origin === new URL(BROWSER_WEB_STORE_URL).origin && frame.url === url;
    if (!owner || !current() || !validExtensionId(details.id) || this.pending.has(details.id)) return { action: 'deny' };
    this.pending.add(details.id);
    try {
      const allowed = await confirmExtensionInstall(owner, details.localizedName || details.manifest.name,
        details.manifest as Record<string, unknown>, this.options.language());
      return { action: allowed && current() ? 'allow' : 'deny' };
    } finally { this.pending.delete(details.id); }
  }
}
