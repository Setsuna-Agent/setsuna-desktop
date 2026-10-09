import { app, BrowserWindow, type Extension, type Session, type WebContents } from 'electron';
import { EXTENSION_UI_CHANNELS as channels, type ExtensionUiEvent } from '../../contracts/extension-api.js';
import { BROWSER_IPC_CHANNELS } from '../../contracts/bridge.js';
import { ExtensionContexts } from './contexts.js';
import { BrowserExtensionSidePanels } from './side-panels.js';
import { panelTabId } from './side-panel-options.js';
import { extensionPageUrl } from './metadata.js';
import { extensionTabDetails, extensionTabForExtension } from './tabs.js';
import type { BrowserExtensionActiveTabs } from './active-tabs.js';
import { observeExtensionContents } from './contents-lifecycle.js';

type Options = {
  session: Session;
  resolve(url: string): Extension | null;
  owner(contents: WebContents): BrowserWindow | null;
  windows(): readonly BrowserWindow[];
  activeOwner(): BrowserWindow | null;
  activeTabs: BrowserExtensionActiveTabs;
  browserAction?(extension: Extension, method: string, args: unknown[]): Promise<unknown>;
};

/** Toolbar activation and sidePanel share extension-authenticated frame/worker endpoints. */
export class BrowserExtensionUi {
  readonly panels: BrowserExtensionSidePanels;
  private readonly contexts: ExtensionContexts<ExtensionUiEvent>;
  private readonly actionListeners = new Set<string>();
  private readonly guests = new Map<number, WebContents>();
  private readonly clicks = new Map<string, BrowserWindow>();
  private readonly disposers = new Map<number, () => void>();
  private lastFocused: BrowserWindow | null = null;

  constructor(private readonly options: Options) {
    this.contexts = new ExtensionContexts({ ...options, channels,
      // Install declared optional APIs before approval; each call still reads the current grants.
      bootstrap: (extension) => ({ sidePanel: [...(extension.manifest.permissions ?? []),
        ...(extension.manifest.optional_permissions ?? [])].includes('sidePanel'),
        browserAction: extension.manifest.manifest_version === 2 && Boolean(extension.manifest.browser_action) }),
      call: (extension, key, method, args) => this.call(extension, key, method, args),
      closed: (key) => this.actionListeners.delete(key) });
    this.panels = new BrowserExtensionSidePanels((owner) => {
      if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(BROWSER_IPC_CHANNELS.extensionPanelChanged);
    }, (id, event) => this.contexts.notify(id, event));
  }

  start(): void {
    this.contexts.start(); this.lastFocused = this.options.activeOwner();
    app.on('browser-window-focus', this.focused);
  }

  lastFocusedWindow(): BrowserWindow | null {
    const windows = this.options.windows().filter((window) => !window.isDestroyed());
    const active = this.options.activeOwner();
    // Popup focus leaves desktop windows unfocused. Keep the same owner history
    // for windows.getLastFocused(), background tab queries and browser control.
    return windows.find((window) => window.isFocused())
      ?? (this.lastFocused && windows.includes(this.lastFocused) ? this.lastFocused : null)
      ?? (active && windows.includes(active) ? active : windows[0] ?? null);
  }

  track(contents: WebContents): () => void {
    if (contents.isDestroyed() || this.guests.has(contents.id)) return () => undefined;
    this.guests.set(contents.id, contents);
    const dispose = () => {
      this.guests.delete(contents.id); this.disposers.delete(contents.id);
      unobserve(); this.panels.forgetTab(contents.id);
    };
    this.disposers.set(contents.id, dispose);
    const unobserve = observeExtensionContents(contents, { destroyed: dispose });
    return dispose;
  }

  async activate(extension: Extension, owner: BrowserWindow, tabId?: number): Promise<boolean> {
    const target = tabId === undefined ? null : this.guest(tabId);
    if (tabId !== undefined && (!target || this.options.owner(target) !== owner)) return false;
    this.grantActiveTab(extension, owner, tabId);
    this.clicks.set(extension.id, owner);
    const endpoints = await this.contexts.endpoints(extension.id);
    // A dormant worker must restore its setOptions/setPanelBehavior calls before activation.
    const current = this.options.resolve(`chrome-extension://${extension.id}/`);
    if (owner.isDestroyed() || !current) return false;
    if (this.panels.options.togglesOnAction(extension.id)) return this.panels.show(current, owner, tabId, true);
    const listeners = endpoints.filter(({ key }) => this.actionListeners.has(key));
    if (listeners.length) {
      const contents = tabId === undefined ? null : this.guest(tabId);
      const tab = contents ? { ...extensionTabDetails(contents, 'complete', undefined, owner.id), active: true, highlighted: true }
        : { id: -1, windowId: owner.id, index: 0, active: true, highlighted: true, pinned: false, incognito: false, status: 'complete' as const };
      const filtered = extensionTabForExtension(current, tab, Boolean(contents && this.options.activeTabs.has(current.id, contents)));
      for (const endpoint of listeners) endpoint.send({ kind: 'actionClicked', tab: filtered });
      return true;
    }
    return Boolean(extensionPageUrl(extension, 'sidepanel')) && this.panels.show(extension, owner, tabId, true);
  }

  grantActiveTab(extension: Extension, owner: BrowserWindow, tabId?: number): void {
    const contents = tabId === undefined ? null : this.guest(tabId);
    if (contents && this.options.owner(contents) === owner) this.options.activeTabs.grant(extension, contents);
  }

