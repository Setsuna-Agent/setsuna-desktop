import { ipcMain, type Extension, type IpcMainEvent, type IpcMainInvokeEvent, type IpcMainServiceWorkerEvent, type IpcMainServiceWorkerInvokeEvent, type Session, type WebContents } from 'electron';
import type { ExtensionApiResult } from '../../contracts/extension-api.js';
import { startExtensionWorker } from './worker-startup.js';
import { observeExtensionContents } from './contents-lifecycle.js';

export interface ExtensionEndpoint<T> { key: string; send(event: T): void; hold(): () => void }

type ContextEvent = IpcMainEvent | IpcMainInvokeEvent | IpcMainServiceWorkerEvent | IpcMainServiceWorkerInvokeEvent;
type Context<T> = ExtensionEndpoint<T> & { extensionId: string; contents?: WebContents; alive(): boolean; dispose(): void };
type Options = {
  channels: { bootstrap: string; call: string; event: string };
  bootstrap(extension: Extension, key: string): unknown | null;
  session: Session; resolve(url: string): Extension | null;
  call(extension: Extension, key: string, method: string, args: unknown[]): Promise<unknown>;
  closed?(key: string): void;
};
const workerDispatchEvents = ['-ipc-invoke', '-ipc-message', '-ipc-message-sync'];

/** Extension identity comes from Electron's frame/worker, never from an IPC payload. */
export class ExtensionContexts<T> {
  private get channels() { return this.options.channels; }
  private readonly contexts = new Map<string, Context<T>>();
  private readonly workers = new Map<number, () => void>();
  constructor(private readonly options: Options) {}

  start(): void {
    ipcMain.on(this.channels.bootstrap, this.bootstrap);
    ipcMain.handle(this.channels.call, this.call);
    // A worker's preload can send its first request before the running-status event. Acquire
    // the wrapper before Electron dispatches that request, or sendSync would have no listener.
    for (const name of workerDispatchEvents) this.options.session.prependListener(name, this.acquire);
    this.options.session.serviceWorkers.on('running-status-changed', this.workerChanged);
  }

  async endpoints(id: string): Promise<ExtensionEndpoint<T>[]> {
    const extension = this.options.session.extensions.getExtension(id);
    if (extension?.manifest.background?.service_worker) {
      await startExtensionWorker(this.options.session, id).catch(() => undefined);
    }
    const result: ExtensionEndpoint<T>[] = [];
    for (const context of this.contexts.values()) {
      if (!context.alive()) { this.forget(context.key); continue; }
      if (context.extensionId === id) result.push(context);
    }
    return result;
  }

  notify(id: string, value: T): void {
    for (const context of this.contexts.values()) if (context.extensionId === id && context.alive()) context.send(value);
  }

  frameContents(key: string): WebContents | null {
    const context = this.contexts.get(key);
    return context?.alive() && context.contents && !context.contents.isDestroyed() ? context.contents : null;
  }

  endpoint(key: string): ExtensionEndpoint<T> | null {
    const context = this.contexts.get(key);
    return context?.alive() ? context : null;
  }

  remove(id: string): void {
    for (const context of this.contexts.values()) if (context.extensionId === id) this.forget(context.key);
  }

  dispose(): void {
    ipcMain.off(this.channels.bootstrap, this.bootstrap); ipcMain.removeHandler(this.channels.call);
    for (const name of workerDispatchEvents) (this.options.session as unknown as NodeJS.EventEmitter).removeListener(name, this.acquire);
    this.options.session.serviceWorkers.off('running-status-changed', this.workerChanged);
    for (const dispose of this.workers.values()) dispose();
    for (const key of this.contexts.keys()) this.forget(key);
    this.workers.clear();
  }

