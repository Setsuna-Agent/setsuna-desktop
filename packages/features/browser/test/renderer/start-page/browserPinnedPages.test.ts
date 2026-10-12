// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BROWSER_PINNED_PAGES_KEY, readBrowserPinnedPages, toggleBrowserPinnedPage } from '../../../src/renderer/start-page/browserPinnedPages.js';
import { useBrowserPinnedPages } from '../../../src/renderer/start-page/useBrowserPinnedPages.js';
import { BROWSER_HISTORY_STORAGE_KEY } from '../../../src/renderer/browserHistory.js';

afterEach(() => { cleanup(); window.localStorage.clear(); });

it('shares pins between panels, preserves independent changes, and restores after remount', () => {
  const first = renderHook(useBrowserPinnedPages);
  const second = renderHook(useBrowserPinnedPages);
  const a = { url: 'https://example.com/', title: 'Example' };
  const b = { url: 'https://docs.example.com/', title: 'Docs' };
  act(() => { expect(first.result.current.toggle(a)).toBe(true); });
  expect(second.result.current.pages).toEqual([a]);
  act(() => { expect(second.result.current.toggle(b)).toBe(true); });
  expect(first.result.current.pages).toEqual([a, b]);
  // Pins are saved shortcuts, independent of the original visit's lifetime.
  window.localStorage.setItem(BROWSER_HISTORY_STORAGE_KEY, '[]');
  first.unmount();
  second.unmount();
  const restored = renderHook(useBrowserPinnedPages);
  expect(restored.result.current.pages).toEqual([a, b]);
  act(() => { restored.result.current.toggle({ ...a, url: 'https://example.com' }); });
  expect(restored.result.current.pages).toEqual([b]);
  act(() => {
    window.localStorage.setItem(BROWSER_PINNED_PAGES_KEY, JSON.stringify([a]));
    window.dispatchEvent(new StorageEvent('storage', { key: BROWSER_PINNED_PAGES_KEY }));
  });
  expect(restored.result.current.pages).toEqual([a]);
});

it('rejects unsafe URLs and preserves existing pins when saved data is corrupt or storage fails', () => {
  const a = { url: 'https://example.com', title: ' Example\n  page ' };
  toggleBrowserPinnedPage(a);
  const saved = window.localStorage.getItem(BROWSER_PINNED_PAGES_KEY);
  expect(readBrowserPinnedPages()).toEqual([{ url: 'https://example.com/', title: 'Example page' }]);
  for (const url of ['javascript:alert(1)', 'file:///tmp/private', 'data:text/html,x']) {
    expect(() => toggleBrowserPinnedPage({ ...a, url })).toThrow();
  }
  expect(window.localStorage.getItem(BROWSER_PINNED_PAGES_KEY)).toBe(saved);
  const broken = '{broken';
  window.localStorage.setItem(BROWSER_PINNED_PAGES_KEY, broken);
  expect(() => toggleBrowserPinnedPage(a)).toThrow();
  expect(window.localStorage.getItem(BROWSER_PINNED_PAGES_KEY)).toBe(broken);
  expect(() => toggleBrowserPinnedPage(a, {
    getItem: () => saved,
    setItem: () => { throw new Error('quota'); },
  })).toThrow('quota');
});
