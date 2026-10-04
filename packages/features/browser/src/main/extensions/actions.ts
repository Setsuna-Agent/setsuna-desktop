import { ipcMain, nativeImage, type Extension, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron';
import { BROWSER_EXTENSION_ACTION_CHANNEL, type BrowserExtensionAction } from '../../contracts/extensions.js';
import { extensionIcon, resolveExtensionPage } from './metadata.js';

/** Mirrors successful native chrome.action calls; framework detection stays in the extension. */
export class BrowserExtensionActions {
  private readonly states = new Map<string, Map<number | null, BrowserExtensionAction>>();
  private readonly tabs = new Map<number, { revision: number; dispose(): void }>();
  private readonly workers = new Map<number, () => void>();
  private readonly writes = new Map<string, number>();
  private sequence = 0;
  private preloadIds: string[] = [];

  constructor(private readonly session: Session, private readonly resolve: (url: string) => Extension | null,
    private readonly changed: (webContentsId: number | null) => void) {}

  start(preloadPath: string): void {
    this.preloadIds = (['frame', 'service-worker'] as const).map((type) => this.session.registerPreloadScript({ type, filePath: preloadPath }));
    ipcMain.handle(BROWSER_EXTENSION_ACTION_CHANNEL, this.frameUpdate);
    this.session.serviceWorkers.on('running-status-changed', this.workerChanged);
    for (const id of Object.keys(this.session.serviceWorkers.getAllRunning())) this.attachWorker(Number(id));
  }

  track(contents: WebContents): () => void {
    const id = contents.id;
    const reset = () => {
      const tab = this.tabs.get(id);
      if (tab) ++tab.revision;
      for (const state of this.states.values()) state.delete(id);
      this.changed(id);
    };
    const dispose = () => {
      if (!this.tabs.has(id)) return;
      reset(); this.tabs.delete(id);
      contents.off('did-navigate', reset).off('destroyed', dispose);
      for (const key of this.writes.keys()) if (key.split(':')[1] === String(id)) this.writes.delete(key);
    };
    this.tabs.set(id, { revision: 0, dispose });
    // A committed main-document navigation resets tab overrides; hash changes do not.
    contents.on('did-navigate', reset).once('destroyed', dispose);
    return dispose;
  }

  snapshot(webContentsId?: number): readonly BrowserExtensionAction[] {
    return [...this.states].map(([id, states]) => ({ id, ...states.get(null), ...states.get(webContentsId ?? null) }));
  }

  remove(id: string): void {
    this.states.delete(id);
    for (const key of this.writes.keys()) if (key.startsWith(`${id}:`)) this.writes.delete(key);
    this.changed(null);
  }

  dispose(): void {
    ipcMain.removeHandler(BROWSER_EXTENSION_ACTION_CHANNEL);
    this.session.serviceWorkers.off('running-status-changed', this.workerChanged);
    for (const dispose of this.workers.values()) dispose();
    for (const tab of [...this.tabs.values()]) tab.dispose();
    for (const id of this.preloadIds) this.session.unregisterPreloadScript(id);
    this.states.clear(); this.workers.clear(); this.writes.clear();
  }

  private readonly frameUpdate = (event: IpcMainInvokeEvent, input: unknown) => {
    if (event.sender.session !== this.session || !event.senderFrame) return false;
    const extension = this.resolve(event.senderFrame.url);
    return extension ? this.update(extension, input) : false;
  };

  private readonly workerChanged = (event: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => {
    if (event.runningStatus === 'starting' || event.runningStatus === 'running') this.attachWorker(event.versionId);
    else if (event.runningStatus === 'stopped') { this.workers.get(event.versionId)?.(); this.workers.delete(event.versionId); }
  };

  private attachWorker(id: number): void {
    if (this.workers.has(id)) return;
    const worker = this.session.serviceWorkers.getWorkerFromVersionID(id);
    if (!worker || !this.resolve(worker.scriptURL)) return;
    const ipc = worker.ipc;
    ipc.handle(BROWSER_EXTENSION_ACTION_CHANNEL, (_event, input) => {
      const extension = !worker.isDestroyed() && this.resolve(worker.scriptURL);
      return extension ? this.update(extension, input) : false;
    });
    this.workers.set(id, () => ipc.removeHandler(BROWSER_EXTENSION_ACTION_CHANNEL));
  }

  private async update(extension: Extension, input: unknown): Promise<boolean> {
    if (!input || typeof input !== 'object') return false;
    const value = input as Record<string, unknown>;
    if (!['setIcon', 'setPopup', 'setTitle'].includes(String(value.method))) return false;
    const tabId = value.tabId === undefined ? null : value.tabId;
    if (tabId !== null && (typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || !this.tabs.has(tabId))) return false;
    const tab = tabId === null ? undefined : this.tabs.get(tabId);
    const revision = tab?.revision;
    const key = `${extension.id}:${tabId}:${String(value.method)}`;
    const sequence = ++this.sequence;
    this.writes.set(key, sequence);
    let patch: Partial<BrowserExtensionAction>;
    if (value.method === 'setIcon') {
      const icon = typeof value.dataUrl === 'string' ? bitmapIcon(value.dataUrl) : await extensionIcon(extension, value.path);
      if (!icon) return false;
      patch = { icon };
    } else if (value.method === 'setPopup') {
      const popup = value.popup === '' ? '' : resolveExtensionPage(extension.id, value.popup);
      if (popup === null) return false;
      patch = { popup };
    } else if (value.method === 'setTitle' && typeof value.title === 'string' && value.title.length <= 4096) {
      patch = { title: value.title };
    } else return false;
    // Discard slower icon reads after a newer update, navigation, unload or teardown.
    if (this.writes.get(key) !== sequence || (tab && (this.tabs.get(tabId!) !== tab || tab.revision !== revision))) return false;
    const states = this.states.get(extension.id) ?? new Map<number | null, BrowserExtensionAction>();
    states.set(tabId, { id: extension.id, ...states.get(tabId), ...patch });
    this.states.set(extension.id, states);
    this.changed(tabId);
    return true;
  }
}

function bitmapIcon(value: string): string | null {
  if (!value.startsWith('data:image/png;base64,') || value.length > 512 * 1024) return null;
  const image = nativeImage.createFromDataURL(value);
  const size = image.getSize();
  return image.isEmpty() || size.width > 256 || size.height > 256 ? null : image.resize({ width: 32, height: 32 }).toDataURL();
}
