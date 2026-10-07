import type { Extension, ServiceWorkerMain, Session } from 'electron';

/** A newly loaded extension may still be registering its background worker. */
export function startExtensionWorker(session: Session, id: string): Promise<ServiceWorkerMain> {
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
      session.extensions.off('extension-unloaded', unloaded);
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
    const unloaded = (_event: Electron.Event, extension: Extension) => {
      if (extension.id === id) finish(new Error('Extension unloaded while starting its worker.'));
    };
    const timeout = setTimeout(() => finish(failure), 10_000);
    timeout.unref();
    // Subscribe before attempting startup: Electron can reject before registration
    // finishes, and silently continuing would lose the extension's first event.
    workers.on('registration-completed', registered);
    session.extensions.on('extension-unloaded', unloaded);
    start();
  });
}
