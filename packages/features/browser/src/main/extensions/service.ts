import { createRequire } from 'node:module';
import path from 'node:path';
import { webContents, type BrowserWindow, type Session, type WebContents } from 'electron';
import type { RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import { BROWSER_WEB_STORE_URL, type BrowserExtension, type BrowserExtensionPopupAnchor } from '../../contracts/extensions.js';
import { confirmExtensionInstall } from './confirmation.js';
import { extensionMetadata, newestNewTabExtension, validExtensionId } from './metadata.js';
import { BrowserExtensionPages } from './pages.js';
import { BrowserExtensionActions } from './actions.js';

// Load the package's CJS entry intact so its packaged preload resolves beside it.
const webStore: typeof import('electron-chrome-web-store') = createRequire(import.meta.url)('electron-chrome-web-store');
type InstallOptions = NonNullable<Parameters<typeof webStore.installChromeWebStore>[0]>;
type InstallDetails = Parameters<NonNullable<InstallOptions['beforeInstall']>>[0];

export class BrowserExtensionService {
  private readonly directory: string;
  private readonly pages: BrowserExtensionPages;
  readonly actions: BrowserExtensionActions;
  private readonly pending = new Set<string>();
  private preloadIds: string[] = [];
  private disposed = false;
  private revision = 0;
  private extensions: readonly BrowserExtension[] = [];

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
    this.pages = new BrowserExtensionPages(options.session, options.openWebPage);
    this.actions = new BrowserExtensionActions(options.session, (url) => this.managedExtension(url), options.actionsChanged);
  }

  async start(): Promise<void> {
    const { session } = this.options;
    this.actions.start(this.options.preloadPath);
    session.extensions.on('extension-loaded', this.changed);
    session.extensions.on('extension-unloaded', this.unloaded);
    const preloads = new Set(session.getPreloadScripts().map(({ id }) => id));
    await webStore.installChromeWebStore({
      session, extensionsPath: this.directory, minimumManifestVersion: 3,
      // Do not silently install a later manifest with newly requested permissions.
      autoUpdate: false, allowUnpackedExtensions: false,
      beforeInstall: (details) => this.beforeInstall(details),
    });
    this.preloadIds = session.getPreloadScripts().map(({ id }) => id).filter((id) => !preloads.has(id));
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
        && this.extensions.some(({ id }) => id === url.hostname)
        && Boolean(this.options.session.extensions.getExtension(url.hostname));
    } catch { return false; }
  }

  async remove(id: string): Promise<boolean> {
    if (this.disposed || !validExtensionId(id) || !this.extensions.some((extension) => extension.id === id)) return false;
    this.pages.close(id);
    await webStore.uninstallExtension(id, { session: this.options.session, extensionsPath: this.directory });
    await this.refresh();
    return true;
  }

  async open(id: string, view: 'popup' | 'options', owner: BrowserWindow, anchor?: BrowserExtensionPopupAnchor, webContentsId?: number): Promise<boolean> {
    if (this.disposed || !validExtensionId(id) || !this.extensions.some((extension) => extension.id === id)) return false;
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

  private readonly changed = () => { void this.refresh().catch(() => undefined); };
  private readonly unloaded = (_event: Electron.Event, extension: Electron.Extension) => {
    this.actions.remove(extension.id); this.pages.close(extension.id); this.changed();
  };

  private managedExtension(rawUrl: string): Electron.Extension | null {
    if (this.disposed) return null;
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'chrome-extension:' || !validExtensionId(url.hostname)) return null;
      const extension = this.options.session.extensions.getExtension(url.hostname);
      if (!extension) return null;
      const relative = path.relative(this.directory, extension.path);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? extension : null;
    } catch { return null; }
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.revision;
    const installed = this.options.session.extensions.getAllExtensions().filter((extension) => {
      const relative = path.relative(this.directory, extension.path);
      return validExtensionId(extension.id) && relative && relative !== '..'
        && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    const [extensions, newTabId] = await Promise.all([
      Promise.all(installed.map(extensionMetadata)), newestNewTabExtension(installed),
    ]);
    if (this.disposed || revision !== this.revision) return;
    this.extensions = extensions.map((extension) => extension.id === newTabId ? extension : { ...extension, newTabUrl: null })
      .sort((left, right) => left.name.localeCompare(right.name));
    this.options.publish(this.extensions);
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
