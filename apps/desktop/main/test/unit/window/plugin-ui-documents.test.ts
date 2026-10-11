import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { PluginUiDocuments } from '../../../src/window/plugin-ui-documents.js';

function owner(id: number) {
  const handle = vi.fn();
  const contents = Object.assign(new EventEmitter(), { id, session: { protocol: { handle } } });
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false });
  return { window: window as unknown as BrowserWindow, contents, handle };
}

describe('Plugin page document ownership', () => {
  it('preserves storage origins while serving only live, exact document URLs', async () => {
    const documents = new PluginUiDocuments();
    const firstOwner = owner(1);
    const page = documents.create(firstOwner.window, { html: '<main>Private page</main>', storageKey: 'app:page' });
    const replacement = documents.create(firstOwner.window, { html: '<main>Replacement</main>', storageKey: 'app:page' });
    const other = documents.create(firstOwner.window, { html: '', storageKey: 'other-app:page' });
    expect(new URL(page.url).hostname).toBe(new URL(replacement.url).hostname);
    expect(page.url).not.toBe(replacement.url);
    expect(new URL(page.url).hostname).not.toBe(new URL(other.url).hostname);
    expect(firstOwner.handle).toHaveBeenCalledOnce();
    expect(await documents.respond(new Request(page.url)).text()).toBe('<main>Private page</main>');
    expect(await documents.respond(new Request(page.url, { method: 'HEAD' })).text()).toBe('');
    for (const request of [new Request(`${page.url}?other`), new Request(page.url.replace('/index.html', '/secret')),
      new Request(page.url.replace(new URL(page.url).hostname, 'other')), new Request(page.url, { method: 'POST' })]) {
      expect(documents.respond(request).status).toBe(404);
    }
    documents.release(2, page.id);
    expect(documents.respond(new Request(page.url)).status).toBe(200);
    documents.release(1, page.id);
    expect(documents.respond(new Request(page.url)).status).toBe(404);
    expect(documents.respond(new Request(replacement.url)).status).toBe(200);
  });

  it.each(['closed', 'destroyed', 'render-process-gone'])('revokes all owner pages on %s without revoking another window', event => {
    const documents = new PluginUiDocuments();
    const firstOwner = owner(1);
    const secondOwner = owner(2);
    const first = documents.create(firstOwner.window, { html: '', storageKey: 'app:page' });
    const second = documents.create(firstOwner.window, { html: '', storageKey: 'app:another' });
    const independent = documents.create(secondOwner.window, { html: '', storageKey: 'app:page' });
    Object.defineProperty(firstOwner.window, 'webContents', { get: () => { throw new Error('Native window is destroyed.'); } });
    (event === 'closed' ? firstOwner.window : firstOwner.contents).emit(event);
    for (const page of [first, second]) expect(documents.respond(new Request(page.url)).status).toBe(404);
    expect(documents.respond(new Request(independent.url)).status).toBe(200);
    expect(firstOwner.contents.listenerCount('destroyed')).toBe(0);
  });
});
