import type { Extension, ServiceWorkerMain, Session } from 'electron';

const maxConcurrentStarts = 4;
type WorkerStartup = { id: string; profileStartup: boolean; running: boolean };

/** Bound background restoration without making desktop readiness wait for workers. */
export class BrowserExtensionWorkerStartup {
  private readonly tasks = new Map<string, WorkerStartup>();
  private active = 0;

  constructor(private readonly options: {
    session: Session; signal: AbortSignal; profileStarted(id: string): void;
  }) {
    if (!options.signal.aborted) options.signal.addEventListener('abort', () => this.tasks.clear(), { once: true });
  }

  enqueue(id: string, profileStartup: boolean): void {
    if (this.options.signal.aborted || this.tasks.has(id)) return;
    this.tasks.set(id, { id, profileStartup, running: false });
    this.startPending();
  }

  remove(id: string): void { this.tasks.delete(id); }

  private current(task: WorkerStartup): boolean {
    return !this.options.signal.aborted && this.tasks.get(task.id) === task;
  }

  private startPending(): void {
    if (this.options.signal.aborted) return;
    for (const task of this.tasks.values()) {
      if (this.active >= maxConcurrentStarts) return;
      if (task.running) continue;
      if (!this.options.session.extensions.getExtension(task.id)) { this.tasks.delete(task.id); continue; }
      task.running = true;
      ++this.active;
      // Queued workers acquire registration listeners and their timeout only when a slot opens.
      void startExtensionWorker(this.options.session, task.id, this.options.signal).then(() => {
        if (this.current(task) && task.profileStartup) this.options.profileStarted(task.id);
      }).catch((error: unknown) => {
        if (this.current(task) && this.options.session.extensions.getExtension(task.id)) {
          console.error(`Failed to start worker for extension ${task.id}`, error);
        }
      }).finally(() => {
        if (this.tasks.get(task.id) === task) this.tasks.delete(task.id);
        --this.active;
        this.startPending();
      });
    }
  }
}

/** A newly loaded extension may still be registering its background worker. */
export function startExtensionWorker(session: Session, id: string, signal?: AbortSignal): Promise<ServiceWorkerMain> {
  if (signal?.aborted) return Promise.reject(new Error('Extension worker startup cancelled.'));
  const scope = `chrome-extension://${id}/`;
  return new Promise((resolve, reject) => {
    const workers = session.serviceWorkers;
    let finished = false;
    let failure = new Error(`Timed out starting extension worker ${id}.`);
    const finish = (error: Error | null, worker?: ServiceWorkerMain) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      workers.off('registration-completed', registered);
      workers.off('console-message', scriptError);
      session.extensions.off('extension-unloaded', unloaded);
      signal?.removeEventListener('abort', cancelled);
      if (error) reject(error); else resolve(worker!);
    };
    const start = () => {
      if (finished) return;
      void workers.startWorkerForScope(scope).then((worker) => finish(null, worker), (error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
    };
    const registered = (_event: Electron.Event, details: Electron.RegistrationCompletedDetails) => {
      if (details.scope === scope) start();
    };
    const scriptError = (_event: Electron.Event, details: Electron.MessageDetails) => {
      // An uncaught JavaScript error during startup is conclusive; console.error and
      // network logs are not. Match the extension origin so unrelated workers stay isolated.
      if (details.source !== 'javascript' || details.level !== 3) return;
      try {
        const url = new URL(details.sourceUrl);
        if (url.protocol === 'chrome-extension:' && url.hostname === id) finish(new Error(details.message));
      } catch { /* A diagnostic without a valid origin cannot identify this worker. */ }
    };
    const unloaded = (_event: Electron.Event, extension: Extension) => {
      if (extension.id === id) finish(new Error('Extension unloaded while starting its worker.'));
    };
    const cancelled = () => finish(new Error('Extension worker startup cancelled.'));
    const timeout = setTimeout(() => finish(failure), 10_000);
    timeout.unref();
    // Electron reports the same native error for registration races and startup failures.
    // Keep registration retries bounded; only an identified script error is conclusive.
    workers.on('registration-completed', registered);
    workers.on('console-message', scriptError);
    session.extensions.on('extension-unloaded', unloaded);
    signal?.addEventListener('abort', cancelled, { once: true });
    start();
  });
}
