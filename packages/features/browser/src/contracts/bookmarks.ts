export type BrowserBookmarkNode = Readonly<{
  id: string;
  parentId: string | null;
  title: string;
  dateAdded: number;
} & ({ type: 'folder'; root?: 'bar' | 'other' } | { type: 'bookmark'; url: string })>;

/** Sibling order is the order in nodes. IDs remain stable when renaming or moving. */
export type BrowserBookmarkTree = Readonly<{ version: 2; nodes: readonly BrowserBookmarkNode[] }>;
export type BrowserBookmarkDraft = Readonly<{ title: string; parentId: string; url?: string }>;

export const BROWSER_BOOKMARKS_STORAGE_KEY = 'setsuna.desktop.browser.bookmarks.v2';
export const LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY = 'setsuna.desktop.browser.bookmarks.v1';
export const BROWSER_BOOKMARKS_CHANGED = 'setsuna:browser-bookmarks-changed';
