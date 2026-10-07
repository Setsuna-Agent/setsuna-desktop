// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BOOKMARK_BAR_ID, OTHER_BOOKMARKS_ID, emptyBookmarkTree } from '../../../src/contracts/bookmark-tree.js';
import { mergeImportedBookmarks, parseBookmarkHtml } from '../../../src/renderer/import/bookmarks.js';
import { parseChromiumBookmarks } from '../../../src/main/import/bookmarks.js';
import type { BrowserBookmarkTree } from '../../../src/contracts/bookmarks.js';

const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3><DL><p>
    <DT><H3 ADD_DATE="1700000000">Work &amp; Tools</H3><DL><p>
      <DT><A HREF="https://example.test" ADD_DATE="1700000001">First &amp; One</A>
      <DT><A HREF="https://example.test/two">Second</A>
      <DT><A HREF="javascript:alert(1)">Unsafe</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://outside.test">Other</A>
</DL><p>`;

describe('favorites import processing', () => {
  it('reads Netscape exports with unclosed DT tags, entities, folders, toolbar roots and dates', () => {
    const tree = parseBookmarkHtml(html, 'source');
    const work = tree.nodes.find((node) => node.title === 'Work & Tools')!;
    expect(work).toMatchObject({ parentId: BOOKMARK_BAR_ID, type: 'folder', dateAdded: 1_700_000_000_000 });
    expect(tree.nodes.filter((node) => node.parentId === work.id).map((node) => node.title)).toEqual(['First & One', 'Second']);
    expect(tree.nodes.find((node) => node.title === 'First & One')?.dateAdded).toBe(1_700_000_001_000);
    expect(tree.nodes.find((node) => node.title === 'Other')?.parentId).toBe(OTHER_BOOKMARKS_ID);
    expect(tree.nodes.some((node) => node.title === 'Unsafe')).toBe(false);
    expect(() => parseBookmarkHtml('<p>Not an export</p>', 'bad')).toThrow();
  });

  it('merges repeat imports and new snapshots without overwriting user edits or dropping duplicate folders', () => {
    const source = parseBookmarkHtml(html, 'source');
    const first = mergeImportedBookmarks(emptyBookmarkTree(), source);
    expect(first.added).toBe(3);
    const edited: BrowserBookmarkTree = { ...first.tree, nodes: first.tree.nodes.map((node) => node.title === 'First & One'
      ? { ...node, title: 'My title', ...(node.type === 'bookmark' ? { url: 'https://edited.test/' } : {}) } : node) };
    expect(mergeImportedBookmarks(edited, source)).toEqual({ tree: edited, added: 0 });
    const changed = parseBookmarkHtml(html.replace('https://example.test/two', 'https://new.test'), 'different-source');
    const next = mergeImportedBookmarks(first.tree, changed);
    expect(next.added).toBe(1);
    expect(next.tree.nodes.filter((node) => node.type === 'folder' && node.title === 'Work & Tools')).toHaveLength(1);
    const duplicateFolders: BrowserBookmarkTree = { ...emptyBookmarkTree(), nodes: [...emptyBookmarkTree().nodes,
      { id: 'one', parentId: BOOKMARK_BAR_ID, type: 'folder', title: 'Same', dateAdded: 0 },
      { id: 'two', parentId: BOOKMARK_BAR_ID, type: 'folder', title: 'Same', dateAdded: 0 },
      { id: 'a', parentId: 'one', type: 'bookmark', title: 'One', url: 'https://same.test/', dateAdded: 0 },
      { id: 'b', parentId: 'two', type: 'bookmark', title: 'Two', url: 'https://same.test/', dateAdded: 0 },
    ] };
    const merged = mergeImportedBookmarks(emptyBookmarkTree(), duplicateFolders);
    expect(merged.added).toBe(2);
    expect(merged.tree.nodes.filter((node) => node.type === 'folder' && node.parentId === BOOKMARK_BAR_ID)).toHaveLength(2);
    expect(mergeImportedBookmarks(merged.tree, duplicateFolders).added).toBe(0);
  });

  it('preserves source order and duplicates across folders while refusing malformed data before persistence', () => {
    const data = { version: 1, roots: { bookmark_bar: { type: 'folder', children: [
      { id: 'a', type: 'url', name: 'First', url: 'https://same.test' },
      { id: 'folder', type: 'folder', name: 'Folder', children: [{ id: 'b', type: 'url', name: 'Second', url: 'https://same.test' }] },
    ] } } };
    const tree = parseChromiumBookmarks(data, 'chrome:Default');
    expect(mergeImportedBookmarks(emptyBookmarkTree(), tree).added).toBe(2);
    expect(tree.nodes.filter((node) => node.parentId === BOOKMARK_BAR_ID).map((node) => node.title)).toEqual(['First', 'Folder']);
    expect(() => mergeImportedBookmarks({ version: 2, nodes: [] }, tree)).toThrow();
    expect(() => parseChromiumBookmarks({ version: 1, roots: { bookmark_bar: {} } }, 'bad')).toThrow();
  });

  it.each(['folder', 'url'])('reserves stable identities before matching a new leading %s with the same signature', (type) => {
    const node = (guid: string) => type === 'folder'
      ? { guid, type, name: 'Same', children: [{ guid: `${guid}-child`, type: 'url', name: guid, url: 'https://same.test/' }] }
      : { guid, type, name: guid, url: 'https://same.test/' };
    const snapshot = (ids: string[]) => parseChromiumBookmarks({ version: 1,
      roots: { bookmark_bar: { type: 'folder', children: ids.map(node) } } }, 'edge:Default');
    const existing = mergeImportedBookmarks(emptyBookmarkTree(), snapshot(['A', 'B'])).tree;
    const merged = mergeImportedBookmarks(existing, snapshot(['C', 'A', 'B']));
    expect(merged.added).toBe(1);
    expect(merged.tree.nodes.filter((node) => node.parentId === BOOKMARK_BAR_ID).map((node) => node.id))
      .toEqual(['import:edge:Default:A', 'import:edge:Default:B', 'import:edge:Default:C']);
    for (const node of existing.nodes) expect(merged.tree.nodes.find((item) => item.id === node.id)).toEqual(node);
    if (type === 'folder') {
      for (const id of ['A', 'B', 'C']) {
        expect(merged.tree.nodes.find((node) => node.id === `import:edge:Default:${id}-child`)?.parentId)
          .toBe(`import:edge:Default:${id}`);
      }
    }
    expect(mergeImportedBookmarks(merged.tree, snapshot(['B', 'C', 'A']))).toEqual({ tree: merged.tree, added: 0 });
  });
});