  private context(event: ContextEvent): { extension: Extension; key: string } | null {
    if (event.type === 'service-worker') {
      if (event.session !== this.options.session || event.serviceWorker.isDestroyed()) return null;
      const extension = this.options.resolve(event.serviceWorker.scriptURL);
      return extension ? { extension, key: `worker:${event.versionId}` } : null;
    }
    if (event.sender.isDestroyed() || event.sender.session !== this.options.session || !event.senderFrame || event.senderFrame.isDestroyed()) return null;
    const frame = event.senderFrame;
    const extension = this.options.resolve(frame.url);
    return extension ? { extension, key: `frame:${frame.processId}:${frame.routingId}` } : null;
  }

  private readonly bootstrap = (event: IpcMainEvent | IpcMainServiceWorkerEvent) => {
    const resolved = this.context(event);
    if (resolved) this.forget(resolved.key);
    const result = resolved ? this.options.bootstrap(resolved.extension, resolved.key) : null;
    if (resolved && result !== null) {
      const { extension, key } = resolved;
      const frame = event.type === 'frame' ? event.senderFrame : null;
      const worker = event.type === 'service-worker' ? event.serviceWorker : null;
      const contents = event.type === 'frame' ? event.sender : null;
      const alive = () => Boolean(worker ? !worker.isDestroyed() && this.options.resolve(worker.scriptURL)?.id === extension.id
        : frame && !frame.isDestroyed() && this.options.resolve(frame.url)?.id === extension.id);
      const changed = () => { if (!alive()) this.forget(key); };
      const destroyed = () => this.forget(key);
      const unobserve = contents ? observeExtensionContents(contents, { changed, destroyed }) : () => undefined;
      this.contexts.set(key, {
        key, extensionId: extension.id,
        ...(contents ? { contents } : {}), alive,
        dispose: unobserve,
        send: (value: T) => { try { (worker ?? frame)?.send(this.channels.event, value); } catch { this.forget(key); } },
        hold: () => {
          if (!worker || worker.isDestroyed()) return () => undefined;
          const task = worker.startTask();
          return () => { if (!worker.isDestroyed()) task.end(); };
        },
      });
    }
    event.returnValue = result;
  };

  private readonly call = async (event: IpcMainInvokeEvent | IpcMainServiceWorkerInvokeEvent, method: unknown, args: unknown): Promise<ExtensionApiResult> => {
    const resolved = this.context(event);
    if (!resolved || typeof method !== 'string' || !Array.isArray(args)) return { ok: false, error: 'Extension context unavailable.' };
    try { return { ok: true, result: await this.options.call(resolved.extension, resolved.key, method, args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  };

  private readonly acquire = (event: unknown) => {
    if (!event || typeof event !== 'object') return;
    const { type, versionId } = event as { type?: unknown; versionId?: unknown };
    if (type === 'service-worker' && typeof versionId === 'number') this.attachWorker(versionId);
  };

  private readonly workerChanged = (event: Electron.Event<Electron.ServiceWorkersRunningStatusChangedEventParams>) => {
    if (event.runningStatus === 'starting' || event.runningStatus === 'running') this.attachWorker(event.versionId);
    else if (event.runningStatus === 'stopped') {
      this.workers.get(event.versionId)?.(); this.workers.delete(event.versionId); this.forget(`worker:${event.versionId}`);
    }
  };

  private attachWorker(id: number): void {
    if (this.workers.has(id)) return;
    const worker = this.options.session.serviceWorkers.getWorkerFromVersionID(id);
    if (!worker || !this.options.resolve(worker.scriptURL)) return;
    worker.ipc.on(this.channels.bootstrap, this.bootstrap); worker.ipc.handle(this.channels.call, this.call);
    this.workers.set(id, () => { worker.ipc.removeListener(this.channels.bootstrap, this.bootstrap); worker.ipc.removeHandler(this.channels.call); });
  }

  private forget(key: string): void {
    const context = this.contexts.get(key);
    if (!context) return;
    this.contexts.delete(key); context.dispose(); this.options.closed?.(key);
  }
}
