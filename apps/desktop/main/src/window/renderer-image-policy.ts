import type { BrowserWindow, Session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rendererRoots = new WeakMap<Session, Map<number, string>>();

/** Model-authored Markdown inside third-party components must obey the same file boundary. */
export function registerRendererImagePolicy(window: BrowserWindow, assetRoot: string): void {
  const { session, id } = window.webContents;
  let roots = rendererRoots.get(session);
  if (!roots) {
    roots = new Map();
    rendererRoots.set(session, roots);
    const registered = roots;
    // One listener per session: Electron replaces, rather than stacks, webRequest listeners.
    session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (request, callback) => {
      const root = registered.get(request.webContentsId ?? -1);
      callback({ cancel: Boolean(root && request.resourceType === 'image' && !isRendererAsset(request.url, root)) });
    });
  }
  roots.set(id, path.resolve(assetRoot));
  const registered = roots;
  window.once('closed', () => {
    registered.delete(id);
    if (registered.size) return;
    session.webRequest.onBeforeRequest(null);
    rendererRoots.delete(session);
  });
}

function isRendererAsset(url: string, assetRoot: string): boolean {
  try {
    const relative = path.relative(assetRoot, fileURLToPath(url));
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch { return false; }
}
