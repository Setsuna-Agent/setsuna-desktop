import type { BrowserBookmarkTree } from '../contracts/bookmarks.js';
import { decodeBookmarkTree, emptyBookmarkTree, normalizeBrowserBookmarkUrl } from './records/bookmarkTree.js';

export const BROWSER_BOOKMARKS_STORAGE_KEY = 'setsuna.desktop.browser.bookmarks.v2';
export const LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY = 'setsuna.desktop.browser.bookmarks.v1';
export const BROWSER_BOOKMARKS_CHANGED = 'setsuna:browser-bookmarks-changed';
export type BrowserBookmarkEntry = Readonly<{ id: string; savedAt: number; title: string; url: string }>;
export type BrowserBookmarkInput = Readonly<{ title: string; url: string }>;
type BookmarkStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readBrowserBookmarkTree(storage: BookmarkStorage | null = browserBookmarkStorage()): BrowserBookmarkTree {
  if (!storage) return emptyBookmarkTree();
  const raw = storage.getItem(BROWSER_BOOKMARKS_STORAGE_KEY) ?? storage.getItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY);
  return raw ? decodeBookmarkTree(JSON.parse(raw) as unknown) : emptyBookmarkTree();
}

export function writeBrowserBookmarkTree(tree: BrowserBookmarkTree, storage: BookmarkStorage | null = browserBookmarkStorage()): void {
  if (!storage) throw new Error('Bookmark storage unavailable');
  // Leave the legacy collection intact as a migration backup; v2 becomes authoritative.
  storage.setItem(BROWSER_BOOKMARKS_STORAGE_KEY, JSON.stringify(decodeBookmarkTree(tree)));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BROWSER_BOOKMARKS_CHANGED));
}

export function bookmarkEntries(tree: BrowserBookmarkTree): BrowserBookmarkEntry[] {
  return tree.nodes.flatMap((node) => node.type === 'bookmark' ? [{ id: node.id, title: node.title, url: node.url, savedAt: node.dateAdded }] : [])
    .sort((left, right) => right.savedAt - left.savedAt);
}

export function readBrowserBookmarks(storage: BookmarkStorage | null = browserBookmarkStorage()): BrowserBookmarkEntry[] {
  try { return bookmarkEntries(readBrowserBookmarkTree(storage)); } catch { return []; }
}

export function isBrowserBookmarked(entries: readonly BrowserBookmarkEntry[], rawUrl: string): boolean {
  const url = normalizeBrowserBookmarkUrl(rawUrl);
  return Boolean(url && entries.some((entry) => entry.url === url));
}

function browserBookmarkStorage(): BookmarkStorage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
}
