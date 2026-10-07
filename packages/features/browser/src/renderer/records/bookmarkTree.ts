import type { BrowserBookmarkDraft, BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import { bookmarkTitle, decodeBookmarkTree, normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';
export { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, decodeBookmarkTree, emptyBookmarkTree, normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';

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
