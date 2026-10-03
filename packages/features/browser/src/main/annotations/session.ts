import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import type { DesktopBrowserScreenshot } from '../../contracts/browser-control.js';
import { parseAnnotationAnchor, parseAnnotationTarget, BROWSER_ANNOTATION_LIMIT, type BrowserAnnotationAnchor, type BrowserAnnotationMarkers, type BrowserAnnotationTarget } from '../../contracts/annotations.js';
import { readAnnotationElement } from './element-context.js';
import { annotationPageOverlay, type AnnotationPageAction } from './page-overlay.js';

const annotationWorldId = 1_004;

export class BrowserAnnotationSession {
  private revision = 0;
  private installed = false;
  private cancelPending: (() => void) | null = null;
  private markerIds = new Set<string>();

  constructor(private readonly contents: WebContents) {}

  async pick(signal?: AbortSignal): Promise<BrowserAnnotationTarget | null> {
    if (signal?.aborted) return null;
    this.cancelPending?.();
    const revision = ++this.revision;
    const id = randomUUID();
    this.installed = true;
    this.contents.focus();
    const cancelled = new Promise<null>((resolve) => { this.cancelPending = () => resolve(null); });
    const onAbort = () => {
      // Scope draining waits for this request before disposing the controller. Release it locally
      // even if the guest cannot finish the overlay cleanup; never cancel a newer selection.
      if (revision === this.revision) void this.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) { onAbort(); return null; }
      const value = await Promise.race([this.run({ kind: 'pick', id }), cancelled]);
      if (revision !== this.revision || this.contents.isDestroyed() || value === null) return null;
      const target = parseAnnotationTarget(value);
      // A pick may return a saved marker, but never an identity unknown to this session.
      if (!target || (target.id !== id && !this.markerIds.has(target.id))) throw new Error('Invalid browser annotation selection.');
      this.contents.hostWebContents?.focus();
      // URL/title are bound to the registered guest, never accepted as navigation instructions.
      return { ...target, url: this.contents.getURL(), title: this.contents.getTitle().slice(0, 300) };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (revision === this.revision) this.cancelPending = null;
    }
  }

  async sync(input: BrowserAnnotationMarkers, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;
    if (!this.installed) return true;
    this.markerIds = new Set(input.ids);
    const value = await waitForAnnotationResult(this.run({ kind: 'sync', ...input }), signal);
    return !signal?.aborted && value === true;
  }

  async anchor(id: string, signal?: AbortSignal): Promise<BrowserAnnotationAnchor | null> {
    if (signal?.aborted || !this.installed || !/^[a-f0-9-]{36}$/i.test(id)) return null;
    const revision = this.revision;
    const value = await waitForAnnotationResult(this.run({ kind: 'anchor', id }), signal);
    return !signal?.aborted && revision === this.revision ? parseAnnotationAnchor(value) : null;
  }

  async captureScreenshots(ids: readonly string[], capture: () => Promise<DesktopBrowserScreenshot>, signal?: AbortSignal): Promise<DesktopBrowserScreenshot[] | null> {
    if (signal?.aborted || !this.installed || !ids.length) return null;
    await this.cancel();
    if (signal?.aborted || !this.installed) return null;
    const revision = this.revision;
    const screenshots: DesktopBrowserScreenshot[] = [];
    const current = () => revision === this.revision && !this.contents.isDestroyed();
    try {
      // Capture sequentially: each frame temporarily contains only its own numbered marker.
      for (const id of ids) {
        const ready = await waitForAnnotationResult(this.run({ kind: 'prepare-screenshot', id }), signal);
        if (ready !== true || signal?.aborted || !current()) return null;
        const screenshot = await waitForAnnotationResult(capture(), signal);
        // Discard the whole batch on navigation; never attach a different page or a partial batch.
        if (!screenshot || signal?.aborted || !current()) return null;
        screenshots.push(screenshot);
      }
    } finally {
      // Always request restoration, but scope draining must not wait for the guest to run it.
      if (current()) await waitForAnnotationResult(this.run({ kind: 'finish-screenshot' }), signal);
    }
    return !signal?.aborted && current() ? screenshots : null;
  }

  async cancel(): Promise<void> {
    ++this.revision;
    this.cancelPending?.();
    this.cancelPending = null;
    // Releasing local requests must never wait for an unresponsive guest's main thread.
    if (this.installed && !this.contents.isDestroyed()) void this.run({ kind: 'cancel' }).catch(() => undefined);
  }

  dispose(): void {
    ++this.revision;
    this.cancelPending?.();
    this.cancelPending = null;
    if (this.installed && !this.contents.isDestroyed()) void this.run({ kind: 'dispose' }).catch(() => undefined);
    this.installed = false;
    this.markerIds.clear();
  }

  private run(action: AnnotationPageAction): Promise<unknown> {
    // Only these bundled functions execute, in a separate JS world with no native bridge.
    // Neither renderer nor runtime can supply script source or a world ID.
    const payload = JSON.stringify(action);
    const code = action.kind === 'pick'
      ? `(${annotationPageOverlay.toString()})(${payload}, ${readAnnotationElement.toString()})`
      : `window.__setsunaAnnotations?.run(${payload}) ?? ${action.kind === 'anchor' ? 'null' : 'true'}`;
    return this.contents.executeJavaScriptInIsolatedWorld(annotationWorldId, [{ code }]);
  }
}

async function waitForAnnotationResult<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return pending;
  let onAbort!: () => void;
  const cancelled = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    // Racing observes late guest failures too, without keeping the Feature operation alive.
    return await Promise.race([cancelled, pending]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function parseAnnotationMarkers(value: unknown): BrowserAnnotationMarkers | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<BrowserAnnotationMarkers>;
  if (typeof input.visible !== 'boolean' || !Array.isArray(input.ids) || input.ids.length > BROWSER_ANNOTATION_LIMIT
    || input.ids.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) return null;
  const activeId = input.activeId ?? null;
  if (activeId !== null && (typeof activeId !== 'string' || !input.ids.includes(activeId))) return null;
  return { visible: input.visible, ids: [...new Set(input.ids)], activeId };
}
