import { randomUUID } from 'node:crypto';
import { protocol, type Extension, type Session, type WebContents } from 'electron';
import { loadBrowserFavicon } from '../favicon.js';
import { observeExtensionContents } from './contents-lifecycle.js';

const scheme = 'setsuna-extension-favicon';
const maxConcurrentRequests = 16;
type Context = { extension: Extension; key: string };
type WaitingRequest = { token: string; context: Context; signal: AbortSignal; finish(acquired: boolean): void };

export function registerExtensionFaviconScheme(): void {
  // Mapped _favicon resources must work with an extension's self-only image CSP.
  // This scheme serves only validated images through authenticated extension contexts.
  protocol.registerSchemesAsPrivileged([{ scheme, privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, allowServiceWorkers: true,
  } }]);
}

/** Electron's native _favicon loader has no backend; getURL maps that resource to this reader. */
export class BrowserExtensionFavicons {
  private readonly contexts = new Map<string, Context>();
  private readonly keys = new Map<string, string>();
  private readonly guests = new Map<number, { contents: WebContents; candidates: string[]; dispose(): void }>();
  private readonly waiting = new Set<WaitingRequest>();
  private active = 0;
  private started = false;
  private disposed = false;

  constructor(private readonly options: { session: Session; resolve(url: string): Extension | null }) {}

  start(): void {
    // Register before loading extensions: renderer URL-loader factories capture the schemes.
    this.options.session.protocol.handle(scheme, request => this.respond(request));
    this.started = true;
  }

  resourceUrl(extension: Extension, key: string): string {
    this.release(key);
    const token = randomUUID(); this.contexts.set(token, { extension, key }); this.keys.set(key, token);
    return `${scheme}://${extension.id}/${token}/`;
  }

  release(key: string): void {
    const token = this.keys.get(key);
    if (token) {
      this.contexts.delete(token);
      for (const request of this.waiting) if (request.token === token) request.finish(false);
    }
    this.keys.delete(key);
  }

  track(contents: WebContents): () => void {
    if (contents.isDestroyed() || this.guests.has(contents.id)) return () => undefined;
    const entry = { contents, candidates: [] as string[], dispose: () => {
      this.guests.delete(contents.id); contents.off('page-favicon-updated', changed).off('did-start-navigation', navigating); unobserve();
    } };
    const changed = (_event: Electron.Event, candidates: string[]) => {
      entry.candidates = candidates.filter(value => value.length <= 8192).slice(0, 8);
    };
    const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (event.isMainFrame && !event.isSameDocument) entry.candidates = [];
    };
    const unobserve = observeExtensionContents(contents, { destroyed: entry.dispose });
    this.guests.set(contents.id, entry);
    contents.on('page-favicon-updated', changed).on('did-start-navigation', navigating);
    return entry.dispose;
  }

  dispose(): void {
    this.disposed = true;
    if (this.started) {
      this.options.session.protocol.unhandle(scheme);
      this.started = false;
    }
    this.contexts.clear(); this.keys.clear();
    for (const request of this.waiting) request.finish(false);
    for (const entry of [...this.guests.values()]) entry.dispose();
  }

  private current(token: string, context: Context): boolean {
    const extension = !this.disposed && this.options.resolve(`chrome-extension://${context.extension.id}/`);
    return Boolean(extension && this.contexts.get(token) === context
      && extension.path === context.extension.path && extension.version === context.extension.version
      && extension.manifest.permissions?.includes('favicon'));
  }

  private acquire(token: string, context: Context, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !this.current(token, context)) return Promise.resolve(false);
    if (this.active < maxConcurrentRequests) { this.active++; return Promise.resolve(true); }
    return new Promise(resolve => {
      const cancelled = () => request.finish(false);
      const request: WaitingRequest = { token, context, signal, finish: acquired => {
        this.waiting.delete(request); signal.removeEventListener('abort', cancelled); resolve(acquired);
      } };
      this.waiting.add(request);
      signal.addEventListener('abort', cancelled, { once: true });
    });
  }

  private releaseSlot(): void {
    this.active--;
    for (const request of this.waiting) {
      if (this.active >= maxConcurrentRequests) break;
      if (request.signal.aborted || !this.current(request.token, request.context)) { request.finish(false); continue; }
      // Reserve each freed slot before waking its oldest waiter so new arrivals
      // cannot bypass the queue or push the active count beyond the limit.
      this.active++; request.finish(true);
    }
  }

  private async respond(request: Request): Promise<Response> {
    const url = new URL(request.url); const token = url.pathname.slice(1, -1);
    const context = this.contexts.get(token);
    const destination = request.headers.get('sec-fetch-dest');
    if (request.method !== 'GET' || destination && !['image', 'empty'].includes(destination)
      || !context || url.hostname !== context.extension.id || url.username || url.password || url.port
      || !this.current(token, context)) return new Response(null, { status: 403 });
    let pageUrl: URL;
    const size = Number(url.searchParams.get('size') ?? 16);
    try { pageUrl = new URL(url.searchParams.get('pageUrl') ?? ''); } catch { return new Response(null, { status: 400 }); }
    if (!['http:', 'https:'].includes(pageUrl.protocol) || pageUrl.username || pageUrl.password
      || pageUrl.href.length > 8192 || !Number.isInteger(size) || size < 1 || size > 256) return new Response(null, { status: 400 });
    if (!await this.acquire(token, context, request.signal)) return new Response(null, { status: 403 });
    try {
      // Contexts, installations and permissions may change while an image waits for a slot.
      if (request.signal.aborted || !this.current(token, context)) return new Response(null, { status: 403 });
      const candidates = [...this.guests.values()].find(entry => !entry.contents.isDestroyed()
        && entry.contents.getURL() === pageUrl.href)?.candidates ?? [];
      const data = await loadBrowserFavicon(this.options.session, pageUrl.href, candidates);
      if (request.signal.aborted || !this.current(token, context)) return new Response(null, { status: 403 });
      const fallback = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><g fill="none" stroke="#888"><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="3" ry="6"/><path d="M2 8h12"/></g></svg>`;
      let bytes: Buffer = Buffer.from(fallback); let mime = 'image/svg+xml';
      if (data) {
        mime = data.slice(5, data.indexOf(';')); bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
        // Decode website-controlled images in the guest, keeping image parsing off the main thread.
      }
      return new Response(new Uint8Array(bytes), { headers: {
        'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src 'none'; sandbox",
      } });
    } finally { this.releaseSlot(); }
  }
}