  remove(id: string): void { this.panels.remove(id); this.contexts.remove(id); this.clicks.delete(id); }
  dispose(): void {
    app.off('browser-window-focus', this.focused); this.panels.dispose(); this.contexts.dispose();
    for (const dispose of [...this.disposers.values()]) dispose();
    this.clicks.clear(); this.actionListeners.clear(); this.lastFocused = null;
  }

  private guest(id: number): WebContents | null {
    const contents = this.guests.get(id);
    return contents && !contents.isDestroyed() && this.options.owner(contents) ? contents : null;
  }

  private owner(extensionId: string, windowId?: unknown, tabId?: number): BrowserWindow {
    if (windowId !== undefined && (typeof windowId !== 'number' || !Number.isSafeInteger(windowId)
      || (windowId < 0 && windowId !== -2))) throw new Error('Invalid window ID.');
    const owner = tabId === undefined ? undefined : this.options.owner(this.guest(tabId)!);
    const windows = this.options.windows().filter((window) => !window.isDestroyed());
    const selected = owner ?? (typeof windowId === 'number' && windowId > 0 ? windows.find((window) => window.id === windowId)
      : this.clicks.get(extensionId) ?? this.options.activeOwner() ?? windows[0]);
    if (!selected || selected.isDestroyed() || !windows.includes(selected)
      || (windowId !== undefined && windowId > 0 && selected.id !== windowId)) throw new Error('Browser window unavailable.');
    return selected;
  }

  private async call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown> {
    if (method.startsWith('browserAction.') && this.options.browserAction) return this.options.browserAction(extension, method.slice(14), args);
    if (method === 'actionListen') {
      if (args[0] === true) this.actionListeners.add(key); else this.actionListeners.delete(key);
      return;
    }
    if (method.startsWith('windows.')) return this.windowCall(extension, key, method.slice(8), args);
    if (!extension.manifest.permissions?.includes('sidePanel')) throw new Error('sidePanel permission required.');
    if (method === 'panelListen') {
      // A worker may subscribe while its startup is still running. Return the current
      // state with the RPC reply rather than sending an event before its IPC is ready.
      return args[0] === 'panelOpened' && args[1] === true ? this.panels.openEvents(extension.id) : [];
    }
    const input = args[0] ?? {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid side panel options.');
    const value = input as Record<string, unknown>;
    const tabId = panelTabId(value.tabId, (id) => Boolean(this.guest(id)));
    if (method === 'getOptions') return this.panels.options.get(extension, tabId);
    if (method === 'setOptions') { this.panels.options.set(extension, value, (id) => Boolean(this.guest(id))); this.panels.refresh(extension); return; }
    if (method === 'getPanelBehavior') return { openPanelOnActionClick: this.panels.options.togglesOnAction(extension.id) };
    if (method === 'setPanelBehavior') { this.panels.options.setBehavior(extension.id, value); return; }
    if (method === 'getLayout') return { side: 'right' };
    if (method === 'open' || method === 'close') {
      if (tabId === undefined && value.windowId === undefined) throw new Error('A tabId or windowId is required.');
      const owner = this.owner(extension.id, value.windowId, tabId);
      if (method === 'close') { this.panels.close(owner, extension.id); return; }
      if (!this.panels.show(extension, owner, tabId)) throw new Error('Side panel unavailable.');
      return;
    }
    throw new Error(`Unsupported sidePanel method: ${method}.`);
  }

  private windowCall(extension: Extension, key: string, method: string, args: unknown[]): unknown {
    const describe = (window: BrowserWindow) => {
      const { x, y, width, height } = window.getBounds();
      return { id: window.id, focused: window.isFocused(), type: 'normal', incognito: false, left: x, top: y, width, height,
        state: window.isMinimized() ? 'minimized' : window.isMaximized() ? 'maximized' : 'normal' };
    };
    if (method === 'getAll') return this.options.windows().filter((window) => !window.isDestroyed()).map(describe);
    if (method === 'getLastFocused') {
      const selected = this.lastFocusedWindow();
      if (!selected) throw new Error('Browser window unavailable.');
      return describe(selected);
    }
    if (method === 'get' || method === 'getCurrent') {
      const contents = this.contexts.frameContents(key);
      const documentWindow = contents ? BrowserWindow.fromWebContents(contents) : null;
      const frameOwner = contents ? this.options.owner(contents) ?? documentWindow?.getParentWindow() : null;
      // Extension pages belong to their containing browser window; a click in another
      // desktop window must not change getCurrent() for an already-open panel.
      const current = method === 'getCurrent' || args[0] === -2;
      return describe(this.owner(extension.id, current ? (frameOwner ?? this.lastFocusedWindow())?.id : args[0]));
    }
    throw new Error(`Unsupported windows method: ${method}.`);
  }

  private readonly focused = (_event: Electron.Event, window: BrowserWindow) => {
    const windows = this.options.windows();
    const owner = windows.includes(window) ? window : window.getParentWindow();
    if (!owner || !windows.includes(owner) || owner.isDestroyed()) return;
    this.lastFocused = owner;
    for (const extension of this.options.session.extensions.getAllExtensions()) {
      this.contexts.notify(extension.id, { kind: 'windowFocusChanged', windowId: owner.id });
    }
  };
}
