import type { BrowserBookmarkNode, BrowserBookmarkTree } from './bookmarks.js';

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

export function bookmarkTitle(value: unknown): string {
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
