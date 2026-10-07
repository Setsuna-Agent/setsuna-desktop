import type { BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, bookmarkTitle, decodeBookmarkTree, emptyBookmarkTree,
  normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';

export function parseBookmarkHtml(html: string, sourceId: string): BrowserBookmarkTree {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const root = document.querySelector('dl');
  if (!root) throw new Error('Invalid favorites HTML file.');
  const nodes: BrowserBookmarkNode[] = [...emptyBookmarkTree().nodes];
  const lists = new Map<Element, { id: string; depth: number }>([[root, { id: OTHER_BOOKMARKS_ID, depth: 0 }]]);
  const entries = Array.from(root.querySelectorAll('dt'));
  if (entries.length > 100_000) throw new Error('Favorites HTML is too large.');
  // Exports omit closing DT/P tags. Follow the nearest DL, independent of parser repair wrappers.
  entries.forEach((entry, index) => {
    const parent = lists.get(entry.closest('dl')!);
    if (!parent || parent.depth > 63) throw new Error('Invalid favorites HTML hierarchy.');
    const heading = Array.from(entry.children).find((child) => child.tagName === 'H3');
    const link = Array.from(entry.children).find((child) => child.tagName === 'A');
    const element = heading ?? link;
    if (!element) return;
    const added = Number(element.getAttribute('add_date')) * 1000;
    const base = { id: `import:html:${sourceId}:${index}`, parentId: parent.id, title: bookmarkTitle(element.textContent),
      dateAdded: Number.isSafeInteger(added) && added >= 0 ? added : 0 };
    if (heading) {
      const toolbar = heading.getAttribute('personal_toolbar_folder')?.toLowerCase() === 'true';
      const id = toolbar ? BOOKMARK_BAR_ID : base.id;
      if (!toolbar) nodes.push({ ...base, type: 'folder' });
      const nested = entry.querySelector('dl') ?? (entry.nextElementSibling?.tagName === 'DL' ? entry.nextElementSibling : null);
      if (nested) lists.set(nested, { id, depth: toolbar ? parent.depth : parent.depth + 1 });
    } else if (link) {
      const url = normalizeBrowserBookmarkUrl(link.getAttribute('href'));
      if (url) nodes.push({ ...base, type: 'bookmark', url });
    }
  });
  return decodeBookmarkTree({ version: 2, nodes });
}

/** Merge against the latest stored tree without replacing edits or flattening sibling order. */
export function mergeImportedBookmarks(current: BrowserBookmarkTree, source: BrowserBookmarkTree): { tree: BrowserBookmarkTree; added: number } {
  const existing = decodeBookmarkTree(current);
  const incoming = decodeBookmarkTree(source);
  const nodes: BrowserBookmarkNode[] = [...existing.nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const candidates = new Map<string, BrowserBookmarkNode[]>();
  const children = new Map<string, BrowserBookmarkNode[]>();
  const signature = (node: BrowserBookmarkNode, parentId: string) => JSON.stringify([parentId, node.type, node.type === 'folder' ? node.title : node.url]);
  for (const node of existing.nodes) {
    if (!node.parentId) continue;
    const key = signature(node, node.parentId);
    const entries = candidates.get(key) ?? []; entries.push(node); candidates.set(key, entries);
  }
  for (const node of incoming.nodes) {
    if (!node.parentId) continue;
    const entries = children.get(node.parentId) ?? []; entries.push(node); children.set(node.parentId, entries);
  }
  const consumed = new Set<string>();
  // Stable identities take precedence over name/URL matches, even when their source
  // nodes appear later. A new sibling must never consume another node's exact match.
  const reserved = new Set(incoming.nodes.filter((node) => byId.get(node.id)?.type === node.type).map((node) => node.id));
  let added = 0;
  const visit = (sourceParent: string, parentId: string) => {
    for (const node of children.get(sourceParent) ?? []) {
      const exact = byId.get(node.id);
      const matches = candidates.get(signature(node, parentId)) ?? [];
      const previous = exact?.type === node.type && !consumed.has(exact.id)
        ? exact : matches.find((item) => !consumed.has(item.id) && !reserved.has(item.id));
      const id = previous?.id ?? node.id;
      if (previous) consumed.add(previous.id);
      else {
        const imported = { ...node, parentId };
        nodes.push(imported);
        if (node.type === 'bookmark') added++;
      }
      if (node.type === 'folder') visit(node.id, id);
    }
  };
  visit(BOOKMARK_BAR_ID, BOOKMARK_BAR_ID); visit(OTHER_BOOKMARKS_ID, OTHER_BOOKMARKS_ID);
  return { tree: decodeBookmarkTree({ version: 2, nodes }), added };
}
