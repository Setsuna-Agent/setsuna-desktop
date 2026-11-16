// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences, type BrowserSearchEngine } from '../../../src/contracts/settings.js';
import { BrowserStartPageSearch } from '../../../src/renderer/start-page/BrowserStartPageSearch.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../src/renderer/messages.js';
import { writeBrowserHistory } from '../../../src/renderer/browserHistory.js';
import { writeBrowserBookmarkTree } from '../../../src/renderer/browserBookmarks.js';
import { BOOKMARK_BAR_ID, emptyBookmarkTree } from '../../../src/renderer/records/bookmarkTree.js';
import { toggleBrowserPinnedPage } from '../../../src/renderer/start-page/browserPinnedPages.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });
const translate: BrowserTranslate = (key, params) => Object.entries(params ?? {}).reduce(
  (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), translateBrowserMessage('en-US', key),
);

it('reads the current default engine only on submission through Enter or a search suggestion', async () => {
  const getBrowserPreferences = vi.fn<() => Promise<BrowserPreferences>>();
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  expect(getBrowserPreferences).not.toHaveBeenCalled();
  await user.type(screen.getByRole('combobox'), '  中文 & test  ');
  expect(getBrowserPreferences).not.toHaveBeenCalled();
  const engines: Array<[BrowserSearchEngine, string]> = [
    ['baidu', 'https://www.baidu.com/s?wd='],
    ['google', 'https://www.google.com/search?q='],
    ['duckduckgo', 'https://duckduckgo.com/?q='],
    ['bing', 'https://www.bing.com/search?q='],
  ];
  for (const [index, [searchEngine, prefix]] of engines.entries()) {
    getBrowserPreferences.mockResolvedValue({ ...DEFAULT_BROWSER_PREFERENCES, searchEngine });
    if (index === 0) await user.keyboard('{Enter}');
    else {
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Search 中文 & test' }));
    }
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(index + 1));
    expect(onNavigate).toHaveBeenLastCalledWith(`${prefix}%E4%B8%AD%E6%96%87%20%26%20test`);
  }
  expect(getBrowserPreferences).toHaveBeenCalledTimes(4);
});

