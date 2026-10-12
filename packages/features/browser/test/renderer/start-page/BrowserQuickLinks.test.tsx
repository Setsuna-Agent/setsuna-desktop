// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BrowserQuickLinks } from '../../../src/renderer/start-page/BrowserQuickLinks.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../src/renderer/messages.js';
import { BROWSER_HISTORY_STORAGE_KEY } from '../../../src/renderer/browserHistory.js';
import { LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY } from '../../../src/renderer/browserBookmarks.js';
import { readBrowserPinnedPages } from '../../../src/renderer/start-page/browserPinnedPages.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });
const translate: BrowserTranslate = (key) => translateBrowserMessage('en-US', key);

it('opens real history and bookmarks, pins either source and unpins without deleting source data', () => {
  window.localStorage.setItem(BROWSER_HISTORY_STORAGE_KEY, JSON.stringify([{ title: 'Example', url: 'https://example.com/', visitedAt: 1000 }]));
  window.localStorage.setItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, JSON.stringify([{ title: 'Docs', url: 'https://docs.example.com/', savedAt: 1000 }]));
  const onNavigate = vi.fn();
  render(<BrowserQuickLinks onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const sourceHistory = window.localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY);
  const sourceBookmarks = window.localStorage.getItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY);
  fireEvent.click(screen.getByRole('button', { name: 'Open Example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open Docs' }));
  expect(onNavigate.mock.calls).toEqual([['https://example.com/'], ['https://docs.example.com/']]);
  fireEvent.click(screen.getByRole('button', { name: 'Pin to workspace overview Example' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin to workspace overview Docs' }));
  const pinned = within(screen.getByRole('region', { name: 'Pinned' }));
  fireEvent.click(pinned.getByRole('button', { name: 'Unpin Example' }));
  expect(readBrowserPinnedPages()).toEqual([{ title: 'Docs', url: 'https://docs.example.com/' }]);
  expect(window.localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY)).toBe(sourceHistory);
  expect(window.localStorage.getItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY)).toBe(sourceBookmarks);
});

it('limits expanded recent visits to the newest 20 while preserving full history, bookmarks and independent disclosure', () => {
  window.localStorage.setItem(BROWSER_HISTORY_STORAGE_KEY, JSON.stringify(Array.from({ length: 25 }, (_, index) => ({
    title: `Page ${index}`, url: `https://example.com/${index}`, visitedAt: 1000 + index,
  }))));
  window.localStorage.setItem(LEGACY_BROWSER_BOOKMARKS_STORAGE_KEY, JSON.stringify(Array.from({ length: 24 }, (_, index) => ({
    title: `Bookmark ${index}`, url: `https://docs.example.com/${index}`, savedAt: 1000 + index,
  }))));
  const sourceHistory = window.localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY);
  const onNavigate = vi.fn();
  render(<BrowserQuickLinks onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const history = within(screen.getByRole('region', { name: translate('feature.browser.historyTitle') }));
  const bookmarks = within(screen.getByRole('region', { name: translate('feature.browser.bookmarksTitle') }));
  expect(history.getAllByRole('button', { name: /^Open / })).toHaveLength(8);
  fireEvent.click(history.getByRole('button', { name: /^More/, expanded: false }));
  expect(history.getAllByRole('button', { name: /^Open / })).toHaveLength(20);
  expect(history.getByRole('button', { name: 'Open Page 24' })).toBeTruthy();
  expect(history.queryByRole('button', { name: 'Open Page 4' })).toBeNull();
  expect(bookmarks.getAllByRole('button', { name: /^Open / })).toHaveLength(8);
  fireEvent.click(history.getByRole('button', { name: 'Open Page 5' }));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://example.com/5');
  fireEvent.click(history.getByRole('button', { name: 'Pin to workspace overview Page 5' }));
  fireEvent.click(bookmarks.getByRole('button', { name: /^More/ }));
  fireEvent.click(history.getByRole('button', { name: /^Collapse/, expanded: true }));
  expect(history.getAllByRole('button', { name: /^Open / })).toHaveLength(8);
  expect(history.queryByRole('button', { name: 'Open Page 5' })).toBeNull();
  expect(bookmarks.getAllByRole('button', { name: /^Open / })).toHaveLength(24);
  expect(readBrowserPinnedPages()).toEqual([{ title: 'Page 5', url: 'https://example.com/5' }]);
  fireEvent.click(history.getByRole('button', { name: /^More/, expanded: false }));
  expect(history.getAllByRole('button', { name: /^Open / })).toHaveLength(20);
  expect(window.localStorage.getItem(BROWSER_HISTORY_STORAGE_KEY)).toBe(sourceHistory);
});
