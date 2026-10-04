import { describe, expect, it } from 'vitest';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, decodeBookmarkTree, emptyBookmarkTree, removeBookmarkNode, saveBookmarkNode } from '../../src/renderer/records/bookmarkTree.js';
import { BROWSER_BOOKMARKS_STORAGE_KEY, LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, bookmarkEntries, readBrowserBookmarkTree, writeBrowserBookmarkTree } from '../../src/renderer/browserBookmarks.js';

describe('bookmark collection', () => {
  it('migrates all legacy bookmarks with stable IDs and keeps the original storage as a backup', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const legacy = JSON.stringify(Array.from({ length: 80 }, (_, index) => ({ title: `Page ${index}`, url: `https://example.org/${index}`, savedAt: index + 1 })));
    storage.setItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, legacy);
    const migrated = readBrowserBookmarkTree(storage);
    expect(migrated.nodes.filter((node) => node.type === 'bookmark')).toHaveLength(80);
    expect(readBrowserBookmarkTree(storage)).toEqual(migrated);
    writeBrowserBookmarkTree(migrated, storage);
    expect(readBrowserBookmarkTree(storage)).toEqual(migrated);
    expect(storage.getItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY)).toBe(legacy);
    // Corrupt v2 data must fail, rather than resurrecting the legacy backup on the next edit.
    storage.setItem(BROWSER_BOOKMARKS_STORAGE_KEY, '{broken');
    expect(() => readBrowserBookmarkTree(storage)).toThrow();
  });

  it('preserves identities, sibling order and duplicate URLs across nested folder moves', () => {
    let tree = saveBookmarkNode(emptyBookmarkTree(), { title: 'Work', parentId: BOOKMARK_BAR_ID }, { id: 'work', type: 'folder', create: true })!;
    tree = saveBookmarkNode(tree, { title: 'Docs', parentId: 'work' }, { id: 'docs', type: 'folder', create: true })!;
    tree = saveBookmarkNode(tree, { title: 'First', parentId: 'docs', url: 'https://example.com' }, { id: 'first', type: 'bookmark', create: true, dateAdded: 100 })!;
    tree = saveBookmarkNode(tree, { title: 'Second', parentId: 'docs', url: 'https://example.com' }, { id: 'second', type: 'bookmark', create: true, dateAdded: 200 })!;
    expect(bookmarkEntries(tree).map((entry) => entry.id)).toEqual(['second', 'first']);
    tree = saveBookmarkNode(tree, { title: 'Renamed', parentId: 'docs', url: 'https://example.org' }, { id: 'first', type: 'bookmark' })!;
    expect(tree.nodes.filter((node) => node.parentId === 'docs').map((node) => node.id)).toEqual(['first', 'second']);
    const moved = saveBookmarkNode(tree, { title: 'Docs', parentId: OTHER_BOOKMARKS_ID }, { id: 'docs', type: 'folder' })!;
    expect(moved.nodes.find((node) => node.id === 'first')).toMatchObject({ parentId: 'docs', dateAdded: 100, title: 'Renamed' });
    expect(bookmarkEntries(moved).map((entry) => entry.id)).toEqual(['second', 'first']);
    expect(decodeBookmarkTree(JSON.parse(JSON.stringify(moved)))).toEqual(moved);
    expect(saveBookmarkNode(tree, { title: 'Cycle', parentId: 'docs' }, { id: 'work', type: 'folder' })).toBeNull();
    expect(saveBookmarkNode(tree, { title: 'Unsafe', parentId: 'docs', url: 'javascript:alert(1)' }, { id: 'first', type: 'bookmark' })).toBeNull();
    expect(saveBookmarkNode(tree, { title: 'Missing', parentId: 'deleted', url: 'https://example.org' }, { id: 'first', type: 'bookmark' })).toBeNull();
    expect(removeBookmarkNode(tree, BOOKMARK_BAR_ID)).toEqual(tree);
    const removed = removeBookmarkNode(tree, 'work');
    expect(removed.nodes.map((node) => node.id)).toEqual([BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID]);
    expect(saveBookmarkNode(removed, { title: 'Stale', parentId: BOOKMARK_BAR_ID, url: 'https://example.org' }, { id: 'first', type: 'bookmark' })).toBeNull();
  });

  it('rejects malformed trees with duplicate IDs, missing parents or cycles', () => {
    const tree = emptyBookmarkTree();
    const a = { id: 'a', type: 'folder', parentId: 'b', dateAdded: 1, title: 'A' };
    const b = { id: 'b', type: 'folder', parentId: 'a', dateAdded: 1, title: 'B' };
    expect(() => decodeBookmarkTree({ ...tree, nodes: [...tree.nodes, a] })).toThrow();
    expect(() => decodeBookmarkTree({ ...tree, nodes: [...tree.nodes, a, b] })).toThrow();
    expect(() => decodeBookmarkTree({ ...tree, nodes: [...tree.nodes, tree.nodes[0]] })).toThrow();
  });
});
