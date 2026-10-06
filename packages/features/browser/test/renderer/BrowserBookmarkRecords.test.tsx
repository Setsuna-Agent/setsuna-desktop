// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserRecordsManager } from '../../src/renderer/records/BrowserRecordsManager.js';
import { BROWSER_BOOKMARKS_STORAGE_KEY, LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, readBrowserBookmarkTree } from '../../src/renderer/browserBookmarks.js';
import { OTHER_BOOKMARKS_ID } from '../../src/renderer/records/bookmarkTree.js';
import { translateBrowserMessage } from '../../src/renderer/messages.js';

afterEach(() => { cleanup(); window.localStorage.removeItem(BROWSER_BOOKMARKS_STORAGE_KEY); window.localStorage.removeItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY); });

it('creates nested folders, moves a subtree, and confirms deletion of its saved bookmarks', async () => {
  render(<BrowserRecordsManager kind="bookmarks" onClose={vi.fn()} onNavigate={vi.fn()}
    currentPage={{ title: 'Example', url: 'https://example.org/' }} translate={(key) => translateBrowserMessage('en-US', key)} />);
  const user = userEvent.setup();
  for (const name of ['Work', 'Docs']) {
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), name);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name, exact: true }));
  }
  await user.click(screen.getByRole('button', { name: 'Add favorite' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  const created = readBrowserBookmarkTree();
  const work = created.nodes.find((node) => node.title === 'Work')!;
  const docs = created.nodes.find((node) => node.title === 'Docs')!;
  const page = created.nodes.find((node) => node.title === 'Example')!;
  expect(docs.parentId).toBe(work.id);
  expect(page.parentId).toBe(docs.id);
  await user.click(screen.getByRole('button', { name: 'Edit Work' }));
  await user.click(screen.getByRole('combobox', { name: 'Folder' }));
  await user.click(screen.getByRole('option', { name: 'Other favorites', exact: true }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  const moved = readBrowserBookmarkTree();
  expect(moved.nodes.find((node) => node.id === work.id)?.parentId).toBe(OTHER_BOOKMARKS_ID);
  expect(moved.nodes.find((node) => node.id === page.id)?.parentId).toBe(docs.id);
  await user.click(screen.getByRole('button', { name: 'Delete Work' }));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(readBrowserBookmarkTree()).toEqual(moved);
  await user.click(screen.getByRole('button', { name: 'Delete Work' }));
  await user.click(screen.getByRole('button', { name: 'Confirm deletion' }));
  expect(readBrowserBookmarkTree().nodes).toHaveLength(2);
});
