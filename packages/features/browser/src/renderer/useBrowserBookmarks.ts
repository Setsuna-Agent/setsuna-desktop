import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserBookmarkDraft, BrowserBookmarkTree } from '../contracts/bookmarks.js';
import { bookmarkEntries, readBrowserBookmarkTree, writeBrowserBookmarkTree, BROWSER_BOOKMARKS_CHANGED,
  BROWSER_BOOKMARKS_STORAGE_KEY, LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, type BrowserBookmarkInput } from './browserBookmarks.js';
import { BOOKMARK_BAR_ID, emptyBookmarkTree, normalizeBrowserBookmarkUrl, removeBookmarkNode, saveBookmarkNode } from './records/bookmarkTree.js';

function loadBookmarks() {
  try { return { tree: readBrowserBookmarkTree(), error: false }; }
  catch { return { tree: emptyBookmarkTree(), error: true }; }
}

export function useBrowserBookmarks() {
  const [state, setState] = useState(loadBookmarks);
  const refresh = useCallback(() => setState(loadBookmarks()), []);
  const commit = useCallback((change: (tree: BrowserBookmarkTree) => BrowserBookmarkTree | null) => {
    try {
      // Always read before mutation. Corrupt storage must not be replaced by an empty fallback.
      const tree = change(readBrowserBookmarkTree());
      if (!tree) return false;
      writeBrowserBookmarkTree(tree);
      setState({ tree, error: false });
      return true;
    } catch { setState((current) => ({ ...current, error: true })); return false; }
  }, []);
  const toggle = useCallback((input: BrowserBookmarkInput) => commit((tree) => {
    const url = normalizeBrowserBookmarkUrl(input.url);
    if (!url) return null;
    const existing = tree.nodes.find((node) => node.type === 'bookmark' && node.url === url);
    return existing ? removeBookmarkNode(tree, existing.id) : saveBookmarkNode(tree,
      { ...input, title: input.title.trim() || new URL(url).hostname, url, parentId: BOOKMARK_BAR_ID },
      { id: crypto.randomUUID(), type: 'bookmark', create: true });
  }), [commit]);
  const save = useCallback((draft: BrowserBookmarkDraft, type: 'bookmark' | 'folder', id?: string) => commit((tree) =>
    saveBookmarkNode(tree, draft, { id: id ?? crypto.randomUUID(), type, create: !id })), [commit]);
  const remove = useCallback((id: string) => commit((tree) => removeBookmarkNode(tree, id)), [commit]);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === BROWSER_BOOKMARKS_STORAGE_KEY || event.key === LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY) refresh();
    };
    window.addEventListener(BROWSER_BOOKMARKS_CHANGED, refresh);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener(BROWSER_BOOKMARKS_CHANGED, refresh); window.removeEventListener('storage', storage); };
  }, [refresh]);
  const entries = useMemo(() => bookmarkEntries(state.tree), [state.tree]);
  return { tree: state.tree, entries, error: state.error, refresh, toggle, save, remove };
}
