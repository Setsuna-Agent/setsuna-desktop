import { PLUGIN_UI_DOCUMENT_SCHEME, type PluginUiDocument, type PluginUiDocumentInput, type RuntimeInterfaceLanguage } from '@setsuna-desktop/contracts';
import type { BrowserWindow, CustomScheme, Session, WebContents, WebFrameMain } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { PluginUiPermissions, withoutHash } from './plugin-ui-permissions.js';
import { desktopWindows } from './registry.js';

export const pluginUiDocumentScheme: CustomScheme = {
  scheme: PLUGIN_UI_DOCUMENT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true, stream: true },
};

type DocumentEntry = PluginUiDocument & { html: string; owner: BrowserWindow; ownerId: number };

/** Separate web origins keep ordinary browser APIs available without exposing the desktop renderer. */
export class PluginUiDocuments {
  private readonly documents = new Map<string, DocumentEntry>();
  private readonly owners = new Map<number, { owner: BrowserWindow; dispose(): void }>();
  private readonly sessions = new Set<Session>();
  private readonly permissions: PluginUiPermissions;

  constructor(language: () => RuntimeInterfaceLanguage = () => 'en-US') {
    this.permissions = new PluginUiPermissions((contents, url) => this.documentFor(contents, url),
      contents => desktopWindows.get(contents.id) ?? this.owners.get(contents.id)?.owner, language);
  }

  create(owner: BrowserWindow, input: PluginUiDocumentInput): PluginUiDocument {
    const session = owner.webContents.session;
    if (!this.sessions.has(session)) {
      // Install on first use; no page work or resource loading enters desktop startup.
      this.permissions.install(session);
      session.protocol.handle(PLUGIN_UI_DOCUMENT_SCHEME, request => this.respond(request));
      this.sessions.add(session);
    }
    const id = randomUUID();
    const host = createHash('sha256').update(input.storageKey).digest('hex');
    const url = `${PLUGIN_UI_DOCUMENT_SCHEME}://${host}/${id}/index.html`;
    const ownerId = owner.webContents.id;
    this.documents.set(id, { id, url, html: input.html, owner, ownerId });
    if (!this.owners.has(ownerId)) {
      const contents = owner.webContents;
      const dispose = () => {
        for (const [key, entry] of this.documents) if (entry.owner === owner) this.release(ownerId, key);
        this.owners.get(ownerId)?.dispose();
        this.owners.delete(ownerId);
      };
      const navigating = (details: { isSameDocument: boolean; isMainFrame: boolean; frame: WebFrameMain | null }) => {
        if (details.isSameDocument) return;
        if (details.isMainFrame) {
          for (const entry of this.documents.values()) if (entry.ownerId === ownerId) this.permissions.revokeDocument(entry.id);
        } else if (details.frame) this.permissions.revokeFrame(details.frame);
      };
      owner.once('closed', dispose);
      contents.once('destroyed', dispose);
      contents.once('render-process-gone', dispose);
      contents.on('did-start-navigation', navigating);
      this.owners.set(ownerId, { owner, dispose: () => {
        owner.removeListener('closed', dispose);
        contents.removeListener('destroyed', dispose);
        contents.removeListener('render-process-gone', dispose);
        contents.removeListener('did-start-navigation', navigating);
      } });
    }
    return { id, url };
  }

  release(ownerId: number, id: string): void {
    const entry = this.documents.get(id);
    // BrowserWindow.webContents is unavailable after the native window closes.
    if (!entry || entry.ownerId !== ownerId) return;
    this.permissions.revokeDocument(id);
    this.documents.delete(id);
  }

  private documentFor(contents: WebContents, requestingUrl: string): DocumentEntry | undefined {
    const url = withoutHash(requestingUrl);
    if (!url) return undefined;
    const entry = this.documents.get(new URL(url).pathname.split('/')[1]);
    return entry?.url === url && entry.ownerId === contents.id ? entry : undefined;
  }

  respond(request: Request): Response {
    const url = new URL(request.url);
    const id = url.pathname.split('/')[1];
    const entry = this.documents.get(id);
    if (!entry || entry.url !== url.href || entry.owner.isDestroyed()
      || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return new Response('Plugin page is unavailable.', { status: 404 });
    }
    return new Response(request.method === 'HEAD' ? null : entry.html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