it.each([
  ['https://example.org/docs', 'https://example.org/docs'],
  ['github.com?tab=repositories', 'https://github.com?tab=repositories'],
  ['example.org#overview', 'https://example.org#overview'],
  ['localhost:5174', 'http://localhost:5174'],
  ['192.168.1.1:8080/status', 'http://192.168.1.1:8080/status'],
  ['[::1]:5174', 'http://[::1]:5174'],
])('opens %s directly without depending on search settings', async (input, destination) => {
  const getBrowserPreferences = vi.fn<() => Promise<BrowserPreferences>>();
  const onNavigate = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox'), input.replaceAll('[', '[['));
  await user.keyboard('{Enter}');
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(destination);
  expect(getBrowserPreferences).not.toHaveBeenCalled();
});

it('lets the user explicitly search a URL instead of navigating to it', async () => {
  const getBrowserPreferences = vi.fn(async () => ({ ...DEFAULT_BROWSER_PREFERENCES, searchEngine: 'google' as const }));
  const onNavigate = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('combobox'), 'github.com');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=github.com'));
});

it('refreshes local sources on focus, prioritizes pins and opens matched saved or visited pages without a search', async () => {
  const getBrowserPreferences = vi.fn<() => Promise<BrowserPreferences>>();
  const onNavigate = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const pinned = { title: 'Department', url: 'https://department.example.org/' };
  toggleBrowserPinnedPage(pinned);
  writeBrowserHistory([
    { title: 'Recent dashboard', url: 'https://dashboard.example.org/', visitedAt: 200 },
    { ...pinned, visitedAt: 100 },
  ]);
  writeBrowserBookmarkTree({ ...emptyBookmarkTree(), nodes: [...emptyBookmarkTree().nodes,
    { id: 'docs', type: 'folder', parentId: BOOKMARK_BAR_ID, title: 'Docs', dateAdded: 100 },
    { id: 'guide', type: 'bookmark', parentId: 'docs', title: 'Saved guide', url: 'https://docs.example.org/guide', dateAdded: 200 },
  ] });
  const user = userEvent.setup();
  const input = screen.getByRole('combobox');
  await user.click(input);
  await user.keyboard('{Enter}');
  expect(onNavigate).toHaveBeenLastCalledWith(pinned.url);
  await user.type(input, 'saved');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onNavigate).toHaveBeenLastCalledWith('https://docs.example.org/guide');
  await user.clear(input);
  await user.type(input, 'dashboard');
  await user.click(screen.getByRole('option', { name: 'Recent dashboard' }));
  expect(onNavigate.mock.calls).toEqual([[pinned.url], ['https://docs.example.org/guide'], ['https://dashboard.example.org/']]);
  expect(getBrowserPreferences).not.toHaveBeenCalled();
});

it('clears a pending search without late navigation and dismisses or reopens local suggestions', async () => {
  writeBrowserHistory([{ title: 'Recent page', url: 'https://example.org/recent', visitedAt: 100 }]);
  let resolve!: (preferences: BrowserPreferences) => void;
  const getBrowserPreferences = vi.fn(() => new Promise<BrowserPreferences>((done) => { resolve = done; }));
  const onNavigate = vi.fn();
  render(<><BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />
    <button type="button">Outside</button></>);
  const user = userEvent.setup();
  const input = screen.getByRole('combobox');
  await user.type(input, 'pending query');
  await user.keyboard('{Enter}');
  expect(getBrowserPreferences).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Clear input' }));
  expect(document.activeElement).toBe(input);
  await act(async () => { resolve(DEFAULT_BROWSER_PREFERENCES); });
  expect(onNavigate).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.click(input);
  await user.keyboard('{Enter}');
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://example.org/recent');
});

it('ignores empty input and IME confirmation, then searches after composition finishes', async () => {
  const getBrowserPreferences = vi.fn(async () => DEFAULT_BROWSER_PREFERENCES);
  const onNavigate = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const input = screen.getByRole('combobox');
  const form = screen.getByRole('search');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.submit(form);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: '搜索' } });
  expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
  fireEvent.submit(form);
  expect(getBrowserPreferences).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  fireEvent.submit(form);
  await waitFor(() => expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.bing.com/search?q=%E6%90%9C%E7%B4%A2'));
});

it('reports settings failures without falling back to a different engine and keeps the query for retry', async () => {
  const getBrowserPreferences = vi.fn<() => Promise<BrowserPreferences>>().mockRejectedValueOnce(new Error('settings unavailable'));
  const onNavigate = vi.fn();
  const onError = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={onError} translate={translate} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'keep my query' } });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() => expect(onError).toHaveBeenCalledOnce());
  expect(onNavigate).not.toHaveBeenCalled();
  getBrowserPreferences.mockResolvedValueOnce({ ...DEFAULT_BROWSER_PREFERENCES, searchEngine: 'google' });
  fireEvent.submit(screen.getByRole('search'));
  await waitFor(() => expect(onNavigate).toHaveBeenCalledExactlyOnceWith('https://www.google.com/search?q=keep%20my%20query'));
});

it('deduplicates pending submissions and does not open a browser after the panel closes', async () => {
  let resolve!: (preferences: BrowserPreferences) => void;
  const getBrowserPreferences = vi.fn(() => new Promise<BrowserPreferences>((done) => { resolve = done; }));
  const onNavigate = vi.fn();
  const view = render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'query' } });
  fireEvent.submit(screen.getByRole('search'));
  fireEvent.submit(screen.getByRole('search'));
  expect(getBrowserPreferences).toHaveBeenCalledOnce();
  expect(onNavigate).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => { resolve(DEFAULT_BROWSER_PREFERENCES); });
  expect(onNavigate).not.toHaveBeenCalled();
});
