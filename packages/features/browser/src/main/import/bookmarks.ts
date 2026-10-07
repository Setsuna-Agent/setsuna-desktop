import type { BrowserBookmarkNode, BrowserBookmarkTree } from '../../contracts/bookmarks.js';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, bookmarkTitle, decodeBookmarkTree, emptyBookmarkTree,
  normalizeBrowserBookmarkUrl } from '../../contracts/bookmark-tree.js';
import { isRecord, readProfileJson } from './files.js';

/** Chromium stores dates as microseconds since 1601, independently of the host timezone. */
function chromiumDate(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) return 0;
  const milliseconds = BigInt(value) / 1000n - 11644473600000n;
  return milliseconds >= 0n && milliseconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(milliseconds) : 0;
}

export function parseChromiumBookmarks(value: unknown, sourceId: string): BrowserBookmarkTree {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.roots)) throw new Error('Invalid Chromium bookmarks.');
  if (!['bookmark_bar', 'other', 'synced'].some((key) => value.roots && isRecord(value.roots) && value.roots[key] !== undefined)) {
    throw new Error('Missing Chromium bookmark roots.');
  }
  const nodes: BrowserBookmarkNode[] = [...emptyBookmarkTree().nodes];
  let count = 0;
  const visit = (value: unknown, parentId: string, position: string, depth: number) => {
    if (++count > 100_000 || depth > 63 || !isRecord(value)) throw new Error('Invalid Chromium bookmark tree.');
    const identity = typeof value.guid === 'string' && value.guid ? value.guid : typeof value.id === 'string' && value.id ? value.id : position;
    const id = `import:${sourceId}:${identity}`;
    const base = { id, parentId, title: bookmarkTitle(value.name), dateAdded: chromiumDate(value.date_added) };
    if (value.type === 'url') {
      const url = normalizeBrowserBookmarkUrl(value.url);
      if (url) nodes.push({ ...base, type: 'bookmark', url });
    } else if (value.type === 'folder' && Array.isArray(value.children)) {
      nodes.push({ ...base, type: 'folder' });
      value.children.forEach((child, index) => visit(child, id, `${position}.${index}`, depth + 1));
    } else throw new Error('Invalid Chromium bookmark.');
  };
  for (const [key, parentId] of [['bookmark_bar', BOOKMARK_BAR_ID], ['other', OTHER_BOOKMARKS_ID], ['synced', OTHER_BOOKMARKS_ID]] as const) {
    const root = value.roots[key];
    if (root === undefined) continue;
    if (!isRecord(root) || root.type !== 'folder' || !Array.isArray(root.children)) throw new Error('Invalid Chromium bookmark root.');
    root.children.forEach((node, index) => visit(node, parentId, `${key}.${index}`, 1));
  }
  return decodeBookmarkTree({ version: 2, nodes });
}

export async function readProfileBookmarks(directory: string, profileId: string): Promise<BrowserBookmarkTree> {
  const nodes: BrowserBookmarkNode[] = [...emptyBookmarkTree().nodes];
  // Chrome can split signed-in favorites from local favorites into a separate file.
  for (const file of ['Bookmarks', 'AccountBookmarks']) {
    const data = await readProfileJson(directory, file);
    if (data) nodes.push(...parseChromiumBookmarks(data, `${profileId}:${file}`).nodes.filter((node) => node.parentId !== null));
  }
  return decodeBookmarkTree({ version: 2, nodes });
}
