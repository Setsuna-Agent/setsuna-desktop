// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences, type BrowserSearchEngine } from '../../../src/contracts/settings.js';
import { BrowserStartPageSearch } from '../../../src/renderer/start-page/BrowserStartPageSearch.js';
import { translateBrowserMessage, type BrowserTranslate } from '../../../src/renderer/messages.js';

afterEach(cleanup);
const translate: BrowserTranslate = (key) => translateBrowserMessage('en-US', key);

it('reads the current default engine only on submission and supports both Enter and the search button', async () => {
  const getBrowserPreferences = vi.fn<() => Promise<BrowserPreferences>>();
  const onNavigate = vi.fn();
  const user = userEvent.setup();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  expect(getBrowserPreferences).not.toHaveBeenCalled();
  await user.type(screen.getByRole('searchbox'), '  中文 & test  ');
  const engines: Array<[BrowserSearchEngine, string]> = [
    ['baidu', 'https://www.baidu.com/s?wd='],
    ['google', 'https://www.google.com/search?q='],
    ['duckduckgo', 'https://duckduckgo.com/?q='],
    ['bing', 'https://www.bing.com/search?q='],
  ];
  for (const [index, [searchEngine, prefix]] of engines.entries()) {
    getBrowserPreferences.mockResolvedValue({ ...DEFAULT_BROWSER_PREFERENCES, searchEngine });
    if (index === 0) await user.keyboard('{Enter}');
    else await user.click(screen.getByRole('button', { name: 'Search the web' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledTimes(index + 1));
    expect(onNavigate).toHaveBeenLastCalledWith(`${prefix}%E4%B8%AD%E6%96%87%20%26%20test`);
  }
  expect(getBrowserPreferences).toHaveBeenCalledTimes(4);
});

it('ignores empty input and IME confirmation, then searches after composition finishes', async () => {
  const getBrowserPreferences = vi.fn(async () => DEFAULT_BROWSER_PREFERENCES);
  const onNavigate = vi.fn();
  render(<BrowserStartPageSearch bridge={{ getBrowserPreferences }} onNavigate={onNavigate} onError={vi.fn()} translate={translate} />);
  const input = screen.getByRole('searchbox');
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
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'keep my query' } });
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
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'query' } });
  fireEvent.submit(screen.getByRole('search'));
  fireEvent.submit(screen.getByRole('search'));
  expect(getBrowserPreferences).toHaveBeenCalledOnce();
  expect(onNavigate).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => { resolve(DEFAULT_BROWSER_PREFERENCES); });
  expect(onNavigate).not.toHaveBeenCalled();
});
