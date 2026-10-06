import { createRequire } from 'node:module';
import path from 'node:path';
import { app, webContents, type BrowserWindow, type Extension, type Session, type WebContents } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { BROWSER_WEB_STORE_URL, type BrowserExtension, type BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';
import { confirmExtensionInstall } from './confirmation.js';
import { extensionMetadata, newestNewTabExtension, validExtensionId } from './metadata.js';
import { BrowserExtensionPages } from './pages.js';
import { BrowserExtensionActions } from './actions.js';
import { readInstalledExtensions } from './installations.js';
import { BrowserExtensionState } from './state.js';

// Load the package's CJS entry intact so its packaged preload resolves beside it.
const webStore: typeof import('electron-chrome-web-store') = createRequire(import.meta.url)('electron-chrome-web-store');
type InstallOptions = NonNullable<Parameters<typeof webStore.installChromeWebStore>[0]>;
type InstallDetails = Parameters<NonNullable<InstallOptions['beforeInstall']>>[0];

export class BrowserExtensionService {
  private readonly directory: string;
  private readonly pages: BrowserExtensionPages;
  private readonly state: BrowserExtensionState;
  readonly actions: BrowserExtensionActions;
  private readonly pending = new Set<string>();
  private preloadIds: string[] = [];
  private disposed = false;
  private revision = 0;
  private extensions: readonly BrowserExtension[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: {
    session: Session;
    preloadPath: string;
    owner(contents: WebContents): BrowserWindow | null;
    language(): RuntimeInterfaceLanguage;
    publish(extensions: readonly BrowserExtension[]): void;
    actionsChanged(webContentsId: number | null): void;
    openWebPage(owner: BrowserWindow, url: string): void;
  }) {
    if (!options.session.storagePath) throw new Error('Browser extensions require persistent storage.');
    this.directory = path.join(options.session.storagePath, 'Extensions');
    this.state = new BrowserExtensionState(path.join(options.session.storagePath, 'extensions-state.json'));
    this.pages = new BrowserExtensionPages(options.session, options.openWebPage);
    this.actions = new BrowserExtensionActions(options.session, (url) => this.managedExtension(url), options.actionsChanged);
  }

  async start(): Promise<void> {
    const { session } = this.options;
    await this.state.load();
    this.actions.start(this.options.preloadPath);
    session.extensions.on('extension-loaded', this.changed);
    session.extensions.on('extension-unloaded', this.unloaded);
    const preloads = new Set(session.getPreloadScripts().map(({ id }) => id));
    await webStore.installChromeWebStore({
      session, extensionsPath: this.directory, minimumManifestVersion: 3,
      // Do not silently install a later manifest with newly requested permissions.
      autoUpdate: false, allowUnpackedExtensions: false, loadExtensions: false,
      beforeInstall: (details) => this.beforeInstall(details),
    });
    this.preloadIds = session.getPreloadScripts().map(({ id }) => id).filter((id) => !preloads.has(id));
    // Restore only enabled installations, so disabled workers never briefly run at startup.
    for (const extension of await readInstalledExtensions(this.directory)) {
      if (!this.state.isEnabled(extension.id)) continue;
      try { await this.load(extension); }
      catch (error) { console.error(`Failed to load browser extension ${extension.id}`, error); }
    }
    await this.refresh();
  }

  list(): readonly BrowserExtension[] { return this.extensions; }

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
          this.options.session.extensions.removeExtension(id);
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

  async open(id: string, view: 'popup' | 'options', owner: BrowserWindow, anchor?: BrowserExtensionPopupAnchor, webContentsId?: number): Promise<boolean> {
    if (this.disposed || !validExtensionId(id) || !this.extensions.some((extension) => extension.enabled && extension.id === id)) return false;
    const extension = this.options.session.extensions.getExtension(id);
    const popup = this.actions.snapshot(webContentsId).find((action) => action.id === id)?.popup;
    return extension ? this.pages.open(extension, view, owner, anchor, view === 'popup' ? popup : undefined) : false;
  }

  dispose(): void {
    this.disposed = true;
    ++this.revision;
    this.pages.close();
    this.actions.dispose();
    this.options.session.extensions.off('extension-loaded', this.changed);
    this.options.session.extensions.off('extension-unloaded', this.unloaded);
    for (const id of this.preloadIds) this.options.session.unregisterPreloadScript(id);
  }

  private readonly changed = (_event?: Electron.Event, extension?: Extension) => {
    if (extension && !this.state.isEnabled(extension.id)) {
      this.options.session.extensions.removeExtension(extension.id);
    } else void this.refresh().catch(() => undefined);
  };
  private readonly unloaded = (_event: Electron.Event, extension: Electron.Extension) => {
    this.actions.remove(extension.id); this.pages.close(extension.id); this.changed();
  };

  private managedExtension(rawUrl: string): Electron.Extension | null {
    if (this.disposed) return null;
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
        return extensionMetadata(native ?? extension, Boolean(native), app.getLocale());
      })), newestNewTabExtension(loaded),
    ]);
    if (this.disposed || revision !== this.revision) return;
    this.extensions = extensions.map((extension) => extension.id === newTabId ? extension : { ...extension, newTabUrl: null })
      .sort((left, right) => left.name.localeCompare(right.name));
    this.options.publish(this.extensions);
  }

  private mutate(operation: () => Promise<boolean>): Promise<boolean> {
    // Multiple windows can toggle or uninstall the same extension concurrently.
    const result = this.queue.then(() => this.disposed ? false : operation());
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(extension: Extension): Promise<void> {
    const loaded = await this.options.session.extensions.loadExtension(extension.path);
    if (loaded.manifest.background?.service_worker) {
      await this.options.session.serviceWorkers.startWorkerForScope(`chrome-extension://${loaded.id}`)
        .catch(() => console.error(`Failed to start worker for extension ${loaded.id}`));
    }
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
