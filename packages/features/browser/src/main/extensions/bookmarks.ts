import type { BrowserWindow, Extension } from 'electron';
import { BROWSER_BOOKMARKS_STORAGE_KEY, LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, BROWSER_BOOKMARKS_CHANGED,
  type BrowserBookmarkNode, type BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import { bookmarkTitle, decodeBookmarkTree, emptyBookmarkTree, normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';

type BookmarkResult = { result: unknown; next?: BrowserBookmarkTree };
type ChromeBookmark = { id: string; parentId?: string; index?: number; title: string; url?: string; dateAdded: number; children?: ChromeBookmark[] };

/** Extension bookmarks use the existing desktop collection, including its legacy migration backup. */
export class BrowserExtensionBookmarks {
  constructor(private readonly options: { windows(): readonly BrowserWindow[]; resolve(id: string): Extension | null }) {}

  async call(extension: Extension, method: string, args: unknown[]): Promise<unknown> {
    if (!extension.manifest.permissions?.includes('bookmarks')) throw new Error('bookmarks permission required.');
    const window = this.options.windows().find(window => !window.isDestroyed() && !window.webContents.isDestroyed());
    if (!window) throw new Error('Bookmark storage unavailable.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshot = await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(BROWSER_BOOKMARKS_STORAGE_KEY)})
        ?? localStorage.getItem(${JSON.stringify(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY)})`) as string | null;
      const current = this.options.resolve(extension.id);
      if (!current?.manifest.permissions?.includes('bookmarks') || current.path !== extension.path || current.version !== extension.version) throw new Error('bookmarks permission required.');
      const tree = snapshot ? decodeBookmarkTree(JSON.parse(snapshot)) : emptyBookmarkTree();
      const { result, next } = operate(tree, method, args);
      if (!next) return result;
      const saved = await window.webContents.executeJavaScript(`(${writeCollection.toString()})(${JSON.stringify({
        key: BROWSER_BOOKMARKS_STORAGE_KEY, legacyKey: LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY,
        event: BROWSER_BOOKMARKS_CHANGED, before: snapshot, next: JSON.stringify(decodeBookmarkTree(next)),
      })})`);
      if (saved) return result;
    }
    throw new Error('Bookmark collection changed concurrently. Try again.');
  }
}

function writeCollection(input: { key: string; legacyKey: string; event: string; before: string | null; next: string }): boolean {
  // Compare and write in one renderer task: an edit in any desktop window must not be lost.
  if ((localStorage.getItem(input.key) ?? localStorage.getItem(input.legacyKey)) !== input.before) return false;
  localStorage.setItem(input.key, input.next);
  window.dispatchEvent(new Event(input.event));
  return true;
}

function chromeNodes(tree: BrowserBookmarkTree): { root: ChromeBookmark; byId: Map<string, ChromeBookmark> } {
  const root: ChromeBookmark = { id: '0', title: '', dateAdded: 0, children: [] };
  const byId = new Map<string, ChromeBookmark>([['0', root]]);
  for (const node of tree.nodes) byId.set(node.id, {
    id: node.id, parentId: node.parentId ?? '0', title: node.title || (node.type === 'folder' && node.root
      ? node.root === 'bar' ? 'Bookmarks bar' : 'Other bookmarks' : ''), dateAdded: node.dateAdded,
    ...(node.type === 'bookmark' ? { url: node.url } : { children: [] }),
  });
  for (const node of tree.nodes) {
    const siblings = byId.get(node.parentId ?? '0')!.children!;
    const item = byId.get(node.id)!; item.index = siblings.length; siblings.push(item);
  }
  return { root, byId };
}

function operate(tree: BrowserBookmarkTree, method: string, args: unknown[]): BookmarkResult {
  const { root, byId } = chromeNodes(tree);
  const lookup = (raw: unknown) => {
    if (typeof raw !== 'string' || !byId.has(raw)) throw new Error('Bookmark not found.');
    return byId.get(raw)!;
  };
  const flat = (node: ChromeBookmark) => { const { children: _children, ...result } = node; return result; };
  if (method === 'getTree') return { result: [root] };
  if (method === 'getSubTree') return { result: [lookup(args[0])] };
  if (method === 'getChildren') return { result: (lookup(args[0]).children ?? []).map(flat) };
  if (method === 'get') return { result: (Array.isArray(args[0]) ? args[0] : [args[0]]).map(id => flat(lookup(id))) };
  if (method === 'search') {
    const query = args[0];
    if (typeof query !== 'string' && (!query || typeof query !== 'object' || Array.isArray(query))) throw new Error('Invalid bookmark search.');
    const input = typeof query === 'string' ? { query } : query as { query?: unknown; title?: unknown; url?: unknown };
    if (Object.entries(input).some(([key, value]) => !['query', 'title', 'url'].includes(key) || typeof value !== 'string')) throw new Error('Invalid bookmark search.');
    const words = typeof input.query === 'string' ? input.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
    return { result: [...byId.values()].filter(node => node.id !== '0' && words.every(word => `${node.title} ${node.url ?? ''}`.toLowerCase().includes(word))
      && (input.title === undefined || input.title === node.title) && (input.url === undefined || input.url === node.url)).map(flat) };
  }
  const target = lookup(args[0]);
  const node = tree.nodes.find(node => node.id === target.id);
  if (!node || node.type === 'folder' && node.root) throw new Error('Cannot modify a bookmark root.');
  if (method === 'update') {
    const raw = args[1];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid bookmark changes.');
    const changes = raw as { title?: unknown; url?: unknown };
    if (Object.keys(changes).some(key => !['title', 'url'].includes(key)) || changes.title !== undefined && typeof changes.title !== 'string') throw new Error('Invalid bookmark changes.');
    const title = changes.title === undefined ? node.title : bookmarkTitle(changes.title);
    if (node.type === 'folder' && changes.url !== undefined) throw new Error('A folder cannot have a URL.');
    const url = changes.url === undefined ? node.type === 'bookmark' ? node.url : undefined : normalizeBrowserBookmarkUrl(changes.url);
    if (node.type === 'bookmark' && !url) throw new Error('Invalid bookmark URL.');
    const updated: BrowserBookmarkNode = node.type === 'bookmark' ? { ...node, title, url: url! } : { ...node, title };
    return { result: flat({ ...target, title, ...(url ? { url } : {}) }), next: { version: 2, nodes: tree.nodes.map(item => item.id === node.id ? updated : item) } };
  }
  if (method === 'remove' || method === 'removeTree') {
    if (method === 'remove' && target.children?.length) throw new Error('Cannot remove a non-empty bookmark folder.');
    const ids = new Set([target.id]);
    for (const item of tree.nodes) {
      let parent = item.parentId;
      while (parent) {
        if (parent === target.id) { ids.add(item.id); break; }
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
    return { result: undefined, next: { version: 2, nodes: tree.nodes.filter(item => !ids.has(item.id)) } };
  }
  throw new Error(`Unsupported bookmarks method: ${method}.`);
}
