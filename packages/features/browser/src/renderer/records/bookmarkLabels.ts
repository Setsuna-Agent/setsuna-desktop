import type { BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import type { BrowserTranslate } from '../messages.js';

export function bookmarkNodeTitle(node: BrowserBookmarkNode, t: BrowserTranslate): string {
  return node.type === 'folder' && node.root ? t(node.root === 'bar' ? 'feature.browser.records.bookmarkBar' : 'feature.browser.records.otherBookmarks') : node.title;
}

export function bookmarkFolderOptions(tree: BrowserBookmarkTree, t: BrowserTranslate, excluded: ReadonlySet<string>) {
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  return tree.nodes.filter((node) => node.type === 'folder' && !excluded.has(node.id)).map((node) => {
    const parts = [bookmarkNodeTitle(node, t)];
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      parts.unshift(bookmarkNodeTitle(parent, t));
      parentId = parent.parentId;
    }
    return { id: node.id, label: parts.join(' / ') };
  });
}
