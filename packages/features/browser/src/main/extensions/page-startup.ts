import { app, webContents, type Session, type WebContents } from 'electron';
import { observeExtensionContents } from './contents-lifecycle.js';

type PendingStartup = { timeout: NodeJS.Timeout };

/** MV2 pages load natively; observe readiness without adding a restoration wait. */
export class BrowserExtensionPageStartup {
  private readonly pending = new Map<string, PendingStartup>();
  private readonly observed = new Map<number, { extensionId: string; dispose(): void }>();

  constructor(private readonly options: {
    session: Session; signal: AbortSignal; profileStarted(id: string): void;
  }) {
    options.signal.addEventListener('abort', () => {
      for (const id of this.pending.keys()) this.remove(id);
    }, { once: true });
  }

  enqueue(id: string): void {
    if (this.options.signal.aborted || this.pending.has(id)) return;
    if (!this.pending.size) app.on('web-contents-created', this.created);
    const timeout = setTimeout(() => this.failed(id, 'Timed out waiting for the background page.'), 10_000);
    timeout.unref();
    this.pending.set(id, { timeout });
    // loadExtension may resolve before or after the background document completes.
    for (const contents of webContents.getAllWebContents()) this.observe(contents);
  }

  remove(id: string): void {
    const task = this.pending.get(id);
    if (!task) return;
    clearTimeout(task.timeout);
    this.pending.delete(id);
    if (!this.pending.size) app.off('web-contents-created', this.created);
    for (const observer of [...this.observed.values()]) {
      if (!this.pending.size || observer.extensionId === id) observer.dispose();
    }
  }

  private readonly created = (_event: Electron.Event, contents: WebContents) => this.observe(contents);

  private observe(contents: WebContents): void {
    if (contents.isDestroyed() || contents.session !== this.options.session || contents.getType() !== 'backgroundPage') return;
    if (!this.observed.has(contents.id)) {
      const ready = () => this.ready(contents);
      const failed = (_event: Electron.Event, _code: number, description: string, url: string, isMainFrame: boolean) => {
        if (isMainFrame) this.failed(extensionId(url), description);
      };
      const dispose = () => {
        this.observed.delete(contents.id);
        contents.off('did-finish-load', ready).off('did-fail-load', failed);
        unobserve();
      };
      const observer = { extensionId: extensionId(contents.getURL()), dispose };
      const unobserve = observeExtensionContents(contents, {
        changed: () => { observer.extensionId = extensionId(contents.getURL()); },
        destroyed: () => { this.remove(observer.extensionId); dispose(); },
      });
      this.observed.set(contents.id, observer);
      contents.on('did-finish-load', ready).on('did-fail-load', failed);
    }
    const id = extensionId(contents.getURL());
    const task = this.pending.get(id);
    if (!task || contents.isLoadingMainFrame()) return;
    // Native loading may already have finished. Probe in the document so a new
    // page whose navigation has not started cannot be mistaken for a ready page.
    void contents.executeJavaScript('document.readyState === "complete"').then(complete => {
      if (complete && this.pending.get(id) === task && !contents.isDestroyed() && extensionId(contents.getURL()) === id) this.ready(contents);
    }).catch(() => undefined);
  }

  private ready(contents: WebContents): void {
    if (this.options.signal.aborted || contents.isDestroyed()) return;
    const id = extensionId(contents.getURL());
    if (!this.pending.has(id) || !this.options.session.extensions.getExtension(id)) return;
    this.remove(id);
    this.options.profileStarted(id);
  }

  private failed(id: string, description: string): void {
    if (!this.pending.has(id)) return;
    this.remove(id);
    console.error(`Failed to start background page for extension ${id}`, new Error(description));
  }
}

function extensionId(url: string): string {
  try { const parsed = new URL(url); return parsed.protocol === 'chrome-extension:' ? parsed.hostname : ''; }
  catch { return ''; }
}
