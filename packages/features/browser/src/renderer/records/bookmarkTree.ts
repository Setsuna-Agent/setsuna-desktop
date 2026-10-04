import type { BrowserBookmarkDraft, BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';

export const BOOKMARK_BAR_ID = 'bookmarks-bar';
export const OTHER_BOOKMARKS_ID = 'other-bookmarks';
const maximumFolderDepth = 64;

export function emptyBookmarkTree(): BrowserBookmarkTree {
  return { version: 2, nodes: [
    { id: BOOKMARK_BAR_ID, parentId: null, type: 'folder', root: 'bar', title: '', dateAdded: 0 },
    { id: OTHER_BOOKMARKS_ID, parentId: null, type: 'folder', root: 'other', title: '', dateAdded: 0 },
  ] };
}

export function normalizeBrowserBookmarkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

function bookmarkTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
}

/** Read legacy flat collections without dropping old entries or reassigning IDs on every read. */
export function decodeBookmarkTree(value: unknown): BrowserBookmarkTree {
  if (Array.isArray(value)) {
    const nodes: BrowserBookmarkNode[] = [...emptyBookmarkTree().nodes];
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const url = normalizeBrowserBookmarkUrl(entry.url);
      if (!url || !Number.isFinite(entry.savedAt) || entry.savedAt <= 0) return;
      nodes.push({ id: `legacy-${index}`, type: 'bookmark', parentId: BOOKMARK_BAR_ID,
        title: bookmarkTitle(entry.title) || new URL(url).hostname, url, dateAdded: Math.trunc(entry.savedAt) });
    });
    return { version: 2, nodes };
  }
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2 || !('nodes' in value) || !Array.isArray(value.nodes)) {
    throw new Error('Invalid bookmark collection');
  }
  const nodes: BrowserBookmarkNode[] = [];
  const seen = new Set<string>();
  for (const item of value.nodes) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || seen.has(item.id)
      || (item.parentId !== null && typeof item.parentId !== 'string') || !Number.isFinite(item.dateAdded) || item.dateAdded < 0) {
      throw new Error('Invalid bookmark node');
    }
    seen.add(item.id);
    const base = { id: item.id, parentId: item.parentId, title: bookmarkTitle(item.title), dateAdded: Math.trunc(item.dateAdded) };
    if (item.type === 'folder') {
      if (item.root !== undefined && item.root !== 'bar' && item.root !== 'other') throw new Error('Invalid bookmark root');
      nodes.push({ ...base, type: 'folder', ...(item.root ? { root: item.root } : {}) });
    } else if (item.type === 'bookmark') {
      const url = normalizeBrowserBookmarkUrl(item.url);
      if (!url) throw new Error('Invalid bookmark URL');
      nodes.push({ ...base, type: 'bookmark', url });
    } else throw new Error('Invalid bookmark type');
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const root of emptyBookmarkTree().nodes) {
    const node = byId.get(root.id);
    if (!node || node.type !== 'folder' || root.type !== 'folder' || node.root !== root.root || node.parentId !== null) throw new Error('Missing bookmark root');
  }
  for (const node of nodes) {
    if (node.parentId === null) {
      if (node.id !== BOOKMARK_BAR_ID && node.id !== OTHER_BOOKMARKS_ID) throw new Error('Unexpected bookmark root');
      continue;
    }
    if (node.type === 'folder' && node.root) throw new Error('Nested bookmark root');
    const visited = new Set([node.id]);
    let parentId: string | null = node.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent || parent.type !== 'folder' || visited.has(parentId) || visited.size > maximumFolderDepth) throw new Error('Invalid bookmark ancestry');
      visited.add(parentId);
      parentId = parent.parentId;
    }
  }
  return { version: 2, nodes };
}

export function bookmarkDescendants(tree: BrowserBookmarkTree, id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of tree.nodes) if (node.parentId) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const descendants = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (descendants.has(current)) continue;
    descendants.add(current);
    pending.push(...(children.get(current) ?? []));
  }
  return descendants;
}

export function saveBookmarkNode(tree: BrowserBookmarkTree, draft: BrowserBookmarkDraft, options: {
  id: string; type: 'bookmark' | 'folder'; create?: boolean; dateAdded?: number;
}): BrowserBookmarkTree | null {
  const current = tree.nodes.find((node) => node.id === options.id);
  if (options.create ? current : !current || (current.type === 'folder' && current.root)) return null;
  if (current && current.type !== options.type) return null;
  const parent = tree.nodes.find((node) => node.id === draft.parentId);
  if (parent?.type !== 'folder' || bookmarkDescendants(tree, options.id).has(parent.id)) return null;
  const title = bookmarkTitle(draft.title);
  const url = options.type === 'bookmark' ? normalizeBrowserBookmarkUrl(draft.url) : null;
  if (!title || (options.type === 'bookmark' && !url)) return null;
  const base = { id: options.id, parentId: parent.id, title, dateAdded: current?.dateAdded ?? options.dateAdded ?? Date.now() };
  const node: BrowserBookmarkNode = options.type === 'bookmark' ? { ...base, type: 'bookmark', url: url! } : { ...base, type: 'folder' };
  // Same-folder edits retain their position; moving appends to the destination folder.
  const nodes = current?.parentId === parent.id
    ? tree.nodes.map((item) => item.id === current.id ? node : item)
    : [...tree.nodes.filter((item) => item.id !== node.id), node];
  try { return decodeBookmarkTree({ version: 2, nodes }); } catch { return null; }
}

export function removeBookmarkNode(tree: BrowserBookmarkTree, id: string): BrowserBookmarkTree {
  const current = tree.nodes.find((node) => node.id === id);
  if (!current || (current.type === 'folder' && current.root)) return tree;
  const ids = bookmarkDescendants(tree, id);
  return { version: 2, nodes: tree.nodes.filter((node) => !ids.has(node.id)) };
}
